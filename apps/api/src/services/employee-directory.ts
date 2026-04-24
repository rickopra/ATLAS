import { env, googleWorkspaceDirectoryReadiness } from '../config.js';
import { prisma } from '../db.js';

type EmployeeDirectoryParams = {
  search: string;
  page: number;
  pageSize: number;
};

type DirectoryEmployeeRecord = {
  employeeCode: string;
  email: string;
  fullName: string;
  title: string;
  account: string;
  department: string;
  isActive: boolean | null;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function pickPreferred(...values: Array<unknown>) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return '';
}

function numericUnits(value: unknown) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 1;
}

function deriveDirectoryStatus(title: unknown, isActive: boolean | null, isDirectoryLinked: boolean) {
  const normalizedTitle = text(title);
  if (normalizedTitle) return normalizedTitle;
  if (isActive === false) return 'Inactive';
  if (isDirectoryLinked) return 'Active';
  return 'Active';
}

function buildDirectoryKeys(values: Array<unknown>) {
  return [...new Set(values.map((value) => lower(value)).filter(Boolean))];
}

function findDirectoryRecord(
  directoryIndex: Map<string, DirectoryEmployeeRecord>,
  values: Array<unknown>
) {
  for (const key of buildDirectoryKeys(values)) {
    const found = directoryIndex.get(key);
    if (found) return found;
  }
  return null;
}

function pageMeta(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize))
  };
}

