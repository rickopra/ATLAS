import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

export type NewPoSheet = 'ASSET' | 'ACCESSORIES';

type ListNewPoEntriesParams = {
  sheet: NewPoSheet;
  search: string;
  page: number;
  pageSize: number;
};

type NewPoOptionsAccountGroup = {
  account: string;
  departments: string[];
};

type ActorMeta = {
  email?: string | null;
  fullName?: string | null;
  roles?: string[];
};

type UpdateNewPoEntryPayload = {
  itemName?: string | null;
  serialNumber?: string | null;
  barcode?: string | null;
  category?: string | null;
  quantity?: string | number | null;
  remarkFor?: string | null;
  invoiceNumber?: string | null;
  orderNumber?: string | null;
  account?: string | null;
  department?: string | null;
  remark?: string | null;
};

type BulkUpdateNewPoEntryPayload = {
  id: string;
  patch: UpdateNewPoEntryPayload;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function nullableText(value: unknown) {
  const normalized = text(value);
  return normalized ? normalized : null;
}

function asInt(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function normalizeSheet(value: unknown): NewPoSheet {
  return String(value || '').trim().toUpperCase() === 'ACCESSORIES' ? 'ACCESSORIES' : 'ASSET';
}

function makePageMeta(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize))
  };
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((entry) => text(entry)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function slugify(value: string) {
  return text(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildAccessoryTag(itemName: string) {
  const core = slugify(itemName || 'ITEM') || 'ITEM';
  return core.startsWith('ACC-') ? core : `ACC-${core}`;
}

function assetStatusForQty(quantity: number) {
  return quantity > 0 ? 'Available' : 'Out of Stock';
}

function purchasingYearFromOrder(orderNumber: string, fallback: Date) {
  const match = text(orderNumber).match(/(20\d{2})/);
  return match?.[1] || String(fallback.getFullYear());
}

function actorEmail(actor: ActorMeta) {
  return text(actor.email || actor.fullName || 'system');
}

function requiredFields(sheet: NewPoSheet) {
  if (sheet === 'ACCESSORIES') {
    return ['itemName', 'quantity', 'remarkFor', 'orderNumber'] as const;
  }

  return ['itemName', 'serialNumber', 'barcode', 'category', 'quantity', 'orderNumber'] as const;
}

function labelForField(field: string) {
  switch (field) {
    case 'itemName':
      return 'Item';
    case 'serialNumber':
      return 'Serial Number';
    case 'barcode':
      return 'Barcode';
    case 'category':
      return 'Category';
    case 'quantity':
      return 'Quantity';
    case 'remarkFor':
      return 'Remark For';
    case 'orderNumber':
      return 'PO';
    default:
      return field;
  }
}

function getMissingFields(entry: {
  sheetName: string;
  itemName?: string | null;
  serialNumber?: string | null;
  barcode?: string | null;
  category?: string | null;
  quantity?: number | null;
  remarkFor?: string | null;
  orderNumber?: string | null;
}) {
  const sheet = normalizeSheet(entry.sheetName);
  const missing: string[] = [];
  for (const field of requiredFields(sheet)) {
    if (field === 'quantity') {
      const qty = asInt(entry.quantity);
      if (qty === null || qty <= 0) missing.push(field);
      continue;
    }

    if (!text(entry[field])) missing.push(field);
  }

  if (sheet === 'ASSET' && asInt(entry.quantity) !== 1) {
    if (!missing.includes('quantity')) missing.push('quantity');
  }

  return missing;
}

async function appendRevisionLog(input: {
  assetId?: string | null;
  assetTag: string;
  itemModel: string;
  action: string;
  qtyBefore: number;
  qtyChange: number;
  qtyAfter: number;
  remark: string;
  actorEmail: string;
  referenceId: string;
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
      source: 'NEW_PO_LIVE',
      actorEmail: input.actorEmail,
      referenceId: input.referenceId,
      rawJson: input.rawJson || {}
    }
  });
}

async function setEntrySyncState(entryId: string, input: {
  syncStatus: string;
  syncNote: string;
  syncedAssetId?: string | null;
  syncedAssetTag?: string | null;
  syncedQuantity?: number | null;
  lastSyncedAt?: Date | null;
}) {
  return prisma.newPoEntry.update({
    where: { id: entryId },
    data: {
      syncStatus: input.syncStatus,
      syncNote: input.syncNote,
      syncedAssetId: input.syncedAssetId === undefined ? undefined : input.syncedAssetId,
      syncedAssetTag: input.syncedAssetTag === undefined ? undefined : input.syncedAssetTag,
      syncedQuantity: input.syncedQuantity === undefined ? undefined : input.syncedQuantity,
      lastSyncedAt: input.lastSyncedAt === undefined ? undefined : input.lastSyncedAt
    }
  });
}

async function syncAssetEntry(entry: Awaited<ReturnType<typeof prisma.newPoEntry.findUniqueOrThrow>>, actor: ActorMeta) {
  const missing = getMissingFields(entry);
  if (missing.length) {
    return setEntrySyncState(entry.id, {
      syncStatus: entry.syncedAssetId ? 'SYNCED' : 'PENDING',
      syncNote: entry.syncedAssetId
        ? `Live asset already linked. Complete ${missing.map(labelForField).join(', ')} to continue updating.`
        : `Waiting for ${missing.map(labelForField).join(', ')} before this row can enter List Asset.`,
      syncedAssetId: entry.syncedAssetId,
      syncedAssetTag: entry.syncedAssetTag,
      syncedQuantity: entry.syncedQuantity,
      lastSyncedAt: entry.lastSyncedAt
    });
  }

  const barcode = text(entry.barcode).toUpperCase();
  const quantity = asInt(entry.quantity) ?? 0;
  if (quantity !== 1) {
    return setEntrySyncState(entry.id, {
      syncStatus: 'BLOCKED',
      syncNote: 'Asset rows must contain quantity 1 because each device must map to one barcode and one serial number.',
      syncedAssetId: entry.syncedAssetId,
      syncedAssetTag: entry.syncedAssetTag,
      syncedQuantity: entry.syncedQuantity
    });
  }

  const linkedAsset = entry.syncedAssetId
    ? await prisma.asset.findUnique({ where: { id: entry.syncedAssetId } })
    : null;
  const conflictingAsset = await prisma.asset.findFirst({
    where: {
      assetTag: {
        equals: barcode,
        mode: 'insensitive'
      },
      ...(linkedAsset ? { id: { not: linkedAsset.id } } : {})
    }
  });

  if (conflictingAsset) {
    return setEntrySyncState(entry.id, {
      syncStatus: 'BLOCKED',
      syncNote: `Barcode ${barcode} already exists in List Asset. Resolve the conflict before continuing.`,
      syncedAssetId: entry.syncedAssetId,
      syncedAssetTag: entry.syncedAssetTag,
      syncedQuantity: entry.syncedQuantity
    });
  }

  const now = new Date();
  const actorLabel = actorEmail(actor);
  const payload = {
    assetTag: barcode,
    serialNumber: text(entry.serialNumber) || null,
    itemModel: text(entry.itemName),
    category: text(entry.category),
    quantity: 1,
    status: linkedAsset?.status || 'Available',
    location: linkedAsset?.location || null,
    purchaseDate: linkedAsset?.purchaseDate || null,
    invoiceNumber: text(entry.invoiceNumber) || null,
    orderNumber: text(entry.orderNumber) || null,
    vendorName: linkedAsset?.vendorName || null,
    purchasingYear: purchasingYearFromOrder(text(entry.orderNumber), now),
    ramSize: linkedAsset?.ramSize || null,
    ramType: linkedAsset?.ramType || null,
    storageSize: linkedAsset?.storageSize || null,
    storageType: linkedAsset?.storageType || null,
    externalVga: linkedAsset?.externalVga || null,
    externalVgaType: linkedAsset?.externalVgaType || null,
    ownerAccount: text(entry.account) || null,
    ownerDepartment: text(entry.department) || null,
    assignedToText: linkedAsset?.assignedToText || null,
    assignedAccount: linkedAsset?.assignedAccount || null,
    assignedDept: linkedAsset?.assignedDept || null
  };

  const syncedAsset = linkedAsset
    ? await prisma.asset.update({
        where: { id: linkedAsset.id },
        data: payload
      })
    : await prisma.asset.create({
        data: payload
      });

  if (!linkedAsset) {
    await appendRevisionLog({
      assetId: syncedAsset.id,
      assetTag: syncedAsset.assetTag,
      itemModel: syncedAsset.itemModel,
      action: 'NEW_PO_CREATE',
      qtyBefore: 0,
      qtyChange: 1,
      qtyAfter: 1,
      remark: 'Asset auto-created from New PO live intake.',
      actorEmail: actorLabel,
      referenceId: entry.id,
      rawJson: {
        sheet: 'ASSET',
        orderNumber: entry.orderNumber,
        invoiceNumber: entry.invoiceNumber
      }
    });
  }

  return setEntrySyncState(entry.id, {
    syncStatus: 'SYNCED',
    syncNote: `Live in List Asset as ${syncedAsset.assetTag}. Procurement and IT Ops can keep refining this row without resubmitting.`,
    syncedAssetId: syncedAsset.id,
    syncedAssetTag: syncedAsset.assetTag,
    syncedQuantity: 1,
    lastSyncedAt: now
  });
}

async function adjustAccessoryAsset(assetTag: string, qtyDelta: number, payload: {
  itemName: string;
  category: string;
  orderNumber?: string | null;
  invoiceNumber?: string | null;
  account?: string | null;
  department?: string | null;
}, entryId: string, actor: ActorMeta) {
  const existing = await prisma.asset.findFirst({
    where: {
      assetTag: {
        equals: assetTag,
        mode: 'insensitive'
      }
    }
  });

  const actorLabel = actorEmail(actor);

  if (!existing) {
    const quantity = Math.max(0, qtyDelta);
    const created = await prisma.asset.create({
      data: {
        assetTag,
        serialNumber: null,
        itemModel: payload.itemName,
        category: payload.category || 'Accessories',
        quantity,
        status: assetStatusForQty(quantity),
        location: null,
        purchaseDate: null,
        invoiceNumber: payload.invoiceNumber || null,
        orderNumber: payload.orderNumber || null,
        vendorName: null,
        purchasingYear: purchasingYearFromOrder(text(payload.orderNumber), new Date()),
        ownerAccount: payload.account || null,
        ownerDepartment: payload.department || null,
        assignedToText: null,
        assignedAccount: null,
        assignedDept: null
      }
    });

    if (quantity !== 0) {
      await appendRevisionLog({
        assetId: created.id,
        assetTag: created.assetTag,
        itemModel: created.itemModel,
        action: 'NEW_PO_ACCESSORY_CREATE',
        qtyBefore: 0,
        qtyChange: quantity,
        qtyAfter: quantity,
        remark: 'Accessory pool created from New PO live intake.',
        actorEmail: actorLabel,
        referenceId: entryId,
        rawJson: {
          sheet: 'ACCESSORIES'
        }
      });
    }

    return created;
  }

  const qtyBefore = Math.max(0, asInt(existing.quantity) ?? 0);
  const qtyAfter = Math.max(0, qtyBefore + qtyDelta);
  const updated = await prisma.asset.update({
    where: { id: existing.id },
    data: {
      itemModel: payload.itemName,
      category: payload.category || existing.category || 'Accessories',
      quantity: qtyAfter,
      status: assetStatusForQty(qtyAfter),
      invoiceNumber: payload.invoiceNumber || existing.invoiceNumber || null,
      orderNumber: payload.orderNumber || existing.orderNumber || null,
      ownerAccount: payload.account || existing.ownerAccount || null,
      ownerDepartment: payload.department || existing.ownerDepartment || null,
      purchasingYear: purchasingYearFromOrder(text(payload.orderNumber || existing.orderNumber), new Date())
    }
  });

  if (qtyDelta !== 0) {
    await appendRevisionLog({
      assetId: updated.id,
      assetTag: updated.assetTag,
      itemModel: updated.itemModel,
      action: 'NEW_PO_ACCESSORY_SYNC',
      qtyBefore,
      qtyChange: qtyDelta,
      qtyAfter,
      remark: 'Accessory quantity adjusted from New PO live intake.',
      actorEmail: actorLabel,
      referenceId: entryId,
      rawJson: {
        sheet: 'ACCESSORIES'
      }
    });
  }

  return updated;
}

async function syncAccessoriesEntry(entry: Awaited<ReturnType<typeof prisma.newPoEntry.findUniqueOrThrow>>, actor: ActorMeta) {
  const missing = getMissingFields(entry);
  if (missing.length) {
    return setEntrySyncState(entry.id, {
      syncStatus: entry.syncedAssetId ? 'SYNCED' : 'PENDING',
      syncNote: entry.syncedAssetId
        ? `Accessory stock already linked. Complete ${missing.map(labelForField).join(', ')} to continue updating.`
        : `Waiting for ${missing.map(labelForField).join(', ')} before stock can flow into List Asset.`,
      syncedAssetId: entry.syncedAssetId,
      syncedAssetTag: entry.syncedAssetTag,
      syncedQuantity: entry.syncedQuantity,
      lastSyncedAt: entry.lastSyncedAt
    });
  }

  const itemName = text(entry.itemName);
  const quantity = Math.max(0, asInt(entry.quantity) ?? 0);
  const nextAssetTag = buildAccessoryTag(itemName);
  const previousTag = text(entry.syncedAssetTag).toUpperCase();
  const previousQty = Math.max(0, asInt(entry.syncedQuantity) ?? 0);

  if (previousTag && previousTag !== nextAssetTag) {
    await adjustAccessoryAsset(previousTag, -previousQty, {
      itemName,
      category: text(entry.category) || 'Accessories',
      orderNumber: entry.orderNumber,
      invoiceNumber: entry.invoiceNumber,
      account: entry.account,
      department: entry.department
    }, entry.id, actor);
  }

  const delta = previousTag === nextAssetTag ? quantity - previousQty : quantity;
  const syncedAsset = await adjustAccessoryAsset(nextAssetTag, delta, {
    itemName,
    category: text(entry.category) || 'Accessories',
    orderNumber: entry.orderNumber,
    invoiceNumber: entry.invoiceNumber,
    account: entry.account,
    department: entry.department
  }, entry.id, actor);

  return setEntrySyncState(entry.id, {
    syncStatus: 'SYNCED',
    syncNote: delta === 0
      ? `Linked to ${syncedAsset.assetTag}. No quantity delta from the previous save.`
      : `Stock synced to ${syncedAsset.assetTag} (${delta > 0 ? '+' : ''}${delta}).`,
    syncedAssetId: syncedAsset.id,
    syncedAssetTag: syncedAsset.assetTag,
    syncedQuantity: quantity,
    lastSyncedAt: new Date()
  });
}

async function reconcileEntry(entryId: string, actor: ActorMeta) {
  const entry = await prisma.newPoEntry.findUniqueOrThrow({ where: { id: entryId } });
  const synced = normalizeSheet(entry.sheetName) === 'ACCESSORIES'
    ? await syncAccessoriesEntry(entry, actor)
    : await syncAssetEntry(entry, actor);
  return prisma.newPoEntry.findUniqueOrThrow({ where: { id: synced.id } });
}

function toSafeSyncErrorMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return 'Duplicate value detected while syncing to List Asset.';
    }
    if (error.code === 'P2025') {
      return 'Referenced asset record was not found during sync.';
    }
    return `Database sync error (${error.code}).`;
  }

  if (error instanceof Error && text(error.message)) {
    return error.message;
  }

  return 'Unexpected sync error.';
}

