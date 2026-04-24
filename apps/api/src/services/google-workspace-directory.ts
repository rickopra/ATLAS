import fs from 'node:fs';
import { createSign } from 'node:crypto';
import { env, googleWorkspaceDirectoryReadiness } from '../config.js';
import { prisma } from '../db.js';
import { syncMasterReferencesFromEmployeeDirectory } from './master-reference.js';
import { triggerSnapshotRebuild } from './handover-submit.js';

type JsonRecord = Record<string, unknown>;

type ServiceAccountKey = {
  type?: string;
  project_id?: string;
  private_key_id?: string;
  private_key?: string;
  client_email?: string;
  client_id?: string;
  token_uri?: string;
};

type ExistingEmployee = {
  id: string;
  employeeCode: string;
  email: string;
  fullName: string;
  title: string;
  account: string;
  department: string;
  isActive: boolean;
};

type DirectoryUserNormalized = {
  email: string;
  fullName: string;
  employeeCode: string;
  title: string;
  account: string;
  department: string;
  isActive: boolean;
  sourceType: string;
};

const DIRECTORY_SCOPE = 'https://www.googleapis.com/auth/admin.directory.user.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERS_URL = 'https://admin.googleapis.com/admin/directory/v1/users';
const ACCESS_TOKEN_TTL_MS = 50 * 60 * 1000;

let cachedKey: ServiceAccountKey | null = null;
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function bool(value: unknown) {
  return value === true;
}

function asRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return null;
}

function asRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => asRecord(entry)).filter(Boolean) as JsonRecord[]
    : [];
}

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString('base64url');
}

function pickPreferred(...values: Array<unknown>) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return '';
}

function keyPath() {
  return text(env.GOOGLE_WORKSPACE_DIRECTORY_KEY_FILE);
}

