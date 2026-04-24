import type {
  AssetAssignmentLedgerEntry,
  Employee,
  EmployeeAssetHolding,
  HandoverDocument,
  HandoverItem,
  ProcurementRequest
} from '@prisma/client';
import { prisma } from '../db.js';
import { getStructuredMasterReferences } from './master-reference.js';

type JsonRecord = Record<string, unknown>;

type EmployeeMeta = {
  employeeKey: string;
  nik: string;
  fullName: string;
  email: string;
  account: string;
  dept: string;
  title: string;
};

type AssetHolder = {
  userName: string;
  userNIK: string;
  userEmail: string;
  account: string;
  dept: string;
  title: string;
  qty: number;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function normalizeAssetTag(value: unknown) {
  const normalized = text(value).toUpperCase();
  if (!normalized) return '';
  if (normalized === 'NO TAG' || normalized === 'NOTAG') return 'NO-TAG';
  return normalized;
}

function asInt(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.trunc(numeric);
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((entry) => text(entry)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function parseJsonRecord(value: unknown): JsonRecord | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as JsonRecord;
  } catch {}
  return null;
}

function toJsonString(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function formatIsoStamp(value: Date | string | number | null | undefined) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDisplayDateTime(value: Date | string | number | null | undefined) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatShare(units: number, total: number) {
  if (!total) return 0;
  return Number(((units / total) * 100).toFixed(1));
}

function maxDate(values: Array<Date | null | undefined>) {
  let latest: Date | null = null;
  for (const value of values) {
    if (!value || Number.isNaN(value.getTime())) continue;
    if (!latest || value > latest) latest = value;
  }
  return latest;
}

function candidateEmployeeKey(meta: Partial<EmployeeMeta>) {
  return text(meta.employeeKey || meta.nik || meta.email || meta.fullName);
}

function employeeCandidateScore(meta: EmployeeMeta, query: string) {
  const q = lower(query);
  if (!q) return 0;

  let score = 0;
  if (lower(meta.employeeKey) === q) score += 120;
  if (lower(meta.nik) === q) score += 110;
  if (lower(meta.email) === q) score += 100;
  if (lower(meta.fullName) === q) score += 95;
  if (lower(meta.fullName).startsWith(q)) score += 40;
  if (lower(meta.fullName).includes(q)) score += 20;
  if (lower(meta.email).includes(q)) score += 18;
  if (lower(meta.account).includes(q)) score += 8;
  if (lower(meta.dept).includes(q)) score += 8;
  return score;
}

function holdingMeta(row: Pick<EmployeeAssetHolding, 'employeeKey' | 'nik' | 'fullName' | 'email' | 'account' | 'department' | 'title'>): EmployeeMeta {
  return {
    employeeKey: text(row.employeeKey),
    nik: text(row.nik),
    fullName: text(row.fullName),
    email: text(row.email),
    account: text(row.account),
    dept: text(row.department),
    title: text(row.title)
  };
}

function ledgerMeta(row: Pick<AssetAssignmentLedgerEntry, 'holderKey' | 'nik' | 'fullName' | 'email' | 'account' | 'department'>): EmployeeMeta {
  return {
    employeeKey: text(row.holderKey),
    nik: text(row.nik),
    fullName: text(row.fullName),
    email: text(row.email),
    account: text(row.account),
    dept: text(row.department),
    title: ''
  };
}

function directoryEmployeeMeta(row: Pick<Employee, 'employeeCode' | 'email' | 'fullName' | 'title' | 'account' | 'department'>): EmployeeMeta {
  return {
    employeeKey: text(row.employeeCode || row.email || row.fullName),
    nik: text(row.employeeCode),
    fullName: text(row.fullName),
    email: text(row.email),
    account: text(row.account),
    dept: text(row.department),
    title: text(row.title)
  };
}

function matchesEmployee(meta: EmployeeMeta, row: Partial<EmployeeMeta> & { employeeKey?: string | null }) {
  const rowKey = lower(row.employeeKey);
  const rowNik = lower(row.nik);
  const rowEmail = lower(row.email);
  const rowName = lower(row.fullName);
  const keys = new Set([lower(meta.employeeKey), lower(meta.nik), lower(meta.email), lower(meta.fullName)].filter(Boolean));
  return Boolean(
    (rowKey && keys.has(rowKey)) ||
    (rowNik && keys.has(rowNik)) ||
    (rowEmail && keys.has(rowEmail)) ||
    (rowName && keys.has(rowName))
  );
}

async function resolveEmployeeMetaLoose(query: string) {
  const normalizedQuery = text(query);
  if (!normalizedQuery) return null;

  const [holdingCandidates, ledgerCandidates, directoryCandidates] = await Promise.all([
    prisma.employeeAssetHolding.findMany({
      where: {
        OR: [
          { employeeKey: { equals: normalizedQuery, mode: 'insensitive' } },
          { nik: { equals: normalizedQuery, mode: 'insensitive' } },
          { email: { equals: normalizedQuery.toLowerCase(), mode: 'insensitive' } },
          { fullName: { equals: normalizedQuery, mode: 'insensitive' } },
          { fullName: { contains: normalizedQuery, mode: 'insensitive' } }
        ]
      },
      select: {
        employeeKey: true,
        nik: true,
        fullName: true,
        email: true,
        account: true,
        department: true,
        title: true,
        updatedAt: true
      },
      take: 40
    }),
    prisma.assetAssignmentLedgerEntry.findMany({
      where: {
        OR: [
          { holderKey: { equals: normalizedQuery, mode: 'insensitive' } },
          { nik: { equals: normalizedQuery, mode: 'insensitive' } },
          { email: { equals: normalizedQuery.toLowerCase(), mode: 'insensitive' } },
          { fullName: { equals: normalizedQuery, mode: 'insensitive' } },
          { fullName: { contains: normalizedQuery, mode: 'insensitive' } }
        ]
      },
      select: {
        holderKey: true,
        nik: true,
        fullName: true,
        email: true,
        account: true,
        department: true,
        updatedAt: true
      },
      take: 40
    }),
    prisma.employee.findMany({
      where: {
        OR: [
          { employeeCode: { equals: normalizedQuery, mode: 'insensitive' } },
          { email: { equals: normalizedQuery.toLowerCase(), mode: 'insensitive' } },
          { fullName: { equals: normalizedQuery, mode: 'insensitive' } },
          { fullName: { contains: normalizedQuery, mode: 'insensitive' } }
        ]
      },
      select: {
        employeeCode: true,
        email: true,
        fullName: true,
        title: true,
        account: true,
        department: true,
        updatedAt: true
      },
      take: 40
    })
  ]);

  const candidateMap = new Map<string, { meta: EmployeeMeta; updatedAt: Date | null; score: number }>();
  for (const row of holdingCandidates) {
    const meta = holdingMeta(row);
    const key = candidateEmployeeKey(meta).toLowerCase();
    candidateMap.set(key, {
      meta,
      updatedAt: row.updatedAt || null,
      score: employeeCandidateScore(meta, normalizedQuery)
    });
  }

  for (const row of ledgerCandidates) {
    const meta = ledgerMeta(row);
    const key = candidateEmployeeKey(meta).toLowerCase();
    const score = employeeCandidateScore(meta, normalizedQuery);
    const existing = candidateMap.get(key);
    if (!existing || score > existing.score || ((row.updatedAt || null) && !existing.updatedAt)) {
      candidateMap.set(key, { meta, updatedAt: row.updatedAt || null, score });
    }
  }

  for (const row of directoryCandidates) {
    const meta = directoryEmployeeMeta(row);
    const key = candidateEmployeeKey(meta).toLowerCase();
    const score = employeeCandidateScore(meta, normalizedQuery);
    const existing = candidateMap.get(key);
    if (!existing || score > existing.score || ((row.updatedAt || null) && !existing.updatedAt)) {
      candidateMap.set(key, { meta, updatedAt: row.updatedAt || null, score });
    }
  }

  const ordered = [...candidateMap.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTs = a.updatedAt ? a.updatedAt.getTime() : 0;
    const bTs = b.updatedAt ? b.updatedAt.getTime() : 0;
    return bTs - aTs;
  });

  return ordered[0]?.meta || null;
}

function buildSnapshotState(lastSync: Date | null, latestSourceUpdate: Date | null, label: string) {
  const lastSyncMs = lastSync ? lastSync.getTime() : 0;
  const latestSourceMs = latestSourceUpdate ? latestSourceUpdate.getTime() : 0;
  const missing = !lastSync;
  const stale = Boolean(latestSourceMs && lastSyncMs && lastSyncMs < latestSourceMs);
  return {
    version: lastSyncMs || latestSourceMs || 0,
    lastSyncMs,
    stale,
    missing,
    reason: missing
      ? `${label} snapshot is not available in the current database.`
      : stale
        ? `${label} snapshot is older than the latest source update. Run a reconcile before relying on this view.`
        : ''
  };
}

function aggregateHandoverMode(doc: HandoverDocument) {
  const payload = parseJsonRecord(doc.payloadJson);
  const payloadMode = text(payload?.bastMode);
  if (payloadMode) return payloadMode.toUpperCase();
  if (doc.docNumber.toUpperCase().endsWith('-WFH')) return 'WFH';
  if (doc.docNumber.toUpperCase().endsWith('-WFO')) return 'WFO';
  return text(doc.mode);
}

function buildSharedDetail(item: Pick<HandoverItem, 'sharedAccount' | 'sharedDept'>) {
  return [text(item.sharedAccount) ? `Account: ${text(item.sharedAccount)}` : '', text(item.sharedDept) ? `Dept: ${text(item.sharedDept)}` : '']
    .filter(Boolean)
    .join(' • ');
}

function buildQtyDisplay(item: Pick<HandoverItem, 'direction' | 'quantity' | 'isBroken'>) {
  const qty = Math.max(1, asInt(item.quantity, 1));
  const direction = text(item.direction).toUpperCase();
  if (direction.startsWith('OUT')) return `-${qty}`;
  if (direction.startsWith('IN')) return item.isBroken ? '0' : `+${qty}`;
  return String(qty);
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value as unknown[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasHandoverSignature(payload: JsonRecord | null, who: 'IT' | 'USER') {
  if (!payload) return false;
  if (who === 'IT') {
    if (typeof payload.sigIT === 'string' && payload.sigIT.length > 100) return true;
    if (Array.isArray(payload.sigITData) && payload.sigITData.length > 0) return true;
    if (text(payload.sigITFileUrl) || text(payload.sigITFileId)) return true;
    return false;
  }

  if (typeof payload.sigUser === 'string' && payload.sigUser.length > 100) return true;
  if (Array.isArray(payload.sigUserData) && payload.sigUserData.length > 0) return true;
  if (text(payload.sigUserFileUrl) || text(payload.sigUserFileId)) return true;
  return false;
}

function normalizeAuditTrail(payload: JsonRecord | null, revisionHistory: unknown[]) {
  const events: Array<Record<string, unknown>> = [];
  const payloadAudit = Array.isArray(payload?.auditLog) ? (payload?.auditLog as unknown[]) : [];

  for (const entry of payloadAudit) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    events.push({
      ts: row.ts,
      by: row.by,
      action: row.action,
      label: text(row.action || row.event || 'Activity'),
      message: text(row.message || row.note || row.action || 'Activity logged')
    });
  }

  for (const entry of revisionHistory) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    if (Array.isArray(row.clientAudit)) {
      for (const nested of row.clientAudit) {
        if (!nested || typeof nested !== 'object') continue;
        const nestedRow = nested as Record<string, unknown>;
        events.push({
          ts: nestedRow.ts,
          by: nestedRow.by,
          action: nestedRow.action,
          label: text(nestedRow.action || 'Activity'),
          message: text(nestedRow.message || nestedRow.action || 'Activity logged')
        });
      }
    } else {
      events.push({
        ts: row.ts,
        by: row.by,
        action: row.action,
        label: text(row.action || row.event || 'Activity'),
        message: text(row.event || row.action || 'Activity logged')
      });
    }
  }

  const seen = new Set<string>();
  return events
    .filter((entry) => {
      const key = [text(entry.ts), text(entry.by), text(entry.action), text(entry.message)].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => new Date(text(right.ts)).getTime() - new Date(text(left.ts)).getTime());
}

function procurementRow(record: ProcurementRequest) {
  return [
    formatDisplayDateTime(record.requestTimestamp || record.createdAt),
    record.requestNumber,
    text(record.requestSource),
    text(record.sourceReference),
    text(record.processorEmail),
    record.itemSummary,
    String(record.quantity ?? 0),
    text(record.requestorName),
    text(record.fulfillment),
    text(record.referenceNo),
    text(record.status),
    text(record.notes),
    text(record.logText),
    text(record.statusRemark)
  ];
}

export async function getParityMasterReferences() {
  const result = await getStructuredMasterReferences();
  const structure: Record<string, string[]> = {};

  for (const group of result.groups || []) {
    structure[group.account] = uniqueSorted(group.departments.map((department) => department.value));
  }

  return {
    structure,
    accounts: uniqueSorted(result.accounts || []),
    departments: uniqueSorted(result.departments || [])
  };
}

export async function getParityHandoverDependencies() {
  const [masterRefs, holdings, catalog, locations, assets] = await Promise.all([
    getParityMasterReferences(),
    prisma.employeeAssetHolding.findMany({
      select: {
        account: true,
        department: true
      }
    }),
    prisma.catalogItem.findMany({
      orderBy: [{ category: 'asc' }, { sku: 'asc' }]
    }),
    prisma.masterLocation.findMany({
      orderBy: [{ location: 'asc' }, { floor: 'asc' }]
    }),
    prisma.asset.findMany({
      select: {
        itemModel: true,
        category: true,
        assetTag: true
      }
    })
  ]);

  const accountDeptMap: Record<string, string[]> = {};
  const accounts = [...masterRefs.accounts];
  const departments = [...masterRefs.departments];

  for (const [account, depts] of Object.entries(masterRefs.structure)) {
    accountDeptMap[account] = uniqueSorted(depts);
  }

  for (const row of holdings) {
    const account = text(row.account);
    const department = text(row.department);
    if (!account) continue;
    accounts.push(account);
    if (department) departments.push(department);
    if (!accountDeptMap[account]) accountDeptMap[account] = [];
    if (department) accountDeptMap[account].push(department);
  }

  const skuMetaMap: Record<string, { category: string; type: string; unit: string; isAccessory: boolean; autoRegistered?: boolean }> = {};
  const skuList: string[] = [];

  for (const row of catalog) {
    skuList.push(row.sku);
    skuMetaMap[row.sku] = {
      category: text(row.category),
      type: text(row.account),
      unit: text(row.specification),
      isAccessory: /^acc-/i.test(text(row.category)) || /accessories|accessory|aksesoris/i.test(text(row.category))
    };
  }

  const modelTagMap = new Map<string, { hasAccessoryish: number; hasTagged: number; category: string }>();
  for (const asset of assets) {
    const model = text(asset.itemModel);
    if (!model) continue;
    const current = modelTagMap.get(model) || { hasAccessoryish: 0, hasTagged: 0, category: text(asset.category) };
    if (/^ACC-/i.test(text(asset.assetTag)) || !text(asset.assetTag) || text(asset.assetTag) === '-' || normalizeAssetTag(asset.assetTag) === 'NO-TAG') {
      current.hasAccessoryish += 1;
    } else {
      current.hasTagged += 1;
    }
    modelTagMap.set(model, current);
  }

  for (const [model, stats] of modelTagMap.entries()) {
    const inferredAccessory = stats.hasTagged === 0 && stats.hasAccessoryish > 0;
    if (skuMetaMap[model]) {
      skuMetaMap[model].isAccessory = skuMetaMap[model].isAccessory || inferredAccessory;
      continue;
    }

    skuList.push(model);
    skuMetaMap[model] = {
      category: inferredAccessory ? 'Accessories' : (stats.category || 'General'),
      type: '',
      unit: '',
      isAccessory: inferredAccessory,
      autoRegistered: true
    };
  }

  const mappedLocations = locations.map((row) => ({
    location: row.location,
    floor: row.floor,
    label: row.floor ? `${row.location} - ${row.floor}` : row.location
  }));
  if (!mappedLocations.some((row) => lower(row.location) === 'e-building')) {
    mappedLocations.push({ location: 'E-Building', floor: '', label: 'E-Building' });
  }

  for (const account of Object.keys(accountDeptMap)) {
    accountDeptMap[account] = uniqueSorted(accountDeptMap[account]);
  }

  return {
    accounts: uniqueSorted(accounts),
    departments: uniqueSorted(departments),
    accountDeptMap,
    skuList: uniqueSorted(skuList),
    skuMetaMap,
    locations: mappedLocations.sort((a, b) => a.label.localeCompare(b.label))
  };
}

export async function getParityItamDashboardSummary(params?: { forceRefresh?: boolean }) {
  const forceRefresh = Boolean(params?.forceRefresh);
  const [assets, latestHoldings, latestLedger] = await Promise.all([
    prisma.asset.findMany({
      select: {
        quantity: true,
        status: true,
        assignedToText: true,
        assignedAccount: true,
        assignedDept: true,
        ownerAccount: true,
        ownerDepartment: true,
        purchaseDate: true,
        invoiceNumber: true,
        category: true,
        updatedAt: true
      }
    }),
    prisma.employeeAssetHolding.aggregate({
      _max: {
        updatedAt: true
      }
    }),
    prisma.assetAssignmentLedgerEntry.aggregate({
      _max: {
        updatedAt: true,
        transactionTimestamp: true
      }
    })
  ]);

  let totalUnits = 0;
  let allocatedUserUnits = 0;
  let allocatedSharedUnits = 0;
  let missingOwnerRows = 0;
  let missingPurchaseDateRows = 0;
  let inUseWithoutHolderRows = 0;
  let availableWithHolderRows = 0;
  let missingInvoiceRows = 0;

  const ownerAccountByUnits = new Map<string, number>();
  const sharedAccountByUnits = new Map<string, number>();
  const categoryByUnits = new Map<string, number>();
  const categories = new Set<string>();
  const latestAssetUpdatedAt = maxDate(assets.map((asset) => asset.updatedAt));

  for (const asset of assets) {
    const explicitQty = typeof asset.quantity === 'number' ? asset.quantity : 0;
    const hasAssignment = Boolean(text(asset.assignedToText) || text(asset.assignedAccount) || text(asset.assignedDept));
    const effectiveUnits = explicitQty > 0 ? explicitQty : hasAssignment ? 1 : 0;
    const ownerAccount = text(asset.ownerAccount) || 'Unspecified';
    const category = text(asset.category) || 'Unspecified';
    const status = lower(asset.status);
    const holder = text(asset.assignedToText);
    const sharedLabel = text(asset.assignedAccount) || text(asset.assignedDept) || 'Unspecified Shared';

    totalUnits += effectiveUnits;
    ownerAccountByUnits.set(ownerAccount, (ownerAccountByUnits.get(ownerAccount) || 0) + effectiveUnits);
    categoryByUnits.set(category, (categoryByUnits.get(category) || 0) + effectiveUnits);
    categories.add(category);

    if (text(asset.assignedAccount) || text(asset.assignedDept)) {
      allocatedSharedUnits += effectiveUnits;
      sharedAccountByUnits.set(sharedLabel, (sharedAccountByUnits.get(sharedLabel) || 0) + effectiveUnits);
    } else if (holder) {
      allocatedUserUnits += effectiveUnits;
    }

    if (!text(asset.ownerAccount) && !text(asset.ownerDepartment)) missingOwnerRows += 1;
    if (!asset.purchaseDate) missingPurchaseDateRows += 1;
    if (!text(asset.invoiceNumber)) missingInvoiceRows += 1;
    if ((status === 'in use' || status === 'assigned') && !holder && !text(asset.assignedAccount) && !text(asset.assignedDept)) inUseWithoutHolderRows += 1;
    if (status === 'available' && (holder || text(asset.assignedAccount) || text(asset.assignedDept))) availableWithHolderRows += 1;
  }

  const latestHoldingsAt = latestHoldings._max.updatedAt || null;
  const latestLedgerAt = maxDate([latestLedger._max.updatedAt || null, latestLedger._max.transactionTimestamp || null]);
  const notices: string[] = [];
  if (!assets.length) notices.push('Asset List snapshot is empty. Import or reconcile source data first.');
  if (!latestHoldingsAt) notices.push('Employee holdings snapshot is not available yet.');
  if (!latestLedgerAt) notices.push('Assignment ledger snapshot is not available yet.');
  if (latestAssetUpdatedAt && latestHoldingsAt && latestHoldingsAt < latestAssetUpdatedAt) {
    notices.push('Employee holdings snapshot may be stale compared with the latest asset source update.');
  }
  if (latestAssetUpdatedAt && latestLedgerAt && latestLedgerAt < latestAssetUpdatedAt) {
    notices.push('Assignment ledger snapshot may be stale compared with the latest asset source update.');
  }

  const toRank = (input: Map<string, number>, total: number) =>
    [...input.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, units]) => ({
        label,
        units,
        sharePct: formatShare(units, total)
      }));

  return {
    ok: true,
    generatedAt: formatIsoStamp(new Date()),
    source: forceRefresh ? 'database-refresh' : 'database-snapshot',
    snapshot: {
      totalUnits,
      totalRows: assets.length,
      allocatedUnits: allocatedUserUnits + allocatedSharedUnits,
      allocatedUserUnits,
      allocatedSharedUnits,
      ownerAccounts: ownerAccountByUnits.size,
      categories: categories.size,
      ownerAccountByUnits: toRank(ownerAccountByUnits, totalUnits),
      sharedAccountByUnits: toRank(sharedAccountByUnits, Math.max(allocatedSharedUnits, 1)),
      categoryByUnits: toRank(categoryByUnits, totalUnits)
    },
    dataQuality: {
      missingOwnerRows,
      missingPurchaseDateRows,
      inUseWithoutHolderRows,
      availableWithHolderRows,
      missingInvoiceRows,
      note: 'These counters help identify ownership, lifecycle, and allocation inconsistencies before they affect audit readiness or daily operations.'
    },
    health: {
      assetListLastSync: formatIsoStamp(latestAssetUpdatedAt),
      holdingsLastSync: formatIsoStamp(latestHoldingsAt),
      assignmentLedgerLastSync: formatIsoStamp(latestLedgerAt),
      notices
    }
  };
}