async function reconcileEntrySafely(entryId: string, actor: ActorMeta) {
  try {
    return await reconcileEntry(entryId, actor);
  } catch (error) {
    const existing = await prisma.newPoEntry.findUnique({ where: { id: entryId } });
    if (!existing) {
      throw error;
    }

    const sheet = normalizeSheet(existing.sheetName);
    const barcode = text(existing.barcode).toUpperCase();
    const safeMessage = toSafeSyncErrorMessage(error);

    const syncNote = sheet === 'ASSET' && barcode
      ? `Sync blocked for barcode ${barcode}. ${safeMessage}`
      : `Sync blocked. ${safeMessage}`;

    const blocked = await setEntrySyncState(existing.id, {
      syncStatus: 'BLOCKED',
      syncNote,
      syncedAssetId: existing.syncedAssetId,
      syncedAssetTag: existing.syncedAssetTag,
      syncedQuantity: existing.syncedQuantity,
      lastSyncedAt: existing.lastSyncedAt
    });

    return prisma.newPoEntry.findUniqueOrThrow({ where: { id: blocked.id } });
  }
}

function toEntryOutput(entry: Awaited<ReturnType<typeof prisma.newPoEntry.findUniqueOrThrow>>) {
  const sheet = normalizeSheet(entry.sheetName);
  const missing = getMissingFields(entry);
  const required = requiredFields(sheet).map((field) => ({
    key: field,
    label: labelForField(field)
  }));
  const readiness = Math.max(0, required.length - missing.length);

  return {
    id: entry.id,
    sheetName: sheet,
    displayOrder: entry.displayOrder,
    itemName: text(entry.itemName),
    serialNumber: text(entry.serialNumber),
    barcode: text(entry.barcode),
    category: text(entry.category),
    quantity: asInt(entry.quantity),
    remarkFor: text(entry.remarkFor),
    invoiceNumber: text(entry.invoiceNumber),
    orderNumber: text(entry.orderNumber),
    account: text(entry.account),
    department: text(entry.department),
    remark: text(entry.remark),
    generatedTag: sheet === 'ACCESSORIES' && text(entry.itemName) ? buildAccessoryTag(text(entry.itemName)) : '',
    syncStatus: text(entry.syncStatus) || 'DRAFT',
    syncNote: text(entry.syncNote),
    syncedAssetId: text(entry.syncedAssetId),
    syncedAssetTag: text(entry.syncedAssetTag),
    syncedQuantity: asInt(entry.syncedQuantity),
    lastSyncedAt: entry.lastSyncedAt?.toISOString() || '',
    createdByEmail: text(entry.createdByEmail),
    updatedByEmail: text(entry.updatedByEmail),
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    requiredFields: required,
    missingFields: missing.map((field) => ({
      key: field,
      label: labelForField(field)
    })),
    readinessPct: required.length ? Math.round((readiness / required.length) * 100) : 100,
    isReady: missing.length === 0
  };
}