function readServiceAccountKey() {
  if (cachedKey) return cachedKey;

  const filePath = keyPath();
  if (!filePath) {
    throw new Error('Google Workspace Directory key file path is not configured.');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Google Workspace Directory key file was not found at ${filePath}.`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as ServiceAccountKey;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Google Workspace Directory service account JSON is missing client_email or private_key.');
  }
  cachedKey = parsed;
  return parsed;
}

function buildJwtAssertion(key: ServiceAccountKey) {
  const serviceAccountEmail = text(env.GOOGLE_WORKSPACE_DIRECTORY_SERVICE_ACCOUNT_EMAIL || key.client_email);
  const delegatedAdminEmail = text(env.GOOGLE_WORKSPACE_DIRECTORY_DELEGATED_ADMIN_EMAIL);
  const privateKey = text(key.private_key);
  if (!privateKey) {
    throw new Error('Google Workspace Directory service account private key is missing.');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: serviceAccountEmail,
    sub: delegatedAdminEmail,
    scope: DIRECTORY_SCOPE,
    aud: key.token_uri || TOKEN_URL,
    iat: now,
    exp: now + 3600
  };

  const unsigned = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(JSON.stringify(claim))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function getAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }

  const key = readServiceAccountKey();
  const assertion = buildJwtAssertion(key);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const payload = await response.json().catch(async () => ({ error: await response.text() }));
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new Error(`Google Workspace token request failed (${response.status}).`);
  }

  const accessToken = text((payload as JsonRecord).access_token);
  if (!accessToken) {
    throw new Error(`Google Workspace token response did not include an access token.`);
  }

  const expiresIn = Number((payload as JsonRecord).expires_in) || 3600;
  cachedAccessToken = {
    token: accessToken,
    expiresAt: Date.now() + Math.max(300, expiresIn - 60) * 1000
  };
  return accessToken;
}

function pickPrimaryOrganization(user: JsonRecord) {
  const organizations = asRecordArray(user.organizations);
  return (
    organizations.find((entry) => entry.primary === true) ||
    organizations[0] ||
    null
  );
}

function pickCustomSchemaValue(user: JsonRecord, fieldNames: string[]) {
  const schemaName = text(env.GOOGLE_WORKSPACE_DIRECTORY_CUSTOM_SCHEMA || 'ATLAS');
  const customSchemas = asRecord(user.customSchemas);
  const schema = customSchemas ? asRecord(customSchemas[schemaName]) : null;
  if (!schema) return '';

  for (const fieldName of fieldNames) {
    const direct = text(schema[fieldName]);
    if (direct) return direct;

    const record = asRecord(schema[fieldName]);
    const candidate = record ? pickPreferred(record.value, record.stringValue) : '';
    if (candidate) return candidate;
  }

  return '';
}

function pickEmployeeCode(user: JsonRecord) {
  const direct = pickPreferred(
    pickCustomSchemaValue(user, ['nik', 'employee_id', 'employeeId'])
  );
  if (direct) return direct;

  const externalIds = asRecordArray(user.externalIds);
  for (const entry of externalIds) {
    const label = `${text(entry.type)} ${text(entry.customType)} ${text(entry.organizationName)}`.toLowerCase();
    if (text(entry.type).toLowerCase() === 'organization' || label.includes('employee') || label.includes('nik')) {
      const value = text(entry.value);
      if (value) return value;
    }
  }

  return '';
}

function normalizeDirectoryUser(user: JsonRecord): DirectoryUserNormalized | null {
  const email = lower(user.primaryEmail);
  const name = asRecord(user.name);
  const fullName = pickPreferred(name?.fullName, user.name, email);
  if (!email || !fullName) return null;

  const organization = pickPrimaryOrganization(user);
  const account = pickPreferred(
    organization?.department,
    pickCustomSchemaValue(user, ['ati_account', 'account', 'atiAccount'])
  );
  const title = pickPreferred(
    organization?.description,
    pickCustomSchemaValue(user, ['employment_status', 'employmentStatus', 'type_of_employee', 'typeOfEmployee'])
  );
  const department = pickPreferred(organization?.title, user.title);
  const employeeCode = pickEmployeeCode(user);
  const isActive = !(bool(user.suspended) || bool(user.archived));

  return {
    email,
    fullName,
    employeeCode,
    title,
    account,
    department,
    isActive,
    sourceType: 'google-workspace-directory'
  };
}

async function listWorkspaceUsers() {
  const token = await getAccessToken();
  const users: DirectoryUserNormalized[] = [];
  let pageToken = '';

  do {
    const query = new URLSearchParams({
      customer: env.GOOGLE_WORKSPACE_DIRECTORY_CUSTOMER || 'my_customer',
      maxResults: '500',
      orderBy: 'email',
      projection: 'full',
      sortOrder: 'ASCENDING',
      viewType: 'admin_view'
    });
    if (pageToken) query.set('pageToken', pageToken);

    const response = await fetch(`${USERS_URL}?${query.toString()}`, {
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    const payload = await response.json().catch(async () => ({ error: await response.text() }));
    if (!response.ok || !payload || typeof payload !== 'object') {
      throw new Error(`Google Workspace users.list failed (${response.status}).`);
    }

    for (const row of Array.isArray((payload as JsonRecord).users) ? (payload as JsonRecord).users as unknown[] : []) {
      const normalized = normalizeDirectoryUser(asRecord(row) || {});
      if (normalized) users.push(normalized);
    }

    pageToken = text((payload as JsonRecord).nextPageToken);
  } while (pageToken);

  return users;
}

function existingEmployeeRecordMap(rows: Array<{
  id: string;
  employeeCode: string | null;
  email: string | null;
  fullName: string;
  title: string | null;
  account: string | null;
  department: string | null;
  isActive: boolean;
}>) {
  const byEmail = new Map<string, ExistingEmployee>();
  const byCode = new Map<string, ExistingEmployee>();

  for (const row of rows) {
    const normalized: ExistingEmployee = {
      id: row.id,
      employeeCode: text(row.employeeCode),
      email: lower(row.email),
      fullName: text(row.fullName),
      title: text(row.title),
      account: text(row.account),
      department: text(row.department),
      isActive: row.isActive
    };

    if (normalized.email) byEmail.set(normalized.email, normalized);
    if (normalized.employeeCode) byCode.set(lower(normalized.employeeCode), normalized);
  }

  return { byEmail, byCode };
}

export function getGoogleWorkspaceDirectoryReadiness() {
  const keyFile = keyPath();
  const keyFileExists = keyFile ? fs.existsSync(keyFile) : false;

  return {
    ...googleWorkspaceDirectoryReadiness,
    keyFileExists,
    scope: DIRECTORY_SCOPE,
    source: 'google-workspace-admin-directory',
    loginOAuthIndependent: true
  };
}

export async function syncGoogleWorkspaceDirectoryToEmployees() {
  const readiness = getGoogleWorkspaceDirectoryReadiness();
  if (!readiness.enabled) {
    return {
      success: false,
      message: 'Google Workspace Directory sync is disabled.',
      readiness
    };
  }

  if (!readiness.clientReady || !readiness.keyFileExists) {
    return {
      success: false,
      message: 'Google Workspace Directory sync is not ready yet. Service account env or key file is still missing.',
      readiness
    };
  }

  const existingRows = await prisma.employee.findMany({
    select: {
      id: true,
      employeeCode: true,
      email: true,
      fullName: true,
      title: true,
      account: true,
      department: true,
      isActive: true
    }
  });
  const existing = existingEmployeeRecordMap(existingRows);

  const workspaceUsers = await listWorkspaceUsers();
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let activeUsers = 0;
  let inactiveUsers = 0;

  for (const user of workspaceUsers) {
    if (user.isActive) activeUsers += 1;
    else inactiveUsers += 1;

    const current =
      existing.byEmail.get(user.email) ||
      (user.employeeCode ? existing.byCode.get(lower(user.employeeCode)) : undefined) ||
      null;

    const employeeCode = pickPreferred(user.employeeCode, current?.employeeCode);
    const account = pickPreferred(user.account, current?.account);
    const department = pickPreferred(user.department, current?.department);
    const title = pickPreferred(user.title, current?.title);

    if (!current) {
      const createdRow = await prisma.employee.create({
        data: {
          employeeCode: employeeCode || null,
          email: user.email,
          fullName: user.fullName,
          title: title || null,
          account: account || null,
          department: department || null,
          isActive: user.isActive
        }
      });
      created += 1;
      existing.byEmail.set(user.email, {
        id: createdRow.id,
        employeeCode: employeeCode || '',
        email: user.email,
        fullName: user.fullName,
        title: title || '',
        account: account || '',
        department: department || '',
        isActive: user.isActive
      });
      if (employeeCode) {
        existing.byCode.set(lower(employeeCode), {
          id: createdRow.id,
          employeeCode,
          email: user.email,
          fullName: user.fullName,
          title: title || '',
          account: account || '',
          department: department || '',
          isActive: user.isActive
        });
      }
      continue;
    }

    const nextState = {
      employeeCode: employeeCode || null,
      email: user.email,
      fullName: user.fullName,
      title: title || null,
      account: account || null,
      department: department || null,
      isActive: user.isActive
    };

    const changed = (
      text(current.employeeCode) !== text(nextState.employeeCode) ||
      lower(current.email) !== lower(nextState.email) ||
      text(current.fullName) !== text(nextState.fullName) ||
      text(current.title) !== text(nextState.title) ||
      text(current.account) !== text(nextState.account) ||
      text(current.department) !== text(nextState.department) ||
      current.isActive !== nextState.isActive
    );

    if (!changed) {
      unchanged += 1;
      continue;
    }

    await prisma.employee.update({
      where: { id: current.id },
      data: nextState
    });
    updated += 1;

    const refreshed: ExistingEmployee = {
      id: current.id,
      employeeCode: text(nextState.employeeCode),
      email: lower(nextState.email),
      fullName: text(nextState.fullName),
      title: text(nextState.title),
      account: text(nextState.account),
      department: text(nextState.department),
      isActive: nextState.isActive
    };
    existing.byEmail.set(refreshed.email, refreshed);
    if (refreshed.employeeCode) existing.byCode.set(lower(refreshed.employeeCode), refreshed);
  }

  // Remove employees no longer present in GWS (deleted/suspended accounts)
  const gwsEmailSet = new Set(workspaceUsers.map((u) => lower(u.email)));
  const gwsEmailArray = [...gwsEmailSet];
  const removedCandidates = await prisma.employee.findMany({
    where: {
      isActive: true,
      email: { notIn: gwsEmailArray }
    },
    select: {
      id: true,
      email: true
    }
  });

  let deleted = 0;

  for (const candidate of removedCandidates) {
    await prisma.employee.delete({ where: { id: candidate.id } });
    deleted += 1;
  }

  // Delete all portal User accounts whose email is no longer in GWS.
  // This covers: users linked to a just-deleted Employee, users whose Employee was already
  // cleaned up in a previous sync, and users who were never linked to an Employee at all.
  // Sessions + UserRoles cascade-delete; AuditLogs set actorId=null (audit trail preserved).
  // gwsEmailArray is already lowercased; User emails from Google OAuth are also lowercase.
  await prisma.user.deleteMany({
    where: { email: { notIn: gwsEmailArray } }
  });

  await syncMasterReferencesFromEmployeeDirectory();

  // Rebuild employee asset holdings snapshot so the directory reflects the latest
  // employee state immediately — no manual refresh needed after each GWS sync.
  void triggerSnapshotRebuild();

  return {
    success: true,
    message: 'Google Workspace Directory sync completed.',
    readiness,
    stats: {
      fetched: workspaceUsers.length,
      created,
      updated,
      unchanged,
      deleted,
      activeUsers,
      inactiveUsers
    },
    mapping: {
      email: 'primaryEmail',
      fullName: 'name.fullName',
      employeeCode: 'externalIds[] with type=organization / custom schema fallback',
      title: 'organizations.description (Type of employee)',
      department: 'organizations.title (Job title)',
      account: 'organizations.department',
      isActive: 'not suspended and not archived'
    }
  };
}