async function getCurrentAssetHolders(tag: string): Promise<AssetHolder[]> {
  const holdings = await prisma.employeeAssetHolding.findMany({
    where: {
      OR: [
        { assetRef: { equals: tag, mode: 'insensitive' } },
        { assetRef: { equals: normalizeAssetTag(tag), mode: 'insensitive' } }
      ]
    },
    select: {
      employeeKey: true,
      nik: true,
      fullName: true,
      email: true,
      account: true,
      department: true,
      title: true,
      quantity: true
    }
  });

  return holdings.map((row) => ({
    userName: text(row.fullName),
    userNIK: text(row.nik),
    userEmail: text(row.email),
    account: text(row.account),
    dept: text(row.department),
    title: text(row.title),
    qty: Math.max(1, asInt(row.quantity, 1))
  }));
}

export async function getParityAssetDetail(assetTag: string, options?: { includeHolders?: boolean }) {
  const tag = normalizeAssetTag(assetTag);
  if (!tag) {
    return { success: false, message: 'Asset Tag is required.' };
  }

  const asset = await prisma.asset.findFirst({
    where: {
      assetTag: {
        equals: tag,
        mode: 'insensitive'
      }
    }
  });

  if (!asset) {
    return { success: false, message: 'Asset Tag not found.' };
  }

  const includeHolders = options?.includeHolders !== false;
  const isAccessoryPoolAsset = /^ACC-/i.test(text(asset.assetTag)) || (!text(asset.serialNumber) && asInt(asset.quantity, 0) > 1);

  const [assignedMeta, handoverItems, revisions, currentHolders] = await Promise.all([
    text(asset.assignedToText) ? resolveEmployeeMetaLoose(text(asset.assignedToText)) : Promise.resolve(null),
    prisma.handoverItem.findMany({
      where: isAccessoryPoolAsset
        ? {
            OR: [
              { assetTag: { equals: tag, mode: 'insensitive' } },
              { itemName: { equals: text(asset.itemModel), mode: 'insensitive' } },
              { itemSku: { equals: text(asset.itemModel), mode: 'insensitive' } }
            ]
          }
        : {
            assetTag: {
              equals: tag,
              mode: 'insensitive'
            }
          },
      include: {
        handover: true
      }
    }),
    prisma.assetRevision.findMany({
      where: isAccessoryPoolAsset
        ? {
            OR: [
              { assetTag: { equals: tag, mode: 'insensitive' } },
              { itemModel: { equals: text(asset.itemModel), mode: 'insensitive' } }
            ]
          }
        : {
            assetTag: {
              equals: tag,
              mode: 'insensitive'
            }
          }
    }),
    includeHolders && !isAccessoryPoolAsset ? getCurrentAssetHolders(tag) : Promise.resolve([])
  ]);

  const history = handoverItems.map((item) => {
    const qty = Math.max(1, asInt(item.quantity, 1));
    return {
      timestamp: item.handover.transactionTimestamp?.toISOString() || item.handover.createdAt.toISOString(),
      docID: item.handover.docNumber,
      rowType: item.handover.transactionType,
      transType: item.handover.transactionType,
      userName: text(item.handover.holderName),
      userNIK: text(item.handover.holderNik),
      dept: text(item.handover.holderDepartment),
      itemType: text(item.direction),
      itemSku: text(item.itemSku || item.itemName),
      qty,
      qtyDelta: text(item.direction).toUpperCase().startsWith('OUT') ? -qty : (item.isBroken ? 0 : qty),
      qtyDisplay: buildQtyDisplay(item),
      notes: text(item.handover.notes),
      status: text(item.handover.status),
      pdfUrl: text(item.handover.pdfUrl),
      bastMode: aggregateHandoverMode(item.handover),
      signerIT: text(parseJsonRecord(item.handover.payloadJson)?.signerITName),
      signerUser: text(parseJsonRecord(item.handover.payloadJson)?.signerUserName || item.handover.holderName),
      isShared: item.isShared,
      isBroken: item.isBroken,
      sharedAccount: text(item.sharedAccount),
      sharedDept: text(item.sharedDept),
      sharedDetail: buildSharedDetail(item)
    };
  });

  for (const revision of revisions) {
    const qtyChange = revision.qtyChange ?? 0;
    history.push({
      timestamp: revision.createdAt.toISOString(),
      docID: text(revision.referenceId),
      rowType: 'REVISION',
      transType: 'REVISION',
      userName: text(revision.actorEmail),
      userNIK: '',
      dept: '',
      itemType: 'REVISION',
      itemSku: text(revision.itemModel) || 'Manual/Sync',
      qty: qtyChange,
      qtyDelta: qtyChange,
      qtyDisplay: qtyChange > 0 ? `+${qtyChange}` : String(qtyChange),
      notes: text(revision.remark),
      status: revision.qtyBefore !== null || revision.qtyAfter !== null
        ? `Qty ${revision.qtyBefore ?? '?'} → ${revision.qtyAfter ?? '?'}`
        : text(revision.action),
      pdfUrl: '',
      bastMode: '',
      signerIT: '',
      signerUser: '',
      isShared: false,
      isBroken: false,
      sharedAccount: '',
      sharedDept: '',
      sharedDetail: ''
    });
  }

  history.sort((a, b) => {
    const aTs = new Date(a.timestamp).getTime();
    const bTs = new Date(b.timestamp).getTime();
    return bTs - aTs;
  });

  const latestSharedHistory = history.find((entry) => entry.isShared);
  const assetPayload: JsonRecord = {
    tag: text(asset.assetTag),
    sn: text(asset.serialNumber),
    itemModel: text(asset.itemModel),
    category: text(asset.category),
    quantity: asInt(asset.quantity, 0),
    status: text(asset.status),
    assignedTo: text(asset.assignedToText),
    location: text(asset.location),
    purchaseDate: asset.purchaseDate?.toISOString() || '',
    invoice: text(asset.invoiceNumber),
    orderNumber: text(asset.orderNumber),
    vendor: text(asset.vendorName),
    purchasingYear: text(asset.purchasingYear),
    ramSize: text(asset.ramSize),
    ramType: text(asset.ramType),
    storageSize: text(asset.storageSize),
    storageType: text(asset.storageType),
    extVgaUsed: text(asset.externalVga),
    extVgaType: text(asset.externalVgaType),
    ownerAccount: text(asset.ownerAccount),
    ownerDept: text(asset.ownerDepartment),
    assetAccount: text(asset.ownerAccount),
    assetDepartment: text(asset.ownerDepartment),
    assignedAccount: text(asset.assignedAccount),
    assignedDept: text(asset.assignedDept),
    assignedMeta: assignedMeta
      ? {
          fullName: assignedMeta.fullName,
          nik: assignedMeta.nik,
          email: assignedMeta.email,
          account: assignedMeta.account,
          dept: assignedMeta.dept,
          title: assignedMeta.title
        }
      : null,
    currentHolders: currentHolders,
    currentHolderSummary: includeHolders
      ? {
          users: currentHolders.length,
          units: currentHolders.reduce((sum, entry) => sum + Math.max(1, asInt(entry.qty, 1)), 0),
          mode: isAccessoryPoolAsset ? 'hidden' : 'single'
        }
      : null,
    currentHoldersDeferred: false,
    hideCurrentHolder: isAccessoryPoolAsset
  };

  if (latestSharedHistory && (lower(asset.status) === 'in use' || text(asset.assignedToText))) {
    assetPayload.currentAssignmentHint = {
      isShared: true,
      sharedAccount: text(latestSharedHistory.sharedAccount),
      sharedDept: text(latestSharedHistory.sharedDept),
      source: 'HandoverDocument'
    };
  }

  return {
    success: true,
    asset: assetPayload,
    history
  };
}