export async function listNewPoEntries(params: ListNewPoEntriesParams) {
  const q = text(params.search);
  const where = {
    sheetName: params.sheet,
    ...(q
      ? {
          OR: [
            { itemName: { contains: q, mode: 'insensitive' as const } },
            { serialNumber: { contains: q, mode: 'insensitive' as const } },
            { barcode: { contains: q, mode: 'insensitive' as const } },
            { category: { contains: q, mode: 'insensitive' as const } },
            { orderNumber: { contains: q, mode: 'insensitive' as const } },
            { invoiceNumber: { contains: q, mode: 'insensitive' as const } },
            { remarkFor: { contains: q, mode: 'insensitive' as const } },
            { account: { contains: q, mode: 'insensitive' as const } },
            { department: { contains: q, mode: 'insensitive' as const } },
            { syncNote: { contains: q, mode: 'insensitive' as const } }
          ]
        }
      : {})
  };

  const [total, rows, counts] = await Promise.all([
    prisma.newPoEntry.count({ where }),
    prisma.newPoEntry.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { updatedAt: 'desc' }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize
    }),
    prisma.newPoEntry.groupBy({
      by: ['sheetName', 'syncStatus'],
      _count: {
        _all: true
      }
    })
  ]);

  const summary = {
    asset: {
      total: 0,
      draft: 0,
      pending: 0,
      blocked: 0,
      synced: 0
    },
    accessories: {
      total: 0,
      draft: 0,
      pending: 0,
      blocked: 0,
      synced: 0
    }
  };

  for (const item of counts) {
    const bucket = item.sheetName === 'ACCESSORIES' ? summary.accessories : summary.asset;
    bucket.total += item._count._all;
    const status = lower(item.syncStatus);
    if (status === 'draft') bucket.draft += item._count._all;
    else if (status === 'pending') bucket.pending += item._count._all;
    else if (status === 'blocked') bucket.blocked += item._count._all;
    else if (status === 'synced') bucket.synced += item._count._all;
  }

  return {
    ok: true,
    meta: makePageMeta(params.page, params.pageSize, total),
    summary,
    items: rows.map((row) => toEntryOutput(row))
  };
}