export async function listEmployeeDirectory(params: EmployeeDirectoryParams) {
  const searchTerm = lower(params.search);
  const [rows, employeeRows] = await Promise.all([
    prisma.employeeAssetHolding.findMany({
      orderBy: [{ fullName: 'asc' }, { employeeKey: 'asc' }],
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
    }),
    prisma.employee.findMany({
      orderBy: [{ fullName: 'asc' }, { email: 'asc' }],
      select: {
        employeeCode: true,
        email: true,
        fullName: true,
        title: true,
        account: true,
        department: true,
        isActive: true
      }
    })
  ]);

  const directoryRecords = employeeRows.map((row) => ({
    employeeCode: text(row.employeeCode),
    email: lower(row.email),
    fullName: text(row.fullName),
    title: text(row.title),
    account: text(row.account),
    department: text(row.department),
    isActive: typeof row.isActive === 'boolean' ? row.isActive : null
  }));

  const directoryIndex = new Map<string, DirectoryEmployeeRecord>();
  for (const record of directoryRecords) {
    for (const key of buildDirectoryKeys([record.email, record.employeeCode, record.fullName])) {
      directoryIndex.set(key, record);
    }
  }

  const grouped = new Map<string, {
    queryKey: string;
    employeeKey: string;
    nik: string;
    fullName: string;
    email: string;
    account: string;
    department: string;
    title: string;
    statusLabel: string;
    assetCount: number;
    assetRows: number;
    source: string;
    isDirectoryLinked: boolean;
    isActive: boolean | null;
  }>();

  for (const row of rows) {
    const email = text(row.email).toLowerCase();
    const employeeKey = text(row.employeeKey);
    const nik = text(row.nik);
    const fullName = text(row.fullName);
    const account = text(row.account);
    const department = text(row.department);
    const title = text(row.title);
    const directoryRecord = findDirectoryRecord(directoryIndex, [email, employeeKey, nik, fullName]);
    const resolvedEmployeeKey = pickPreferred(directoryRecord?.employeeCode, employeeKey, email, nik, fullName);
    const resolvedNik = pickPreferred(directoryRecord?.employeeCode, nik, employeeKey);
    const resolvedFullName = pickPreferred(directoryRecord?.fullName, fullName, employeeKey, email);
    const resolvedEmail = pickPreferred(directoryRecord?.email, email);
    const resolvedAccount = pickPreferred(directoryRecord?.account, account);
    const resolvedDepartment = pickPreferred(directoryRecord?.department, department);
    const resolvedTitle = pickPreferred(directoryRecord?.title, title);
    const isDirectoryLinked = Boolean(directoryRecord);
    const isActive = directoryRecord?.isActive ?? null;
    const statusLabel = deriveDirectoryStatus(resolvedTitle, isActive, isDirectoryLinked);

    // Normalize identity key: prefer email (canonical) so holding rows and directory rows
    // merge correctly even when the holding was imported with only a name (no email/NIK).
    const queryKey = pickPreferred(resolvedEmail, email, employeeKey, nik, fullName);
    const identityKey = lower(queryKey);
    if (!identityKey) continue;

    const searchable = [
      resolvedEmployeeKey,
      resolvedNik,
      resolvedFullName,
      resolvedEmail,
      resolvedAccount,
      resolvedDepartment,
      resolvedTitle,
      statusLabel
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (searchTerm && !searchable.includes(searchTerm)) continue;

    const existing = grouped.get(identityKey);
    if (existing) {
      existing.employeeKey = pickPreferred(existing.employeeKey, resolvedEmployeeKey, employeeKey, email, nik, fullName);
      existing.nik = pickPreferred(existing.nik, resolvedNik, nik);
      existing.fullName = pickPreferred(existing.fullName, resolvedFullName, fullName, employeeKey);
      existing.email = pickPreferred(existing.email, resolvedEmail, email);
      existing.account = pickPreferred(existing.account, resolvedAccount, account);
      existing.department = pickPreferred(existing.department, resolvedDepartment, department);
      existing.title = pickPreferred(existing.title, resolvedTitle, title);
      existing.statusLabel = deriveDirectoryStatus(existing.title, existing.isActive ?? isActive, existing.isDirectoryLinked || isDirectoryLinked);
      existing.assetCount += numericUnits(row.quantity);
      existing.assetRows += 1;
      existing.isDirectoryLinked = existing.isDirectoryLinked || isDirectoryLinked;
      existing.isActive = existing.isActive ?? isActive;
      existing.source = existing.isDirectoryLinked ? 'employee-directory' : existing.source;
      continue;
    }

    grouped.set(identityKey, {
      queryKey,
      employeeKey: resolvedEmployeeKey,
      nik: resolvedNik,
      fullName: resolvedFullName,
      email: resolvedEmail,
      account: resolvedAccount,
      department: resolvedDepartment,
      title: resolvedTitle,
      statusLabel,
      assetCount: numericUnits(row.quantity),
      assetRows: 1,
      source: isDirectoryLinked ? 'employee-directory' : 'atlas-holdings-snapshot',
      isDirectoryLinked,
      isActive
    });
  }

  for (const record of directoryRecords) {
    const queryKey = pickPreferred(record.email, record.employeeCode, record.fullName);
    const identityKey = lower(queryKey);
    if (!identityKey || grouped.has(identityKey)) continue;

    const statusLabel = deriveDirectoryStatus(record.title, record.isActive, true);
    const searchable = [
      record.employeeCode,
      record.fullName,
      record.email,
      record.account,
      record.department,
      record.title,
      statusLabel
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (searchTerm && !searchable.includes(searchTerm)) continue;

    grouped.set(identityKey, {
      queryKey,
      employeeKey: pickPreferred(record.employeeCode, record.email, record.fullName),
      nik: record.employeeCode,
      fullName: pickPreferred(record.fullName, record.email, record.employeeCode),
      email: record.email,
      account: record.account,
      department: record.department,
      title: record.title,
      statusLabel,
      assetCount: 0,
      assetRows: 0,
      source: 'employee-directory',
      isDirectoryLinked: true,
      isActive: record.isActive
    });
  }

  const items = [...grouped.values()].sort((left, right) => {
    const nameSort = left.fullName.localeCompare(right.fullName);
    if (nameSort !== 0) return nameSort;
    return left.employeeKey.localeCompare(right.employeeKey);
  });

  const total = items.length;
  const start = (params.page - 1) * params.pageSize;
  const paged = items.slice(start, start + params.pageSize);

  return {
    ok: true,
    meta: pageMeta(params.page, params.pageSize, total),
      directory: {
        provider: employeeRows.length ? 'atlas-holdings-plus-employee-directory' : 'atlas-holdings-snapshot',
        futureProvider: 'google-workspace-directory',
        googleWorkspaceReady: googleWorkspaceDirectoryReadiness.enabled && googleWorkspaceDirectoryReadiness.clientReady,
        hostedDomain: env.GOOGLE_HOSTED_DOMAIN,
        identityMode: 'email-preferred'
      },
    items: paged
  };
}