export async function getParityAssetCurrentHolders(assetTag: string) {
  const detail = await getParityAssetDetail(assetTag, { includeHolders: true });
  if (!detail || detail.success === false) {
    return {
      ok: false,
      message: (detail as { message?: string } | undefined)?.message || 'Failed to load current holders.'
    };
  }

  const detailAsset = (detail as { asset?: JsonRecord }).asset || {};
  return {
    ok: true,
    asset: {
      tag: text(detailAsset.tag || normalizeAssetTag(assetTag))
    },
    currentHolders: Array.isArray(detailAsset.currentHolders) ? detailAsset.currentHolders : []
  };
}

export async function getParityEmployeeDirectoryDetail(query: string) {
  const employee = await resolveEmployeeMetaLoose(query);
  if (!employee) {
    return {
      success: false,
      message: 'Employee detail not found.'
    };
  }

  // Build all match keys for this employee to query Asset.assignedToText
  // assignedToText is stored as "Name (NIK)" so we need contains to match the name/nik substring
  const empMatchValues = [employee.fullName, employee.email, employee.nik, employee.employeeKey].filter(Boolean);

  const [holdings, directAssets] = await Promise.all([
    prisma.employeeAssetHolding.findMany({
      orderBy: [{ updatedAt: 'desc' }, { fullName: 'asc' }]
    }),
    // Also query Asset table directly — covers assets assigned without a BAST document
    // assignedToText format is "Name (NIK)" — use contains (case-insensitive) to match name or NIK
    prisma.asset.findMany({
      where: {
        OR: empMatchValues.map((val) => ({
          assignedToText: { contains: val, mode: 'insensitive' as const }
        }))
      },
      select: {
        assetTag: true,
        itemModel: true,
        category: true,
        quantity: true,
        location: true,
        status: true,
        updatedAt: true,
        assignedToText: true
      }
    })
  ]);

  const filtered = holdings.filter((row) => matchesEmployee(employee, holdingMeta(row)));

  // Merge: BAST-derived holdings take precedence; fill gaps from Asset table
  const coveredTags = new Set(filtered.map((row) => normalizeAssetTag(row.assetRef)));
  const directHoldings = directAssets
    .filter((asset) => {
      if (coveredTags.has(normalizeAssetTag(asset.assetTag))) return false;
      // Exclude shared asset placeholders ("Shared Asset [Account: X]")
      if (lower(text(asset.assignedToText)).startsWith('shared asset')) return false;
      return true;
    })
    .map((asset) => ({
      tag: normalizeAssetTag(asset.assetTag),
      assetRef: normalizeAssetTag(asset.assetTag),
      itemModel: text(asset.itemModel),
      category: text(asset.category),
      qty: asInt(asset.quantity, 1),
      location: text(asset.location),
      status: text(asset.status) || 'In Use',
      _directAssigned: true
    }));

  const lastSync = maxDate(filtered.map((row) => row.updatedAt || null));
  // Compare only against assets relevant to this employee (directAssets), not all assets globally.
  // Using global MAX caused false-positive stale warnings whenever any unrelated asset was edited.
  const relevantAssetUpdatedAt = maxDate(directAssets.map((a) => a.updatedAt || null));
  const snapshotState = buildSnapshotState(lastSync, relevantAssetUpdatedAt, 'Employee holdings');

  const bastHoldings = filtered.map((row) => ({
    tag: normalizeAssetTag(row.assetRef),
    assetRef: text(row.assetRef),
    itemModel: text(row.itemModel),
    category: text(row.category),
    qty: asInt(row.quantity, 0),
    location: text(row.location),
    status: text(row.status),
    _directAssigned: false
  }));

  const payloadHoldings = [...bastHoldings, ...directHoldings];

  return {
    success: true,
    employee: {
      employeeKey: employee.employeeKey,
      nik: employee.nik,
      fullName: employee.fullName,
      email: employee.email,
      account: employee.account,
      dept: employee.dept,
      title: employee.title
    },
    holdings: payloadHoldings,
    summary: {
      totalDistinct: payloadHoldings.length,
      totalUnits: payloadHoldings.reduce((sum, row) => sum + Math.max(0, asInt(row.qty, 0)), 0)
    },
    historySummary: [],
    historyEvents: [],
    historyMeta: {
      assetsTouched: 0,
      eventCount: 0,
      countableEventCount: 0
    },
    historyLoaded: false,
    historyDeferred: true,
    snapshotState,
    syncRecommended: Boolean(snapshotState.stale),
    ...(snapshotState.stale
      ? { message: snapshotState.reason || 'Employee holdings snapshot is not fresh.' }
      : {})
  };
}