export async function createNewPoEntry(sheet: NewPoSheet, actor: ActorMeta) {
  const result = await prisma.newPoEntry.aggregate({
    where: { sheetName: sheet },
    _max: {
      displayOrder: true
    }
  });

  const created = await prisma.newPoEntry.create({
    data: {
      sheetName: sheet,
      displayOrder: (result._max.displayOrder || 0) + 10,
      quantity: sheet === 'ASSET' ? 1 : null,
      category: sheet === 'ACCESSORIES' ? 'Accessories' : null,
      syncStatus: 'DRAFT',
      syncNote: 'Draft row created. Start typing and the row will save automatically.',
      createdByEmail: actorEmail(actor),
      updatedByEmail: actorEmail(actor)
    }
  });

  const synced = await reconcileEntrySafely(created.id, actor);
  return {
    ok: true,
    item: toEntryOutput(synced)
  };
}

export async function createNewPoEntries(sheet: NewPoSheet, count: number, actor: ActorMeta) {
  const safeCount = Math.max(1, Math.min(2000, Math.trunc(Number(count) || 1)));
  const actorLabel = actorEmail(actor);

  const { createdRows } = await prisma.$transaction(async (tx) => {
    const result = await tx.newPoEntry.aggregate({
      where: { sheetName: sheet },
      _max: {
        displayOrder: true
      }
    });

    const startOrder = (result._max.displayOrder || 0) + 10;
    const rows = Array.from({ length: safeCount }, (_, index) => ({
      sheetName: sheet,
      displayOrder: startOrder + (index * 10),
      quantity: sheet === 'ASSET' ? 1 : null,
      category: sheet === 'ACCESSORIES' ? 'Accessories' : null,
      syncStatus: 'DRAFT',
      syncNote: 'Draft row created. Start typing and the row will save automatically.',
      createdByEmail: actorLabel,
      updatedByEmail: actorLabel
    }));

    await tx.newPoEntry.createMany({
      data: rows
    });

    const createdRows = await tx.newPoEntry.findMany({
      where: {
        sheetName: sheet,
        displayOrder: {
          gte: startOrder,
          lte: startOrder + ((safeCount - 1) * 10)
        },
        createdByEmail: actorLabel
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      take: safeCount
    });

    return { createdRows };
  });

  return {
    ok: true,
    items: createdRows.map((row) => toEntryOutput(row)),
    count: createdRows.length
  };
}

export async function listNewPoOptions() {
  const [catalogItems, masterRefs] = await Promise.all([
    prisma.catalogItem.findMany({
      select: {
        sku: true,
        category: true
      },
      orderBy: [{ category: 'asc' }, { sku: 'asc' }]
    }),
    prisma.masterReference.findMany({
      where: {
        type: {
          in: ['Account', 'Department']
        }
      },
      select: {
        type: true,
        value: true,
        parentLink: true
      },
      orderBy: [{ type: 'asc' }, { value: 'asc' }]
    })
  ]);

  const itemOptions = uniqueSorted(catalogItems.map((item) => item.sku)).map((name) => {
    const match = catalogItems.find((row) => lower(row.sku) === lower(name));
    return {
      name,
      category: text(match?.category)
    };
  });

  const categoryOptions = uniqueSorted(catalogItems.map((item) => item.category));

  const accountRows = masterRefs.filter((entry) => entry.type === 'Account');
  const departmentRows = masterRefs.filter((entry) => entry.type === 'Department');

  const accountDeptMap: Record<string, string[]> = {};
  for (const account of uniqueSorted(accountRows.map((row) => row.value))) {
    accountDeptMap[account] = uniqueSorted(
      departmentRows
        .filter((dept) => text(dept.parentLink) === account)
        .map((dept) => dept.value)
    );
  }

  const accountGroups: NewPoOptionsAccountGroup[] = Object.keys(accountDeptMap)
    .sort((a, b) => a.localeCompare(b))
    .map((account) => ({
      account,
      departments: accountDeptMap[account]
    }));

  return {
    ok: true,
    catalog: {
      items: itemOptions,
      categories: categoryOptions
    },
    masterReference: {
      accounts: uniqueSorted(accountRows.map((row) => row.value)),
      departments: uniqueSorted(departmentRows.map((row) => row.value)),
      accountDeptMap,
      groups: accountGroups
    }
  };
}

export async function deleteNewPoEntry(entryId: string, actor: ActorMeta) {
  const entry = await prisma.newPoEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    throw new Error('New PO row not found.');
  }

  await prisma.newPoEntry.delete({ where: { id: entryId } });
  return {
    ok: true,
    deletedId: entryId,
    deletedBy: actorEmail(actor)
  };
}

