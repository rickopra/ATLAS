import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';

import { prisma } from '../db.js';
import { triggerSnapshotRebuild } from './handover-submit.js';

export type AssetSortKey =
  | 'tag'
  | 'sn'
  | 'item'
  | 'qty'
  | 'status'
  | 'user'
  | 'assignedAccount'
  | 'assignedDept'
  | 'location'
  | 'ownerAccount'
  | 'ownerDept';

type ListAssetsParams = {
  search: string;
  page: number;
  pageSize: number;
  sortKey: AssetSortKey;
  sortDir: 'asc' | 'desc';
};

type AssetActor = {
  email?: string | null;
  fullName?: string | null;
  roles?: string[];
};

type UpsertAssetPayload = {
  assetTag: string;
  serialNumber: string;
  itemModel: string;
  category: string;
  status: string;
  location: string;
  purchaseDate: string;
  vendorName: string;
  purchasingYear: string;
  orderNumber: string;
  invoiceNumber: string;
  ownerAccount: string;
  ownerDepartment: string;
  assignmentMode: 'individual' | 'sharing';
  assignedToText: string;
  assignedAccount: string;
  assignedDept: string;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function asInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.trunc(parsed);
}

function normalizeAssetTag(value: unknown) {
  return text(value).toUpperCase();
}

function pageMeta(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize))
  };
}

function assetOrderBy(sortKey: AssetSortKey, sortDir: 'asc' | 'desc') {
  switch (sortKey) {
    case 'sn':
      return [{ serialNumber: sortDir }, { assetTag: 'asc' as const }];
    case 'item':
      return [{ itemModel: sortDir }, { assetTag: 'asc' as const }];
    case 'qty':
      return [{ quantity: sortDir }, { assetTag: 'asc' as const }];
    case 'status':
      return [{ status: sortDir }, { assetTag: 'asc' as const }];
    case 'user':
      return [{ assignedToText: sortDir }, { assetTag: 'asc' as const }];
    case 'assignedAccount':
      return [{ assignedAccount: sortDir }, { assetTag: 'asc' as const }];
    case 'assignedDept':
      return [{ assignedDept: sortDir }, { assetTag: 'asc' as const }];
    case 'location':
      return [{ location: sortDir }, { assetTag: 'asc' as const }];
    case 'ownerAccount':
      return [{ ownerAccount: sortDir }, { assetTag: 'asc' as const }];
    case 'ownerDept':
      return [{ ownerDepartment: sortDir }, { assetTag: 'asc' as const }];
    case 'tag':
    default:
      return [{ assetTag: sortDir }, { updatedAt: 'desc' as const }];
  }
}

function assetMutationActor(actor: AssetActor) {
  const email = text(actor.email || '');
  if (email) return email;
  return text(actor.fullName || 'system');
}

function normalizeAssetStatus(status: unknown, quantity: number, assignedToText: string, assignedAccount: string, assignedDept: string) {
  const normalized = text(status);
  if (normalized) return normalized;
  if (quantity <= 0) return 'Out of Stock';
  if (assignedToText || assignedAccount || assignedDept) return 'In Use';
  return 'Available';
}

function normalizeAssignment(payload: UpsertAssetPayload) {
  const assignmentMode = payload.assignmentMode === 'sharing' ? 'sharing' : 'individual';
  if (assignmentMode === 'sharing') {
    return {
      assignmentMode,
      assignedToText: '',
      assignedAccount: text(payload.assignedAccount),
      assignedDept: text(payload.assignedDept)
    };
  }

  return {
    assignmentMode,
    assignedToText: text(payload.assignedToText),
    assignedAccount: '',
    assignedDept: ''
  };
}

