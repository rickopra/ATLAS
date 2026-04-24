import { prisma } from '../db.js';

type StructuredDepartment = {
  id: string;
  value: string;
  parentLink: string;
  key: string;
};

type StructuredAccountGroup = {
  id: string;
  account: string;
  key: string;
  departmentCount: number;
  departments: StructuredDepartment[];
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((entry) => text(entry)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function buildDesiredMasterReferenceRows(
  rows: Array<{
    account: string | null;
    department: string | null;
  }>
) {
  const desiredAccounts = new Set<string>();
  const departmentVotes = new Map<string, { value: string; votes: Map<string, { parent: string; count: number }> }>();

  for (const row of rows) {
    const rawAccount = text(row.account);
    const rawDepartment = text(row.department);
    const account = rawAccount || (rawDepartment ? 'General' : '');

    if (account) {
      desiredAccounts.add(account);
    }

    if (!rawDepartment) continue;

    const deptKey = lower(rawDepartment);
    if (!departmentVotes.has(deptKey)) {
      departmentVotes.set(deptKey, {
        value: rawDepartment,
        votes: new Map()
      });
    }

    const entry = departmentVotes.get(deptKey)!;
    const parent = account || 'General';
    const parentKey = lower(parent);
    const currentVote = entry.votes.get(parentKey) || { parent, count: 0 };
    currentVote.count += 1;
    entry.votes.set(parentKey, currentVote);
  }

  const desiredDepartments = [...departmentVotes.values()]
    .map((entry) => {
      const rankedParents = [...entry.votes.values()].sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return left.parent.localeCompare(right.parent);
      });
      const winner = rankedParents[0];
      return winner
        ? {
            value: entry.value,
            parentLink: winner.parent,
            key: `Department||${entry.value}||${winner.parent}`
          }
        : null;
    })
    .filter(Boolean) as Array<{
      value: string;
      parentLink: string;
      key: string;
    }>;

  const accounts = uniqueSorted([...desiredAccounts]).map((account) => ({
    value: account,
    parentLink: null as string | null,
    key: `Account||${account}||`
  }));

  const allAccountNames = new Set(accounts.map((entry) => entry.value));
  for (const department of desiredDepartments) {
    if (!allAccountNames.has(department.parentLink)) {
      accounts.push({
        value: department.parentLink,
        parentLink: null,
        key: `Account||${department.parentLink}||`
      });
      allAccountNames.add(department.parentLink);
    }
  }

  return {
    accounts: uniqueSorted(accounts.map((entry) => entry.value)).map((account) => ({
      type: 'Account',
      value: account,
      parentLink: null as string | null,
      key: `Account||${account}||`
    })),
    departments: desiredDepartments.sort((left, right) => {
      const parentCompare = left.parentLink.localeCompare(right.parentLink);
      if (parentCompare !== 0) return parentCompare;
      return left.value.localeCompare(right.value);
    }).map((entry) => ({
      type: 'Department',
      value: entry.value,
      parentLink: entry.parentLink,
      key: entry.key
    }))
  };
}

export async function syncMasterReferencesFromEmployeeDirectory() {
  const employees = await prisma.employee.findMany({
    select: {
      account: true,
      department: true
    }
  });

  const desired = buildDesiredMasterReferenceRows(employees);
  const replacementRows = [...desired.accounts, ...desired.departments];

  await prisma.$transaction(async (tx) => {
    await tx.masterReference.deleteMany({
      where: {
        type: {
          in: ['Account', 'Department']
        }
      }
    });

    if (replacementRows.length) {
      await tx.masterReference.createMany({
        data: replacementRows,
        skipDuplicates: true
      });
    }
  });

  return {
    success: true,
    source: 'employee-directory',
    accountCount: desired.accounts.length,
    departmentCount: desired.departments.length,
    syncedAt: new Date().toISOString()
  };
}

export async function getStructuredMasterReferences(search = '') {
  const rows = await prisma.masterReference.findMany({
    where: {
      type: {
        in: ['Account', 'Department']
      }
    },
    orderBy: [{ type: 'asc' }, { value: 'asc' }]
  });

  const normalizedSearch = lower(search);
  const accountRows = rows.filter((row) => row.type === 'Account');
  const departmentRows = rows.filter((row) => row.type === 'Department');

  const groups: StructuredAccountGroup[] = accountRows.map((row) => {
    const departments = departmentRows
      .filter((department) => text(department.parentLink) === row.value)
      .sort((left, right) => left.value.localeCompare(right.value))
      .map((department) => ({
        id: department.id,
        value: department.value,
        parentLink: text(department.parentLink),
        key: department.key
      }));

    return {
      id: row.id,
      account: row.value,
      key: row.key,
      departmentCount: departments.length,
      departments
    };
  });

  const filteredGroups = normalizedSearch
    ? groups.filter((group) => {
        if (lower(group.account).includes(normalizedSearch)) return true;
        return group.departments.some((department) => lower(department.value).includes(normalizedSearch));
      }).map((group) => ({
        ...group,
        departments: lower(group.account).includes(normalizedSearch)
          ? group.departments
          : group.departments.filter((department) => lower(department.value).includes(normalizedSearch)),
        departmentCount: lower(group.account).includes(normalizedSearch)
          ? group.departmentCount
          : group.departments.filter((department) => lower(department.value).includes(normalizedSearch)).length
      }))
    : groups;

  return {
    ok: true,
    source: 'employee-directory',
    syncedAt: new Date().toISOString(),
    accounts: uniqueSorted(groups.map((group) => group.account)),
    departments: uniqueSorted(groups.flatMap((group) => group.departments.map((department) => department.value))),
    groups: filteredGroups.sort((left, right) => left.account.localeCompare(right.account))
  };
}