export async function getParityEmployeeDirectoryHistoryDetail(query: string, eventLimit?: number) {
  const employee = await resolveEmployeeMetaLoose(query);
  if (!employee) {
    return {
      success: false,
      message: 'Employee history not found.'
    };
  }

  let limit = asInt(eventLimit, 250);
  if (limit < 50) limit = 50;
  if (limit > 500) limit = 500;

  const whereClauses: Array<Record<string, unknown>> = [];
  if (employee.nik) whereClauses.push({ holderNik: employee.nik });
  if (employee.email) whereClauses.push({ holderEmail: employee.email.toLowerCase() });
  if (employee.fullName) whereClauses.push({ holderName: employee.fullName });

  const documents = await prisma.handoverDocument.findMany({
    where: whereClauses.length ? { OR: whereClauses } : undefined,
    include: {
      items: true
    },
    orderBy: [{ transactionTimestamp: 'desc' }, { createdAt: 'desc' }]
  });

  const events = documents.flatMap((doc) => doc.items.map((item) => ({
    tsIso: doc.transactionTimestamp?.toISOString() || doc.createdAt.toISOString(),
    transType: text(doc.transactionType),
    direction: text(item.direction).toUpperCase().startsWith('IN')
      ? 'IN'
      : (text(item.direction).toUpperCase().startsWith('OUT') ? 'OUT' : text(item.direction).toUpperCase()),
    tag: normalizeAssetTag(item.assetTag),
    assetRef: text(item.assetTag || item.itemName),
    itemModel: text(item.itemSku || item.itemName),
    category: '',
    qty: Math.max(1, asInt(item.quantity, 1)),
    location: text(item.dutyLocation),
    docId: text(doc.docNumber),
    status: text(doc.status),
    pdfUrl: text(doc.pdfUrl)
  })));

  events.sort((a, b) => new Date(b.tsIso).getTime() - new Date(a.tsIso).getTime());
  const limitedEvents = events.slice(0, limit);

  const summaryMap = new Map<string, {
    tag: string;
    assetRef: string;
    itemModel: string;
    category: string;
    firstOutAt: string;
    lastInAt: string;
    currentSince: string;
    currentState: string;
    balance: number;
  }>();

  const chronological = [...events].sort((a, b) => new Date(a.tsIso).getTime() - new Date(b.tsIso).getTime());
  for (const event of chronological) {
    const key = text(event.assetRef || event.itemModel || 'UNKNOWN');
    const current = summaryMap.get(key) || {
      tag: event.tag,
      assetRef: event.assetRef,
      itemModel: event.itemModel,
      category: event.category,
      firstOutAt: '',
      lastInAt: '',
      currentSince: '',
      currentState: 'Returned',
      balance: 0
    };

    if (event.direction === 'OUT') {
      current.balance += Math.max(1, asInt(event.qty, 1));
      if (!current.firstOutAt) current.firstOutAt = event.tsIso;
      if (current.balance > 0) current.currentSince = event.tsIso;
      current.currentState = 'Assigned';
    } else if (event.direction === 'IN') {
      current.balance = Math.max(0, current.balance - Math.max(1, asInt(event.qty, 1)));
      current.lastInAt = event.tsIso;
      if (current.balance === 0) current.currentState = 'Returned';
    }

    summaryMap.set(key, current);
  }

  const historySummary = [...summaryMap.values()]
    .map((entry) => ({
      tag: entry.tag,
      assetRef: entry.assetRef,
      itemModel: entry.itemModel,
      category: entry.category,
      firstOutAt: entry.firstOutAt,
      lastInAt: entry.lastInAt,
      currentSince: entry.balance > 0 ? entry.currentSince : '',
      currentState: entry.balance > 0 ? 'Assigned' : 'Returned'
    }))
    .sort((a, b) => {
      const aTs = a.currentSince ? new Date(a.currentSince).getTime() : 0;
      const bTs = b.currentSince ? new Date(b.currentSince).getTime() : 0;
      return bTs - aTs;
    });

  return {
    success: true,
    employee: {
      employeeKey: employee.employeeKey,
      nik: employee.nik,
      fullName: employee.fullName,
      email: employee.email,
      account: employee.account,
      dept: employee.dept,
      title: employee.title
    },
    historySummary,
    historyEvents: limitedEvents,
    historyMeta: {
      assetsTouched: historySummary.length,
      eventCount: events.length,
      countableEventCount: events.length
    },
    historyLoaded: true
  };
}