function buildAssetWhere(search: string) {
  const q = text(search);
  if (!q) return undefined;

  return {
    OR: [
      { assetTag: { contains: q, mode: 'insensitive' as const } },
      { serialNumber: { contains: q, mode: 'insensitive' as const } },
      { itemModel: { contains: q, mode: 'insensitive' as const } },
      { category: { contains: q, mode: 'insensitive' as const } },
      { status: { contains: q, mode: 'insensitive' as const } },
      { assignedToText: { contains: q, mode: 'insensitive' as const } },
      { assignedAccount: { contains: q, mode: 'insensitive' as const } },
      { assignedDept: { contains: q, mode: 'insensitive' as const } },
      { location: { contains: q, mode: 'insensitive' as const } },
      { vendorName: { contains: q, mode: 'insensitive' as const } },
      { invoiceNumber: { contains: q, mode: 'insensitive' as const } },
      { orderNumber: { contains: q, mode: 'insensitive' as const } },
      { ownerAccount: { contains: q, mode: 'insensitive' as const } },
      { ownerDepartment: { contains: q, mode: 'insensitive' as const } }
    ]
  };
}

async function appendAssetRevisionLog(input: {
  assetId?: string | null;
  assetTag: string;
  itemModel: string;
  action: string;
  qtyBefore: number;
  qtyChange: number;
  qtyAfter: number;
  remark: string;
  actorEmail: string;
  rawJson?: Prisma.InputJsonValue;
}) {
  await prisma.assetRevision.create({
    data: {
      assetId: input.assetId || null,
      assetTag: input.assetTag,
      itemModel: input.itemModel,
      action: input.action,
      qtyBefore: input.qtyBefore,
      qtyChange: input.qtyChange,
      qtyAfter: input.qtyAfter,
      remark: input.remark,
      source: 'ONPREM_ATLAS',
      actorEmail: input.actorEmail,
      rawJson: input.rawJson || {}
    }
  });
}

export async function listAssets(params: ListAssetsParams) {
  const where = buildAssetWhere(params.search);
  const orderBy = assetOrderBy(params.sortKey, params.sortDir);

  const [total, items, totalUnitsAggregate, inUseRows, availableUnitsAggregate] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize
    }),
    prisma.asset.aggregate({
      where,
      _sum: {
        quantity: true
      }
    }),
    prisma.asset.count({
      where: {
        AND: [
          where || {},
          {
            OR: [
              { status: { equals: 'In Use', mode: 'insensitive' as const } },
              { status: { equals: 'Assigned', mode: 'insensitive' as const } }
            ]
          }
        ]
      }
    }),
    prisma.asset.aggregate({
      where: {
        AND: [
          where || {},
          {
            OR: [
              { status: { equals: 'Available', mode: 'insensitive' as const } },
              { status: { equals: 'Partially Assigned', mode: 'insensitive' as const } }
            ]
          }
        ]
      },
      _sum: {
        quantity: true
      }
    })
  ]);

  return {
    ok: true,
    meta: pageMeta(params.page, params.pageSize, total),
    counts: {
      rows: total,
      totalUnits: asInt(totalUnitsAggregate._sum.quantity, 0),
      inUseRows,
      availableUnits: asInt(availableUnitsAggregate._sum.quantity, 0)
    },
    items
  };
}