export async function deleteNewPoEntries(entryIds: string[], actor: ActorMeta) {
  const ids = [...new Set((Array.isArray(entryIds) ? entryIds : []).map((id) => text(id)).filter(Boolean))];
  if (!ids.length) {
    return {
      ok: true,
      deletedIds: [] as string[],
      deletedCount: 0,
      requestedCount: 0,
      notFoundIds: [] as string[],
      deletedBy: actorEmail(actor)
    };
  }

  const existing = await prisma.newPoEntry.findMany({
    where: { id: { in: ids } },
    select: { id: true }
  });
  const existingIds = existing.map((row) => row.id);

  if (existingIds.length) {
    await prisma.newPoEntry.deleteMany({
      where: {
        id: {
          in: existingIds
        }
      }
    });
  }

  const existingIdSet = new Set(existingIds);
  const notFoundIds = ids.filter((id) => !existingIdSet.has(id));

  return {
    ok: true,
    deletedIds: existingIds,
    deletedCount: existingIds.length,
    requestedCount: ids.length,
    notFoundIds,
    deletedBy: actorEmail(actor)
  };
}

export async function updateNewPoEntry(entryId: string, payload: UpdateNewPoEntryPayload, actor: ActorMeta) {
  await prisma.newPoEntry.findUniqueOrThrow({ where: { id: entryId } });

  await prisma.newPoEntry.update({
    where: { id: entryId },
    data: {
      itemName: payload.itemName === undefined ? undefined : nullableText(payload.itemName),
      serialNumber: payload.serialNumber === undefined ? undefined : nullableText(payload.serialNumber),
      barcode: payload.barcode === undefined ? undefined : nullableText(text(payload.barcode).toUpperCase()),
      category: payload.category === undefined ? undefined : nullableText(payload.category),
      quantity: payload.quantity === undefined ? undefined : asInt(payload.quantity),
      remarkFor: payload.remarkFor === undefined ? undefined : nullableText(payload.remarkFor),
      invoiceNumber: payload.invoiceNumber === undefined ? undefined : nullableText(payload.invoiceNumber),
      orderNumber: payload.orderNumber === undefined ? undefined : nullableText(payload.orderNumber),
      account: payload.account === undefined ? undefined : nullableText(payload.account),
      department: payload.department === undefined ? undefined : nullableText(payload.department),
      remark: payload.remark === undefined ? undefined : nullableText(payload.remark),
      updatedByEmail: actorEmail(actor)
    }
  });

  const synced = await reconcileEntrySafely(entryId, actor);
  return {
    ok: true,
    item: toEntryOutput(synced)
  };
}