export async function getParityHandoverDetail(docNumber: string) {
  const normalizedDoc = text(docNumber);
  if (!normalizedDoc) {
    return {
      success: false,
      message: 'Document number is required.'
    };
  }

  const document = await prisma.handoverDocument.findFirst({
    where: {
      docNumber: {
        equals: normalizedDoc,
        mode: 'insensitive'
      }
    },
    include: {
      items: {
        orderBy: [{ createdAt: 'asc' }, { itemName: 'asc' }]
      }
    }
  });

  if (!document) {
    return {
      success: false,
      message: 'Handover document not found.'
    };
  }

  const payload = parseJsonRecord(document.payloadJson);
  const revisionHistory = parseJsonArray(document.revisionHistoryJson);
  const payloadItems = Array.isArray(payload?.items) ? (payload?.items as Array<Record<string, unknown>>) : [];
  const items = payloadItems.length
    ? payloadItems.map((item) => ({
        direction: text(item.type),
        assetTag: normalizeAssetTag(item.tag),
        itemName: text(item.sku || item.itemName),
        itemSku: text(item.sku || item.itemName),
        quantity: Math.max(1, asInt(item.qty, 1)),
        isShared: Boolean(item.isShared || item.shared || item.sharedAsset),
        isBroken: Boolean(item.isBroken || item.broken || lower(item.condition) === 'broken'),
        sharedAccount: text(item.sharedAccount || item.assignedAccount),
        sharedDept: text(item.sharedDept || item.assignedDept),
        sharedDetail: [text(item.sharedAccount || item.assignedAccount) ? `Account: ${text(item.sharedAccount || item.assignedAccount)}` : '', text(item.sharedDept || item.assignedDept) ? `Dept: ${text(item.sharedDept || item.assignedDept)}` : '']
          .filter(Boolean)
          .join(' • '),
        assignmentLabel: Boolean(item.isShared || item.shared || item.sharedAsset)
          ? [text(item.sharedAccount || item.assignedAccount) ? `Account: ${text(item.sharedAccount || item.assignedAccount)}` : '', text(item.sharedDept || item.assignedDept) ? `Dept: ${text(item.sharedDept || item.assignedDept)}` : '']
              .filter(Boolean)
              .join(' • ') || 'Sharing asset'
          : (Boolean(item.isBroken || item.broken || lower(item.condition) === 'broken')
              ? 'Returned in broken condition. Stock will not be restored.'
              : 'Standard assignment')
      }))
    : document.items.map((item) => ({
        direction: text(item.direction),
        assetTag: normalizeAssetTag(item.assetTag),
        itemName: text(item.itemName),
        itemSku: text(item.itemSku || item.itemName),
        quantity: Math.max(1, asInt(item.quantity, 1)),
        isShared: item.isShared,
        isBroken: item.isBroken,
        sharedAccount: text(item.sharedAccount),
        sharedDept: text(item.sharedDept),
        sharedDetail: buildSharedDetail(item),
        assignmentLabel: item.isShared
          ? (buildSharedDetail(item) || 'Sharing asset')
          : (item.isBroken ? 'Returned in broken condition. Stock will not be restored.' : 'Standard assignment')
      }));

  const handover = {
    docNumber: text(document.docNumber),
    mode: aggregateHandoverMode(document),
    transactionType: text(document.transactionType),
    status: text(document.status),
    holderName: text(document.holderName || payload?.userName),
    holderNik: text(document.holderNik || payload?.userNIK),
    holderEmail: text(document.holderEmail || payload?.userEmail),
    holderDepartment: text(document.holderDepartment || payload?.userDept),
    userAccount: text(document.userAccount || payload?.userAcc),
    notes: text(document.notes || payload?.notes),
    dutyLocation: text(payload?.dutyLocation),
    dutyLocationLabel: text(payload?.dutyLocationLabel || payload?.dutyLocation),
    pdfUrl: text(document.pdfUrl || payload?.pdfUrl),
    signerITName: text(payload?.signerITName),
    signerITEmail: text(payload?.signerITEmail),
    signerUserName: text(payload?.signerUserName),
    signerUserEmail: text(payload?.signerUserEmail),
    signerUserLabel: text(payload?.signerUserLabel || payload?.userName || document.holderName),
    transactionTimestamp: document.transactionTimestamp?.toISOString() || document.createdAt.toISOString()
  };

  const resumePayload = {
    docID: text(document.docNumber),
    bastMode: text(payload?.bastMode || aggregateHandoverMode(document)),
    manualEntry: Boolean(payload?.manualEntry),
    holderMode: text(payload?.holderMode || 'EMPLOYEE_DB'),
    userName: text(payload?.userName || document.holderName),
    userNIK: text(payload?.userNIK || document.holderNik),
    userEmail: text(payload?.userEmail || document.holderEmail),
    userAcc: text(payload?.userAcc || document.userAccount),
    userDept: text(payload?.userDept || document.holderDepartment),
    dutyLocationSite: text(payload?.dutyLocationSite),
    dutyLocationFloor: text(payload?.dutyLocationFloor),
    dutyLocationLabel: text(payload?.dutyLocationLabel || payload?.dutyLocation),
    transType: text(document.transactionType),
    notes: text(payload?.notes || document.notes),
    userSigType: text(payload?.userSigType || 'RECIPIENT'),
    repName: text(payload?.repName),
    itSignerName: text(payload?.itSignerName || payload?.signerITName),
    items: items.map((item) => ({
      type: text(item.direction),
      tag: text(item.assetTag),
      sku: text(item.itemSku || item.itemName),
      qty: Math.max(1, asInt(item.quantity, 1)),
      isBroken: Boolean(item.isBroken),
      isShared: Boolean(item.isShared),
      sharedAccount: text(item.sharedAccount),
      sharedDept: text(item.sharedDept)
    }))
  };

  return {
    success: true,
    handover,
    resumeState: {
      canResume: lower(document.status) === 'on hold',
      strictMode: lower(document.status) === 'on hold',
      itSigned: hasHandoverSignature(payload, 'IT'),
      userSigned: hasHandoverSignature(payload, 'USER')
    },
    resumePayload,
    items,
    signatures: {
      it: {
        signed: hasHandoverSignature(payload, 'IT'),
        email: text(payload?.signerITEmail),
        label: text(payload?.signerITName || payload?.signerITEmail),
        fileUrl: text(payload?.sigITFileUrl),
        inlineDataUrl: typeof payload?.sigIT === 'string' ? payload.sigIT : ''
      },
      user: {
        signed: hasHandoverSignature(payload, 'USER'),
        email: text(payload?.signerUserEmail || document.holderEmail),
        label: text(payload?.signerUserLabel || payload?.signerUserName || payload?.userName || document.holderName),
        fileUrl: text(payload?.sigUserFileUrl),
        inlineDataUrl: typeof payload?.sigUser === 'string' ? payload.sigUser : ''
      }
    },
    auditTrail: normalizeAuditTrail(payload, revisionHistory),
    revisionHistory: revisionHistory.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
  };
}