export async function exportAssetsExcel(search: string, sortKey: AssetSortKey, sortDir: 'asc' | 'desc'): Promise<Buffer> {
  const where = buildAssetWhere(search);
  const orderBy = assetOrderBy(sortKey, sortDir);

  const items = await prisma.asset.findMany({ where, orderBy });

  const rows = items.map((a) => ({
    'Asset Tag': text(a.assetTag),
    'Serial Number': text(a.serialNumber),
    'Item Model': text(a.itemModel),
    'Category': text(a.category),
    'Qty': a.quantity ?? 0,
    'Status': text(a.status),
    'Assigned To': text(a.assignedToText),
    'Assigned Account': text(a.assignedAccount),
    'Assigned Dept': text(a.assignedDept),
    'Location': text(a.location),
    'Owner Account': text(a.ownerAccount),
    'Owner Dept': text(a.ownerDepartment),
    'RAM Size': text(a.ramSize),
    'RAM Type': text(a.ramType),
    'Storage Size': text(a.storageSize),
    'Storage Type': text(a.storageType),
    'External VGA': text(a.externalVga),
    'VGA Type': text(a.externalVgaType),
    'Purchase Date': a.purchaseDate ? a.purchaseDate.toISOString().slice(0, 10) : '',
    'Purchasing Year': text(a.purchasingYear),
    'Vendor': text(a.vendorName),
    'Order No': text(a.orderNumber),
    'Invoice No': text(a.invoiceNumber),
    'Last Updated': a.updatedAt ? a.updatedAt.toISOString().slice(0, 19).replace('T', ' ') : ''
  }));

  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws['!cols'] = [
    { wch: 20 }, // Asset Tag
    { wch: 20 }, // SN
    { wch: 30 }, // Item Model
    { wch: 20 }, // Category
    { wch: 6  }, // Qty
    { wch: 16 }, // Status
    { wch: 36 }, // Assigned To
    { wch: 18 }, // Assigned Account
    { wch: 22 }, // Assigned Dept
    { wch: 20 }, // Location
    { wch: 18 }, // Owner Account
    { wch: 22 }, // Owner Dept
    { wch: 12 }, // RAM Size
    { wch: 12 }, // RAM Type
    { wch: 14 }, // Storage Size
    { wch: 12 }, // Storage Type
    { wch: 14 }, // External VGA
    { wch: 12 }, // VGA Type
    { wch: 14 }, // Purchase Date
    { wch: 16 }, // Purchasing Year
    { wch: 24 }, // Vendor
    { wch: 18 }, // Order No
    { wch: 18 }, // Invoice No
    { wch: 20 }  // Last Updated
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Asset List');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

export async function updateAssetQuantity(assetTag: string, delta: number, remark: string, actor: AssetActor) {
  const tag = normalizeAssetTag(assetTag);
  if (!tag) return { success: false, message: 'Asset tag is required.' };
  if (!Number.isFinite(delta) || delta === 0) {
    return { success: false, message: 'Quantity delta must be a non-zero number.' };
  }

  const asset = await prisma.asset.findFirst({
    where: {
      assetTag: {
        equals: tag,
        mode: 'insensitive'
      }
    }
  });

  if (!asset) return { success: false, message: 'Asset not found.' };

  const qtyBefore = Math.max(0, asInt(asset.quantity, 0));
  const qtyAfter = qtyBefore + Math.trunc(delta);
  if (qtyAfter < 0) {
    return { success: false, message: 'Quantity cannot be reduced below zero.' };
  }

  const normalizedStatus = normalizeAssetStatus(
    asset.status,
    qtyAfter,
    text(asset.assignedToText),
    text(asset.assignedAccount),
    text(asset.assignedDept)
  );

  const updated = await prisma.asset.update({
    where: { id: asset.id },
    data: {
      quantity: qtyAfter,
      status: normalizedStatus
    }
  });

  await appendAssetRevisionLog({
    assetId: asset.id,
    assetTag: updated.assetTag,
    itemModel: text(updated.itemModel),
    action: 'ADJUST_QTY',
    qtyBefore,
    qtyChange: Math.trunc(delta),
    qtyAfter,
    remark: text(remark) || 'Manual quantity adjustment',
    actorEmail: assetMutationActor(actor),
    rawJson: {
      status: updated.status
    }
  });

  // Rebuild employee asset holdings snapshot so manual qty changes are reflected immediately
  void triggerSnapshotRebuild();

  return {
    success: true,
    message: `Quantity for ${updated.assetTag} updated successfully.`,
    item: updated
  };
}

export async function updateAssetRecord(originalAssetTag: string, payload: UpsertAssetPayload, actor: AssetActor) {
  const originalTag = normalizeAssetTag(originalAssetTag);
  const nextTag = normalizeAssetTag(payload.assetTag);
  if (!originalTag || !nextTag) return { success: false, message: 'Asset tag is required.' };
  if (!text(payload.itemModel) || !text(payload.category)) {
    return { success: false, message: 'Item model and category are required.' };
  }

  const asset = await prisma.asset.findFirst({
    where: {
      assetTag: {
        equals: originalTag,
        mode: 'insensitive'
      }
    }
  });
  if (!asset) return { success: false, message: 'Asset not found.' };

  const conflicting = await prisma.asset.findFirst({
    where: {
      id: {
        not: asset.id
      },
      assetTag: {
        equals: nextTag,
        mode: 'insensitive'
      }
    },
    select: { id: true }
  });
  if (conflicting) return { success: false, message: 'New asset tag is already used by another asset.' };

  const assignment = normalizeAssignment(payload);
  if (assignment.assignmentMode === 'sharing' && (!assignment.assignedAccount || !assignment.assignedDept)) {
    return { success: false, message: 'Sharing asset requires Assigned Account and Assigned Dept.' };
  }

  const nextStatus = normalizeAssetStatus(
    payload.status,
    Math.max(0, asInt(asset.quantity, 0)),
    assignment.assignedToText,
    assignment.assignedAccount,
    assignment.assignedDept
  );

  const purchaseDate = text(payload.purchaseDate) ? new Date(payload.purchaseDate) : null;
  const updated = await prisma.asset.update({
    where: { id: asset.id },
    data: {
      assetTag: nextTag,
      serialNumber: text(payload.serialNumber) || null,
      itemModel: text(payload.itemModel),
      category: text(payload.category),
      status: nextStatus,
      location: /^ACC-/i.test(nextTag) ? null : text(payload.location) || null,
      purchaseDate: purchaseDate && !Number.isNaN(purchaseDate.getTime()) ? purchaseDate : null,
      vendorName: text(payload.vendorName) || null,
      purchasingYear: text(payload.purchasingYear) || null,
      orderNumber: text(payload.orderNumber) || null,
      invoiceNumber: text(payload.invoiceNumber) || null,
      ownerAccount: text(payload.ownerAccount) || null,
      ownerDepartment: text(payload.ownerDepartment) || null,
      assignedToText: assignment.assignedToText || null,
      assignedAccount: assignment.assignedAccount || null,
      assignedDept: assignment.assignedDept || null
    }
  });

  await appendAssetRevisionLog({
    assetId: asset.id,
    assetTag: updated.assetTag,
    itemModel: updated.itemModel,
    action: 'EDIT_ASSET',
    qtyBefore: Math.max(0, asInt(asset.quantity, 0)),
    qtyChange: 0,
    qtyAfter: Math.max(0, asInt(updated.quantity, 0)),
    remark: 'Asset master data updated.',
    actorEmail: assetMutationActor(actor),
    rawJson: {
      before: {
        assetTag: asset.assetTag,
        serialNumber: asset.serialNumber,
        itemModel: asset.itemModel,
        category: asset.category,
        status: asset.status,
        assignedToText: asset.assignedToText,
        assignedAccount: asset.assignedAccount,
        assignedDept: asset.assignedDept,
        ownerAccount: asset.ownerAccount,
        ownerDepartment: asset.ownerDepartment,
        location: asset.location
      },
      after: {
        assetTag: updated.assetTag,
        serialNumber: updated.serialNumber,
        itemModel: updated.itemModel,
        category: updated.category,
        status: updated.status,
        assignedToText: updated.assignedToText,
        assignedAccount: updated.assignedAccount,
        assignedDept: updated.assignedDept,
        ownerAccount: updated.ownerAccount,
        ownerDepartment: updated.ownerDepartment,
        location: updated.location
      }
    }
  });

  // Rebuild employee asset holdings snapshot so manual assignment/status changes are reflected immediately
  void triggerSnapshotRebuild();

  return {
    success: true,
    message: `Asset ${updated.assetTag} updated successfully.`,
    item: updated
  };
}

export async function createAssetRecord(payload: UpsertAssetPayload & { initialQuantity: number }, actor: AssetActor) {
  const tag = normalizeAssetTag(payload.assetTag);
  if (!tag) return { success: false, message: 'Asset tag is required.' };
  if (!text(payload.itemModel) || !text(payload.category)) {
    return { success: false, message: 'Item model and category are required.' };
  }

  const existing = await prisma.asset.findFirst({
    where: { assetTag: { equals: tag, mode: 'insensitive' } },
    select: { id: true }
  });
  if (existing) return { success: false, message: `Asset tag ${tag} already exists.` };

  const assignment = normalizeAssignment(payload);
  if (assignment.assignmentMode === 'sharing' && (!assignment.assignedAccount || !assignment.assignedDept)) {
    return { success: false, message: 'Sharing asset requires Assigned Account and Assigned Dept.' };
  }

  const qty = Math.max(0, Math.trunc(Number.isFinite(payload.initialQuantity) ? payload.initialQuantity : 1));
  const nextStatus = normalizeAssetStatus(
    payload.status,
    qty,
    assignment.assignedToText,
    assignment.assignedAccount,
    assignment.assignedDept
  );

  const purchaseDate = text(payload.purchaseDate) ? new Date(payload.purchaseDate) : null;
  const created = await prisma.asset.create({
    data: {
      assetTag: tag,
      serialNumber: text(payload.serialNumber) || null,
      itemModel: text(payload.itemModel),
      category: text(payload.category),
      quantity: qty || 1,
      status: nextStatus,
      location: /^ACC-/i.test(tag) ? null : text(payload.location) || null,
      purchaseDate: purchaseDate && !Number.isNaN(purchaseDate.getTime()) ? purchaseDate : null,
      vendorName: text(payload.vendorName) || null,
      purchasingYear: text(payload.purchasingYear) || null,
      orderNumber: text(payload.orderNumber) || null,
      invoiceNumber: text(payload.invoiceNumber) || null,
      ownerAccount: text(payload.ownerAccount) || null,
      ownerDepartment: text(payload.ownerDepartment) || null,
      assignedToText: assignment.assignedToText || null,
      assignedAccount: assignment.assignedAccount || null,
      assignedDept: assignment.assignedDept || null
    }
  });

  await appendAssetRevisionLog({
    assetId: created.id,
    assetTag: created.assetTag,
    itemModel: created.itemModel,
    action: 'CREATE_ASSET',
    qtyBefore: 0,
    qtyChange: created.quantity,
    qtyAfter: created.quantity,
    remark: 'Asset created manually.',
    actorEmail: assetMutationActor(actor),
    rawJson: {
      assetTag: created.assetTag,
      serialNumber: created.serialNumber,
      itemModel: created.itemModel,
      category: created.category,
      quantity: created.quantity,
      status: created.status,
      assignedToText: created.assignedToText,
      assignedAccount: created.assignedAccount,
      assignedDept: created.assignedDept,
      ownerAccount: created.ownerAccount,
      ownerDepartment: created.ownerDepartment,
      location: created.location
    }
  });

  void triggerSnapshotRebuild();

  return {
    success: true,
    message: `Asset ${created.assetTag} created successfully.`,
    item: created
  };
}

export async function deleteAssetRecord(assetTag: string, actor: AssetActor) {
  const tag = normalizeAssetTag(assetTag);
  if (!tag) return { success: false, message: 'Asset tag is required.' };

  const asset = await prisma.asset.findFirst({
    where: {
      assetTag: {
        equals: tag,
        mode: 'insensitive'
      }
    }
  });
  if (!asset) return { success: false, message: 'Asset not found.' };

  await appendAssetRevisionLog({
    assetId: asset.id,
    assetTag: asset.assetTag,
    itemModel: asset.itemModel,
    action: 'DELETE',
    qtyBefore: Math.max(0, asInt(asset.quantity, 0)),
    qtyChange: -Math.max(0, asInt(asset.quantity, 0)),
    qtyAfter: 0,
    remark: 'Asset row deleted.',
    actorEmail: assetMutationActor(actor),
    rawJson: {
      deleted: true
    }
  });

  await prisma.asset.delete({
    where: {
      id: asset.id
    }
  });

  return {
    success: true,
    message: `Asset ${asset.assetTag} deleted successfully.`
  };
}