export async function updateNewPoEntries(updates: BulkUpdateNewPoEntryPayload[], actor: ActorMeta) {
  const normalized = updates
    .map((entry) => ({
      id: text(entry.id),
      patch: entry.patch || {}
    }))
    .filter((entry) => entry.id && Object.keys(entry.patch).length > 0);

  const items: Array<ReturnType<typeof toEntryOutput> extends infer T ? T : never> = [];
  const errors: Array<{ id: string; message: string }> = [];

  for (const entry of normalized) {
    try {
      const result = await updateNewPoEntry(entry.id, entry.patch, actor);
      items.push(result.item);
    } catch (error) {
      const current = await prisma.newPoEntry.findUnique({ where: { id: entry.id } });
      const message = toSafeSyncErrorMessage(error);
      errors.push({ id: entry.id, message });

      if (!current) {
        continue;
      }

      const blocked = await setEntrySyncState(current.id, {
        syncStatus: 'BLOCKED',
        syncNote: `Save blocked. ${message}`,
        syncedAssetId: current.syncedAssetId,
        syncedAssetTag: current.syncedAssetTag,
        syncedQuantity: current.syncedQuantity,
        lastSyncedAt: current.lastSyncedAt
      });
      const latest = await prisma.newPoEntry.findUniqueOrThrow({ where: { id: blocked.id } });
      items.push(toEntryOutput(latest));
    }
  }

  return {
    ok: true,
    items,
    count: items.length,
    failedCount: errors.length,
    errors
  };
}