export async function getParityHandoverHistory() {
  const docs = await prisma.handoverDocument.findMany({
    orderBy: [{ transactionTimestamp: 'desc' }, { createdAt: 'desc' }]
  });

  return docs.map((doc) => [
    doc.transactionTimestamp?.toISOString() || doc.createdAt.toISOString(),
    doc.docNumber,
    doc.transactionType,
    text(doc.holderName),
    text(doc.holderNik),
    text(doc.holderDepartment),
    text(doc.rawItemsText),
    text(doc.notes),
    text(doc.status),
    text(doc.pdfUrl),
    toJsonString(doc.payloadJson),
    toJsonString(doc.revisionHistoryJson)
  ]);
}

export async function getParityProcurementRows(view: 'monitoring' | 'archive') {
  const rows = await prisma.procurementRequest.findMany({
    where: {
      isArchived: view === 'archive'
    },
    orderBy: [{ requestTimestamp: 'desc' }, { createdAt: 'desc' }]
  });

  return rows.map(procurementRow);
}

export async function checkParityAssetTagExistence(tag: string) {
  const normalized = normalizeAssetTag(tag);
  if (!normalized) return { exists: false };

  const asset = await prisma.asset.findFirst({
    where: {
      assetTag: {
        equals: normalized,
        mode: 'insensitive'
      }
    },
    select: {
      assetTag: true,
      itemModel: true,
      serialNumber: true
    }
  });

  if (!asset) return { exists: false };
  return {
    exists: true,
    name: text(asset.itemModel),
    sn: text(asset.serialNumber)
  };
}
