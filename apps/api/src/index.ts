import fs from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env, authReadiness } from './config.js';
import { prisma } from './db.js';
import {
  applySessionCookie,
  authenticateLocalUser,
  authenticateGoogleUser,
  beginGoogleOAuth,
  clearSessionCookie,
  clearGoogleOAuthState,
  createSessionForUser,
  destroySessionByToken,
  ensureLocalSuperAdmin,
  getAuthenticatedUser,
  getGoogleOAuthState,
  googleOAuthIsReady
} from './auth.js';
import {
  checkParityAssetTagExistence,
  getParityAssetCurrentHolders,
  getParityAssetDetail,
  getParityEmployeeDirectoryDetail,
  getParityEmployeeDirectoryHistoryDetail,
  getParityHandoverDetail,
  getParityHandoverDependencies,
  getParityHandoverHistory,
  getParityItamDashboardSummary,
  getParityMasterReferences,
  getParityProcurementRows
} from './services/atlas-parity.js';
import {
  getParityHandoverSigners,
  getStoredHandoverFileContentType,
  getStoredHandoverFilePath,
  rebuildHandoverPdfAsCancelled,
  searchParityHandoverEmployees,
  submitParityHandoverTransaction
} from './services/handover-submit.js';
import {
  getStoredProcurementEvidenceContentType,
  getStoredProcurementEvidencePath,
  submitParityProcurementRequest,
  updateParityProcurementRequest
} from './services/procurement-submit.js';
import { listEmployeeDirectory } from './services/employee-directory.js';
import {
  getGoogleWorkspaceDirectoryReadiness,
  syncGoogleWorkspaceDirectoryToEmployees
} from './services/google-workspace-directory.js';
import {
  getStructuredMasterReferences,
  syncMasterReferencesFromEmployeeDirectory
} from './services/master-reference.js';
import {
  createAssetRecord,
  deleteAssetRecord,
  exportAssetsExcel,
  listAssets,
  updateAssetQuantity,
  updateAssetRecord
} from './services/asset-list.js';
import {
  createNewPoEntries,
  createNewPoEntry,
  deleteNewPoEntries,
  deleteNewPoEntry,
  listNewPoEntries,
  listNewPoOptions,
  updateNewPoEntries,
  updateNewPoEntry
} from './services/new-po.js';
import {
  addCatalogCategory,
  addCatalogItem,
  deleteCatalogCategory,
  deleteCatalogItem,
  editCatalogItem,
  listCatalog
} from './services/catalog-management.js';

const app = Fastify({
  logger: env.NODE_ENV !== 'production'
});

await app.register(helmet, {
  global: true
});

await app.register(cookie);
await app.register(cors, {
  origin: [env.APP_ORIGIN],
  credentials: true
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute'
});

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const auth = await getAuthenticatedUser(request);
  if (!auth) {
    clearSessionCookie(reply);
    await reply.status(401).send({
      ok: false,
      message: 'Authentication required.'
    });
    return null;
  }

  return auth.user;
}

function buildAppRedirect(overrides: Record<string, string | null | undefined> = {}) {
  const url = new URL(env.APP_URL);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === undefined || value === '') {
      url.searchParams.delete(key);
      continue;
    }
    url.searchParams.set(key, value);
  }
  return url.toString();
}

const listQuerySchema = z.object({
  search: z.string().optional().default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25)
});

const procurementViewSchema = z.object({
  search: z.string().optional().default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  view: z.enum(['monitoring', 'archive']).optional().default('monitoring')
});

const boolishSchema = z.union([z.boolean(), z.string(), z.number()]).optional();
const textQuerySchema = z.string().trim().min(1);
const assetSortKeySchema = z.enum([
  'tag',
  'sn',
  'item',
  'qty',
  'status',
  'user',
  'assignedAccount',
  'assignedDept',
  'location',
  'ownerAccount',
  'ownerDept'
]);
const assetSortDirSchema = z.enum(['asc', 'desc']);
const catalogCategorySchema = z.object({
  name: z.string().trim().min(1)
});
const catalogItemSchema = z.object({
  category: z.string().trim().min(1),
  sku: z.string().trim().min(1),
  account: z.string().optional().default(''),
  specification: z.string().optional().default(''),
  estimatedPrice: z.union([z.string(), z.number()]).optional().default('')
});
const newPoSheetSchema = z.enum(['asset', 'accessories']).optional().default('asset');
const newPoEntryMutationSchema = z.object({
  itemName: z.union([z.string(), z.null()]).optional(),
  serialNumber: z.union([z.string(), z.null()]).optional(),
  barcode: z.union([z.string(), z.null()]).optional(),
  category: z.union([z.string(), z.null()]).optional(),
  quantity: z.union([z.string(), z.number(), z.null()]).optional(),
  remarkFor: z.union([z.string(), z.null()]).optional(),
  invoiceNumber: z.union([z.string(), z.null()]).optional(),
  orderNumber: z.union([z.string(), z.null()]).optional(),
  account: z.union([z.string(), z.null()]).optional(),
  department: z.union([z.string(), z.null()]).optional(),
  remark: z.union([z.string(), z.null()]).optional()
});
const newPoBulkDeleteSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(2000)
});
const newPoBulkCreateSchema = z.object({
  sheet: newPoSheetSchema,
  count: z.number().int().min(1).max(2000)
});
const newPoBulkUpdateSchema = z.object({
  updates: z.array(z.object({
    id: z.string().trim().min(1),
    patch: newPoEntryMutationSchema
  })).min(1).max(500)
});

function parseListQuery(query: unknown) {
  return listQuerySchema.parse(query);
}

function makePageMeta(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize))
  };
}

function trimSearch(value: string) {
  return value.trim();
}

function normalizeRole(role: unknown) {
  return String(role ?? '')
    .trim()
    .replace(/[^A-Z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function canManageAssets(user: { roles?: string[] }) {
  const roles = Array.isArray(user.roles) ? user.roles.map(normalizeRole) : [];
  return roles.some((role) =>
    role.includes('SUPER') ||
    role === 'ADMIN' ||
    role.includes('IT_OPS') ||
    role.includes('ASSET')
  );
}

function canManageMasterData(user: { roles?: string[] }) {
  const roles = Array.isArray(user.roles) ? user.roles.map(normalizeRole) : [];
  return roles.some((role) =>
    role.includes('SUPER') ||
    role === 'ADMIN' ||
    role.includes('MASTER') ||
    role.includes('DATA') ||
    role.includes('IT_OPS') ||
    role.includes('ASSET')
  );
}

function canManageNewPo(user: { roles?: string[] }) {
  const roles = Array.isArray(user.roles) ? user.roles.map(normalizeRole) : [];
  return roles.some((role) =>
    role.includes('SUPER') ||
    role === 'ADMIN' ||
    role.includes('IT_OPS') ||
    role.includes('ASSET') ||
    role.includes('PROCUREMENT')
  );
}

app.get('/health', async () => {
  await prisma.$queryRaw`SELECT 1`;
  return {
    ok: true,
    service: 'atlas-api',
    timestamp: new Date().toISOString(),
    auth: authReadiness
  };
});

app.get('/platform/summary', async () => {
  return {
    ok: true,
    appName: env.APP_NAME,
    environment: env.NODE_ENV,
    modules: [
      'ITAM Dashboard',
      'Catalog Management',
      'List Asset',
      'Employee Asset Holdings',
      'Handover BAST',
      'Handover Monitor',
      'Asset Sync Admin',
      'Employee Database',
      'Procurement Request'
    ],
    migrationStatus: {
      backend: 'baseline-ready',
      frontend: 'baseline-ready',
      database: 'schema-ready',
      googleAuth: authReadiness.googleEnabled && authReadiness.googleClientReady ? 'ready' : 'pending-credentials'
    }
  };
});

app.get('/auth/readiness', async () => {
  return {
    ok: true,
    ...authReadiness,
    message: authReadiness.googleEnabled && authReadiness.googleClientReady
      ? 'Google OAuth is configured.'
      : 'Google OAuth credentials are still required before production user login is enabled.'
  };
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1)
});

app.post('/auth/login', async (request, reply) => {
  if (env.LOCAL_AUTH_ENABLED !== 'true') {
    return reply.status(503).send({
      ok: false,
      message: 'Local username/password access is disabled.'
    });
  }

  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      ok: false,
      message: 'Username and password are required.'
    });
  }

  const user = await authenticateLocalUser(parsed.data.identifier, parsed.data.password);
  if (!user) {
    return reply.status(401).send({
      ok: false,
      message: 'Invalid username or password.'
    });
  }

  const token = await createSessionForUser(user.id);
  applySessionCookie(reply, token);

  return {
    ok: true,
    user,
    message: 'Login successful.'
  };
});

app.get('/auth/google', async (_request, reply) => {
  if (!googleOAuthIsReady()) {
    return reply.redirect(buildAppRedirect({
      authError: 'Google sign-in is not configured yet.'
    }));
  }

  try {
    const url = beginGoogleOAuth(reply);
    return reply.redirect(url);
  } catch (error) {
    clearGoogleOAuthState(reply);
    return reply.redirect(buildAppRedirect({
      authError: error instanceof Error ? error.message : 'Failed to start Google sign-in.'
    }));
  }
});

app.get('/auth/google/callback', async (request, reply) => {
  const query = request.query as {
    code?: unknown;
    state?: unknown;
    error?: unknown;
    error_description?: unknown;
  };

  const oauthError = String(query.error || '').trim();
  if (oauthError) {
    clearGoogleOAuthState(reply);
    const message = String(query.error_description || oauthError || 'Google sign-in was cancelled.');
    return reply.redirect(buildAppRedirect({
      authError: message
    }));
  }

  const code = String(query.code || '').trim();
  const state = String(query.state || '').trim();
  const expectedState = getGoogleOAuthState(request);

  if (!code) {
    clearGoogleOAuthState(reply);
    return reply.redirect(buildAppRedirect({
      authError: 'Google did not return an authorization code.'
    }));
  }

  if (!state || !expectedState || state !== expectedState) {
    clearGoogleOAuthState(reply);
    return reply.redirect(buildAppRedirect({
      authError: 'Google sign-in state validation failed. Please try again.'
    }));
  }

  try {
    clearGoogleOAuthState(reply);
    const user = await authenticateGoogleUser(code);
    const token = await createSessionForUser(user.id);
    applySessionCookie(reply, token);
    return reply.redirect(buildAppRedirect({
      authError: null
    }));
  } catch (error) {
    clearSessionCookie(reply);
    return reply.redirect(buildAppRedirect({
      authError: error instanceof Error ? error.message : 'Google sign-in failed.'
    }));
  }
});

app.get('/auth/me', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  return {
    ok: true,
    user
  };
});

app.post('/auth/logout', async (request, reply) => {
  const token = request.cookies.atlas_session;
  await destroySessionByToken(token);
  clearSessionCookie(reply);
  return {
    ok: true,
    message: 'Logged out.'
  };
});

app.get('/app/bootstrap', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const [
    assets,
    catalogCount,
    holdingsCount,
    handoverCount,
    procurementCount,
    ledgerCount,
    referenceCount,
    locationCount,
    latestBatch,
    recentHandovers,
    recentProcurement
  ] = await Promise.all([
    prisma.asset.findMany({
      select: {
        assetTag: true,
        quantity: true,
        status: true,
        assignedToText: true,
        assignedAccount: true,
        assignedDept: true,
        ownerAccount: true,
        category: true,
        updatedAt: true
      }
    }),
    prisma.catalogItem.count(),
    prisma.employeeAssetHolding.count(),
    prisma.handoverDocument.count(),
    prisma.procurementRequest.count(),
    prisma.assetAssignmentLedgerEntry.count(),
    prisma.masterReference.count(),
    prisma.masterLocation.count(),
    prisma.workbookImportBatch.findFirst({
      orderBy: { startedAt: 'desc' }
    }),
    prisma.handoverDocument.findMany({
      orderBy: [{ transactionTimestamp: 'desc' }, { createdAt: 'desc' }],
      take: 5,
      select: {
        docNumber: true,
        transactionType: true,
        holderName: true,
        status: true,
        transactionTimestamp: true
      }
    }),
    prisma.procurementRequest.findMany({
      orderBy: [{ requestTimestamp: 'desc' }, { createdAt: 'desc' }],
      take: 5,
      select: {
        requestNumber: true,
        requestorName: true,
        itemSummary: true,
        status: true,
        fulfillment: true,
        requestTimestamp: true
      }
    })
  ]);

  let totalUnits = 0;
  let assignedToUserUnits = 0;
  let assignedToAccountUnits = 0;
  let latestAssetUpdatedAt: Date | null = null;
  const ownerAccountUnits = new Map<string, number>();
  const categorySet = new Set<string>();

  for (const asset of assets) {
    const explicitQty = typeof asset.quantity === 'number' ? asset.quantity : 0;
    const isAssigned = Boolean(asset.assignedToText || asset.assignedAccount || asset.assignedDept);
    const effectiveUnits = explicitQty > 0 ? explicitQty : isAssigned ? 1 : 0;
    const ownerKey = trimSearch(asset.ownerAccount || '') || 'Unspecified';

    totalUnits += effectiveUnits;
    ownerAccountUnits.set(ownerKey, (ownerAccountUnits.get(ownerKey) || 0) + effectiveUnits);

    if (trimSearch(asset.category)) {
      categorySet.add(trimSearch(asset.category));
    }

    if (asset.assignedAccount || asset.assignedDept) {
      assignedToAccountUnits += effectiveUnits;
    } else if (asset.assignedToText) {
      assignedToUserUnits += effectiveUnits;
    }

    if (!latestAssetUpdatedAt || asset.updatedAt > latestAssetUpdatedAt) {
      latestAssetUpdatedAt = asset.updatedAt;
    }
  }

  const assignedUnits = assignedToUserUnits + assignedToAccountUnits;
  const availableUnits = Math.max(totalUnits - assignedUnits, 0);
  const topOwnerAccounts = [...ownerAccountUnits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, units]) => ({
      label,
      units,
      sharePct: totalUnits > 0 ? Number(((units / totalUnits) * 100).toFixed(1)) : 0
    }));

  return {
    ok: true,
    user,
    summary: {
      assetCount: assets.length,
      catalogCount,
      holdingsCount,
      handoverCount,
      procurementCount,
      ledgerCount,
      referenceCount,
      locationCount
    },
    portfolio: {
      totalUnits,
      assetRows: assets.length,
      assignedUnits,
      assignedToUserUnits,
      assignedToAccountUnits,
      availableUnits,
      ownerAccounts: ownerAccountUnits.size,
      activeCategories: categorySet.size,
      latestAssetUpdatedAt,
      topOwnerAccounts
    },
    latestImport: latestBatch,
    recentHandovers,
    recentProcurement
  };
});

app.get('/app/itam-dashboard', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const forceRefresh = boolishSchema.parse((request.query as { forceRefresh?: unknown } | undefined)?.forceRefresh);
  return getParityItamDashboardSummary({
    forceRefresh: forceRefresh === true || String(forceRefresh).toLowerCase() === 'true'
  });
});

app.get('/app/master-references/structured', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const search = trimSearch(String((request.query as { search?: unknown } | undefined)?.search ?? ''));
  const result = await getStructuredMasterReferences(search);
  return {
    ok: true,
    items: [],
    masterReferences: result
  };
});

app.post('/app/master-references/sync', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageMasterData(user)) {
    return reply.status(403).send({ success: false, message: 'You do not have permission to sync master reference data.' });
  }

  return syncMasterReferencesFromEmployeeDirectory();
});

app.get('/app/handover/dependencies', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  return getParityHandoverDependencies();
});

app.get('/app/handover/signers', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  return await getParityHandoverSigners();
});

app.get('/app/handover/employees', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const query = textQuerySchema.parse((request.query as { query?: unknown } | undefined)?.query ?? '');
  const limitRaw = Number((request.query as { limit?: unknown } | undefined)?.limit ?? 8);
  return searchParityHandoverEmployees(query, Number.isFinite(limitRaw) ? limitRaw : 8);
});

app.get('/app/handover/history', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  return getParityHandoverHistory();
});

app.get('/app/assets/:assetTag/detail', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const params = request.params as { assetTag: string };
  const query = request.query as { includeHolders?: unknown } | undefined;
  const includeHolders = boolishSchema.parse(query?.includeHolders);
  return getParityAssetDetail(params.assetTag, {
    includeHolders: !(includeHolders === false || String(includeHolders).toLowerCase() === 'false')
  });
});

app.get('/app/assets/:assetTag/current-holders', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const params = request.params as { assetTag: string };
  return getParityAssetCurrentHolders(params.assetTag);
});

app.get('/app/assets/:assetTag/existence', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const params = request.params as { assetTag: string };
  return checkParityAssetTagExistence(params.assetTag);
});

app.get('/app/employees/detail', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const query = textQuerySchema.parse((request.query as { query?: unknown } | undefined)?.query);
  return getParityEmployeeDirectoryDetail(query);
});

app.get('/app/employees/history', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const q = request.query as { query?: unknown; eventLimit?: unknown } | undefined;
  const query = textQuerySchema.parse(q?.query);
  const eventLimit = q?.eventLimit === undefined ? undefined : Number(q.eventLimit);
  return getParityEmployeeDirectoryHistoryDetail(query, eventLimit);
});

app.get('/app/procurement/rows', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const view = z.enum(['monitoring', 'archive']).parse((request.query as { view?: unknown } | undefined)?.view ?? 'monitoring');
  return getParityProcurementRows(view);
});

app.get('/app/assets', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const q = request.query as {
    search?: unknown;
    page?: unknown;
    pageSize?: unknown;
    sortKey?: unknown;
    sortDir?: unknown;
  } | undefined;

  const parsed = listQuerySchema.parse(q);
  const sortKey = assetSortKeySchema.parse(q?.sortKey ?? 'tag');
  const sortDir = assetSortDirSchema.parse(q?.sortDir ?? 'asc');

  return listAssets({
    search: parsed.search,
    page: parsed.page,
    pageSize: parsed.pageSize,
    sortKey,
    sortDir
  });
});

app.get('/app/assets/export', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const q = request.query as {
    search?: unknown;
    sortKey?: unknown;
    sortDir?: unknown;
  } | undefined;

  const search = typeof q?.search === 'string' ? q.search.trim() : '';
  const sortKey = assetSortKeySchema.parse(q?.sortKey ?? 'tag');
  const sortDir = assetSortDirSchema.parse(q?.sortDir ?? 'asc');

  const buffer = await exportAssetsExcel(search, sortKey, sortDir);
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = search ? `ATLAS_Asset_List_${ts}_filtered.xlsx` : `ATLAS_Asset_List_${ts}.xlsx`;

  return reply
    .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(buffer);
});

const assetCreateSchema = z.object({
  assetTag: z.string().trim().min(1),
  serialNumber: z.string().optional().default(''),
  itemModel: z.string().trim().min(1),
  category: z.string().trim().min(1),
  status: z.string().optional().default(''),
  location: z.string().optional().default(''),
  purchaseDate: z.string().optional().default(''),
  vendorName: z.string().optional().default(''),
  purchasingYear: z.string().optional().default(''),
  orderNumber: z.string().optional().default(''),
  invoiceNumber: z.string().optional().default(''),
  ownerAccount: z.string().optional().default(''),
  ownerDepartment: z.string().optional().default(''),
  assignmentMode: z.enum(['individual', 'sharing']).optional().default('individual'),
  assignedToText: z.string().optional().default(''),
  assignedAccount: z.string().optional().default(''),
  assignedDept: z.string().optional().default(''),
  initialQuantity: z.coerce.number().int().min(1).optional().default(1)
});

app.post('/app/assets', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageAssets(user)) {
    return reply.status(403).send({ success: false, message: 'You do not have permission to create assets.' });
  }

  const payload = assetCreateSchema.parse(request.body);
  return createAssetRecord(payload, user);
});

const assetMutationSchema = z.object({
  assetTag: z.string().trim().min(1),
  serialNumber: z.string().optional().default(''),
  itemModel: z.string().trim().min(1),
  category: z.string().trim().min(1),
  status: z.string().optional().default(''),
  location: z.string().optional().default(''),
  purchaseDate: z.string().optional().default(''),
  vendorName: z.string().optional().default(''),
  purchasingYear: z.string().optional().default(''),
  orderNumber: z.string().optional().default(''),
  invoiceNumber: z.string().optional().default(''),
  ownerAccount: z.string().optional().default(''),
  ownerDepartment: z.string().optional().default(''),
  assignmentMode: z.enum(['individual', 'sharing']).optional().default('individual'),
  assignedToText: z.string().optional().default(''),
  assignedAccount: z.string().optional().default(''),
  assignedDept: z.string().optional().default('')
});

const assetQtySchema = z.object({
  delta: z.coerce.number().int(),
  remark: z.string().trim().min(1)
});

app.patch('/app/assets/:assetTag/quantity', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageAssets(user)) {
    return reply.status(403).send({ success: false, message: 'You do not have permission to adjust asset quantity.' });
  }

  const assetTag = textQuerySchema.parse((request.params as { assetTag?: unknown } | undefined)?.assetTag);
  const payload = assetQtySchema.parse(request.body);
  return updateAssetQuantity(assetTag, payload.delta, payload.remark, user);
});

app.patch('/app/assets/:assetTag', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageAssets(user)) {
    return reply.status(403).send({ success: false, message: 'You do not have permission to edit asset data.' });
  }

  const assetTag = textQuerySchema.parse((request.params as { assetTag?: unknown } | undefined)?.assetTag);
  const payload = assetMutationSchema.parse(request.body);
  return updateAssetRecord(assetTag, payload, user);
});

app.delete('/app/assets/:assetTag', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageAssets(user)) {
    return reply.status(403).send({ success: false, message: 'You do not have permission to delete assets.' });
  }

  const assetTag = textQuerySchema.parse((request.params as { assetTag?: unknown } | undefined)?.assetTag);
  return deleteAssetRecord(assetTag, user);
});

app.get('/app/catalog', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const { search } = parseListQuery(request.query);
  return listCatalog(search);
});

app.post('/app/catalog/categories', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageAssets(user)) {
    return reply.status(403).send({ success: false, message: 'You do not have permission to create catalog categories.' });
  }

  const payload = catalogCategorySchema.parse(request.body);
  return addCatalogCategory(payload.name, user);
});

app.delete('/app/catalog/categories/:category', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageAssets(user)) {
    return reply.status(403).send({ success: false, message: 'You do not have permission to delete catalog categories.' });
  }

  const category = textQuerySchema.parse((request.params as { category?: unknown } | undefined)?.category);
  return deleteCatalogCategory(category, user);
});

app.post('/app/catalog/items', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageAssets(user)) {
    return reply.status(403).send({ success: false, message: 'You do not have permission to add catalog items.' });
  }

  const payload = catalogItemSchema.parse(request.body);
  return addCatalogItem(payload, user);
});

app.patch('/app/catalog/items/:originalSku', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageAssets(user)) {
    return reply.status(403).send({ success: false, message: 'You do not have permission to edit catalog items.' });
  }

  const originalSku = textQuerySchema.parse((request.params as { originalSku?: unknown } | undefined)?.originalSku);
  const payload = catalogItemSchema.parse(request.body);
  return editCatalogItem(originalSku, payload, user);
});

app.delete('/app/catalog/items/:sku', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageAssets(user)) {
    return reply.status(403).send({ success: false, message: 'You do not have permission to delete catalog items.' });
  }

  const sku = textQuerySchema.parse((request.params as { sku?: unknown } | undefined)?.sku);
  return deleteCatalogItem(sku, user);
});

app.get('/app/holdings/me', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const email = String(user.email || '').trim();
  if (!email) {
    return reply.status(400).send({ success: false, message: 'User email not available.' });
  }

  return getParityEmployeeDirectoryDetail(email);
});

app.get('/app/holdings', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const { search, page, pageSize } = parseListQuery(request.query);
  return listEmployeeDirectory({
    search: trimSearch(search),
    page,
    pageSize
  });
});

app.get('/app/employees', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const { search, page, pageSize } = parseListQuery(request.query);
  return listEmployeeDirectory({
    search: trimSearch(search),
    page,
    pageSize
  });
});

app.get('/app/employees/source-readiness', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageMasterData(user)) {
    return reply.status(403).send({ success: false, message: 'You do not have permission to inspect employee directory sync status.' });
  }

  return {
    success: true,
    source: getGoogleWorkspaceDirectoryReadiness()
  };
});

app.post('/app/employees/sync/google-workspace', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageMasterData(user)) {
    return reply.status(403).send({ success: false, message: 'You do not have permission to sync employee directory data.' });
  }

  const result = await syncGoogleWorkspaceDirectoryToEmployees();
  if (!result.success) {
    return reply.status(400).send(result);
  }
  return result;
});

app.get('/app/master-references', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const { search, page, pageSize } = parseListQuery(request.query);
  const q = trimSearch(search);
  const where = q
    ? {
        OR: [
          { type: { contains: q, mode: 'insensitive' as const } },
          { value: { contains: q, mode: 'insensitive' as const } },
          { parentLink: { contains: q, mode: 'insensitive' as const } },
          { key: { contains: q, mode: 'insensitive' as const } }
        ]
      }
    : undefined;

  const [total, items] = await Promise.all([
    prisma.masterReference.count({ where }),
    prisma.masterReference.findMany({
      where,
      orderBy: [{ type: 'asc' }, { value: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);

  return {
    ok: true,
    meta: makePageMeta(page, pageSize, total),
    items
  };
});

app.get('/app/admin/it-signers', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageMasterData(user)) return reply.status(403).send({ ok: false, message: 'Forbidden.' });
  const items = await prisma.user.findMany({
    where: { userRoles: { some: { role: { name: 'IT_OPS' } } } },
    select: { id: true, email: true, fullName: true, isActive: true },
    orderBy: { fullName: 'asc' }
  });
  return { ok: true, items };
});

app.post('/app/admin/it-signers', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageMasterData(user)) return reply.status(403).send({ ok: false, message: 'Forbidden.' });
  const { userId } = z.object({ userId: z.string().min(1) }).parse(request.body);
  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) return reply.status(404).send({ ok: false, message: 'User not found.' });
  // Upsert the IT_OPS role (create if it doesn't exist yet)
  const role = await prisma.role.upsert({
    where: { name: 'IT_OPS' },
    update: {},
    create: { name: 'IT_OPS' }
  });
  try {
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
  } catch {
    // Already has IT_OPS role — idempotent, not an error
  }
  return { ok: true };
});

app.delete('/app/admin/it-signers/:userId', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageMasterData(user)) return reply.status(403).send({ ok: false, message: 'Forbidden.' });
  const userId = textQuerySchema.parse((request.params as { userId?: unknown })?.userId);
  const role = await prisma.role.findUnique({ where: { name: 'IT_OPS' } });
  if (role) {
    await prisma.userRole.deleteMany({ where: { userId, roleId: role.id } });
  }
  return { ok: true };
});

app.get('/app/handover', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const { search, page, pageSize } = parseListQuery(request.query);
  const q = trimSearch(search);

  // Extra params for handover: statusFilter, sortKey, sortDir
  const rawQuery = request.query as Record<string, string>;
  const statusFilter = String(rawQuery.statusFilter || '').trim().toLowerCase();
  const allowedSortKeys = ['docNumber', 'transactionTimestamp', 'transactionType', 'holderName', 'status'] as const;
  type HandoverSortKey = typeof allowedSortKeys[number];
  const sortKey: HandoverSortKey = allowedSortKeys.includes(rawQuery.sortKey as HandoverSortKey)
    ? (rawQuery.sortKey as HandoverSortKey)
    : 'transactionTimestamp';
  const sortDir: 'asc' | 'desc' = rawQuery.sortDir === 'asc' ? 'asc' : 'desc';

  // Restrict handover list for basic end-user roles to their own submissions.
  const userRoles = (user.roles || []).map(normalizeRole);
  const isEndUserRole = userRoles.some((role) => ['USER', 'WFH', 'WFO', 'WFH_WFO'].includes(role));
  const hasAdminLikeRole = userRoles.some((r) => r.includes('SUPER') || r === 'ADMIN' || r.includes('IT') || r.includes('ASSET'));
  const isUserOnly = isEndUserRole && !hasAdminLikeRole;

  let allowedHandoverIds: string[] | null = null;
  if (isUserOnly) {
    const auditRows = await prisma.auditLog.findMany({
      where: {
        module: 'HANDOVER_BAST',
        entityType: 'HandoverDocument',
        OR: [
          { actorId: user.id },
          { actorEmail: { equals: user.email, mode: 'insensitive' } }
        ]
      },
      select: {
        entityId: true
      },
      take: 2000
    });

    allowedHandoverIds = Array.from(new Set(
      auditRows
        .map((row) => String(row.entityId || '').trim())
        .filter(Boolean)
    ));

    if (!allowedHandoverIds.length) {
      return {
        ok: true,
        meta: makePageMeta(page, pageSize, 0),
        items: []
      };
    }
  }

  const handoverSearchOR = q
    ? [
        { docNumber: { contains: q, mode: 'insensitive' as const } },
        { transactionType: { contains: q, mode: 'insensitive' as const } },
        { holderName: { contains: q, mode: 'insensitive' as const } },
        { holderNik: { contains: q, mode: 'insensitive' as const } },
        { holderDepartment: { contains: q, mode: 'insensitive' as const } },
        { notes: { contains: q, mode: 'insensitive' as const } },
        {
          items: {
            some: {
              OR: [
                { assetTag: { contains: q, mode: 'insensitive' as const } },
                { itemName: { contains: q, mode: 'insensitive' as const } },
                { itemSku: { contains: q, mode: 'insensitive' as const } }
              ]
            }
          }
        }
      ]
    : null;

  const statusCondition = statusFilter
    ? { status: { equals: statusFilter === 'on hold' ? 'On Hold' : statusFilter === 'completed' ? 'Completed' : statusFilter === 'cancelled' ? 'Cancelled' : statusFilter, mode: 'insensitive' as const } }
    : undefined;

  const where = isUserOnly
    ? {
        id: { in: allowedHandoverIds || [] },
        ...(handoverSearchOR ? { OR: handoverSearchOR } : {}),
        ...statusCondition
      }
    : {
        ...(handoverSearchOR ? { OR: handoverSearchOR } : {}),
        ...statusCondition
      };

  const orderBy: object[] = sortKey === 'transactionTimestamp'
    ? [{ transactionTimestamp: sortDir }, { createdAt: sortDir }]
    : [{ [sortKey]: sortDir }, { transactionTimestamp: 'desc' as const }];

  const [total, items] = await Promise.all([
    prisma.handoverDocument.count({ where }),
    prisma.handoverDocument.findMany({
      where,
      include: {
        _count: {
          select: {
            items: true
          }
        }
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);

  const normalizedItems = items.map((item) => {
    const fallbackTimestamp = item.transactionTimestamp || item.createdAt || item.updatedAt;
    return {
      ...item,
      transactionTimestamp: fallbackTimestamp,
      timestamp: fallbackTimestamp
    };
  });

  return {
    ok: true,
    meta: makePageMeta(page, pageSize, total),
    items: normalizedItems
  };
});

// Cancel a handover document — SUPER ADMIN / ADMIN / IT_OPS only, only when On Hold
app.post('/app/handover/:docNumber/cancel', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const roles = (user.roles || []).map(normalizeRole);
  const canCancel = roles.some((r) =>
    r.includes('SUPER') || r === 'ADMIN' || r.includes('IT_OPS') || r.includes('ASSET')
  );
  if (!canCancel) {
    return reply.status(403).send({ ok: false, message: 'You do not have permission to cancel handover documents.' });
  }

  const { docNumber } = request.params as { docNumber: string };
  const reason = String((request.body as Record<string, unknown>)?.reason || '').trim();

  const doc = await prisma.handoverDocument.findFirst({
    where: { docNumber: { equals: docNumber.trim(), mode: 'insensitive' } }
  });

  if (!doc) {
    return reply.status(404).send({ ok: false, message: `Document ${docNumber} not found.` });
  }

  const currentStatus = String(doc.status || '').trim().toLowerCase();
  if (currentStatus !== 'on hold') {
    return reply.status(400).send({
      ok: false,
      message: `Only On Hold documents can be cancelled. Current status: "${doc.status}".`
    });
  }

  // Append cancellation to revision history
  const prevHistory = Array.isArray(doc.revisionHistoryJson) ? doc.revisionHistoryJson : [];
  const cancelEntry = {
    ts: new Date().toISOString(),
    by: String(user.email || user.id || 'system'),
    action: 'CANCEL',
    docID: doc.docNumber,
    statusFrom: doc.status,
    statusTo: 'Cancelled',
    event: 'CANCELLED',
    ...(reason ? { reason } : {})
  };
  const updatedHistory = [...prevHistory, cancelEntry];

  await prisma.$transaction(async (tx) => {
    await tx.handoverDocument.update({
      where: { id: doc.id },
      data: {
        status: 'Cancelled',
        revisionHistoryJson: updatedHistory as Parameters<typeof tx.handoverDocument.update>[0]['data']['revisionHistoryJson']
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        actorEmail: String(user.email || ''),
        module: 'HANDOVER_BAST',
        action: 'CANCEL',
        entityType: 'HandoverDocument',
        entityId: doc.id,
        payloadJson: {
          docNumber: doc.docNumber,
          statusFrom: doc.status,
          statusTo: 'Cancelled',
          reason: reason || null,
          holderName: doc.holderName,
          holderEmail: doc.holderEmail
        }
      }
    });
  });

  try {
    await rebuildHandoverPdfAsCancelled({ docNumber: doc.docNumber, payloadJson: doc.payloadJson, revisionHistoryJson: updatedHistory });
  } catch (pdfErr) {
    console.error('[cancel-bast] PDF stamp failed (non-fatal):', pdfErr);
  }

  return { ok: true, message: `BAST ${doc.docNumber} has been cancelled.` };
});

app.get('/app/procurement', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const { search, page, pageSize, view } = procurementViewSchema.parse(request.query);
  const q = trimSearch(search);
  const where = {
    isArchived: view === 'archive',
    ...(q
      ? {
          OR: [
            { requestNumber: { contains: q, mode: 'insensitive' as const } },
            { requestorName: { contains: q, mode: 'insensitive' as const } },
            { itemSummary: { contains: q, mode: 'insensitive' as const } },
            { fulfillment: { contains: q, mode: 'insensitive' as const } },
            { referenceNo: { contains: q, mode: 'insensitive' as const } },
            { sourceReference: { contains: q, mode: 'insensitive' as const } },
            { requestSource: { contains: q, mode: 'insensitive' as const } },
            { status: { contains: q, mode: 'insensitive' as const } },
            { processorEmail: { contains: q, mode: 'insensitive' as const } },
            { notes: { contains: q, mode: 'insensitive' as const } }
          ]
        }
      : {})
  };

  const [total, items] = await Promise.all([
    prisma.procurementRequest.count({ where }),
    prisma.procurementRequest.findMany({
      where,
      orderBy: [{ requestTimestamp: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);

  return {
    ok: true,
    meta: makePageMeta(page, pageSize, total),
    items
  };
});

app.get('/app/admin/new-po/items', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageNewPo(user)) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission to access New PO intake.'
    });
  }

  const { search, page, pageSize } = parseListQuery(request.query);
  const sheet = newPoSheetSchema.parse((request.query as { sheet?: unknown } | undefined)?.sheet);
  return listNewPoEntries({
    sheet: sheet === 'accessories' ? 'ACCESSORIES' : 'ASSET',
    search,
    page,
    pageSize
  });
});

app.get('/app/admin/new-po/options', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageNewPo(user)) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission to access New PO options.'
    });
  }

  return listNewPoOptions();
});

app.post('/app/admin/new-po/items', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageNewPo(user)) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission to create New PO rows.'
    });
  }

  const sheet = newPoSheetSchema.parse((request.body as { sheet?: unknown } | undefined)?.sheet);
  return createNewPoEntry(sheet === 'accessories' ? 'ACCESSORIES' : 'ASSET', user);
});

app.post('/app/admin/new-po/items/bulk-create', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageNewPo(user)) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission to create New PO rows.'
    });
  }

  const payload = newPoBulkCreateSchema.parse(request.body);
  const sheet = payload.sheet === 'accessories' ? 'ACCESSORIES' : 'ASSET';
  return createNewPoEntries(sheet, payload.count, user);
});

app.patch('/app/admin/new-po/items/:entryId', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageNewPo(user)) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission to update New PO rows.'
    });
  }

  const entryId = textQuerySchema.parse((request.params as { entryId?: unknown } | undefined)?.entryId);
  const payload = newPoEntryMutationSchema.parse(request.body);
  return updateNewPoEntry(entryId, payload, user);
});

app.post('/app/admin/new-po/items/bulk-update', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageNewPo(user)) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission to update New PO rows.'
    });
  }

  const payload = newPoBulkUpdateSchema.parse(request.body);
  return updateNewPoEntries(payload.updates, user);
});

app.delete('/app/admin/new-po/items/:entryId', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageNewPo(user)) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission to delete New PO rows.'
    });
  }

  const entryId = textQuerySchema.parse((request.params as { entryId?: unknown } | undefined)?.entryId);
  try {
    return await deleteNewPoEntry(entryId, user);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete row.';
    const status = /not found/i.test(message) ? 404 : 400;
    return reply.status(status).send({ ok: false, message });
  }
});

app.post('/app/admin/new-po/items/bulk-delete', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (!canManageNewPo(user)) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission to delete New PO rows.'
    });
  }

  const payload = newPoBulkDeleteSchema.parse(request.body);
  return deleteNewPoEntries(payload.ids, user);
});

app.get('/app/sync-admin', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const [
    assetCount,
    catalogCount,
    handoverCount,
    procurementCount,
    ledgerCount,
    holdingsCount,
    rawImportRows,
    batches
  ] = await Promise.all([
    prisma.asset.count(),
    prisma.catalogItem.count(),
    prisma.handoverDocument.count(),
    prisma.procurementRequest.count(),
    prisma.assetAssignmentLedgerEntry.count(),
    prisma.employeeAssetHolding.count(),
    prisma.workbookImportRow.count(),
    prisma.workbookImportBatch.findMany({
      orderBy: { startedAt: 'desc' },
      take: 8
    })
  ]);

  return {
    ok: true,
    counts: {
      assetCount,
      catalogCount,
      handoverCount,
      procurementCount,
      ledgerCount,
      holdingsCount,
      rawImportRows
    },
    batches
  };
});

// Admin Portal Endpoints
app.get('/app/admin/roles', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const userRoles = (user.roles || []).map(normalizeRole);
  const isSuperAdmin = userRoles.some((r) => r.includes('SUPER'));
  if (!isSuperAdmin) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission to access admin portal.'
    });
  }

  const items = await prisma.role.findMany({
    select: {
      id: true,
      name: true
    },
    orderBy: { name: 'asc' }
  });

  return {
    ok: true,
    items
  };
});

app.post('/app/admin/users', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const userRoles = (user.roles || []).map(normalizeRole);
  const isSuperAdmin = userRoles.some((r) => r.includes('SUPER'));
  if (!isSuperAdmin) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission to access admin portal.'
    });
  }

  const { search, page, pageSize } = parseListQuery(request.query);
  const q = trimSearch(search);
  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: 'insensitive' as const } },
          { fullName: { contains: q, mode: 'insensitive' as const } }
        ]
      }
    : undefined;

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        createdAt: true,
        userRoles: {
          select: {
            role: {
              select: { id: true, name: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);

  const items = users.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    isActive: u.isActive,
    roles: u.userRoles.map((ur) => ur.role),
    createdAt: u.createdAt
  }));

  return {
    ok: true,
    meta: makePageMeta(page, pageSize, total),
    items
  };
});

app.post('/app/admin/users/:userId/roles', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const userRoles = (user.roles || []).map(normalizeRole);
  const isSuperAdmin = userRoles.some((r) => r.includes('SUPER'));
  if (!isSuperAdmin) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission for this action.'
    });
  }

  const { userId } = request.params as { userId: string };
  const { roleId } = request.body as { roleId: string };

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) {
    return reply.status(404).send({
      ok: false,
      message: 'User not found.'
    });
  }

  try {
    const userRole = await prisma.userRole.create({
      data: { userId, roleId },
      include: { role: true }
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorEmail: user.email,
        module: 'admin',
        action: 'ASSIGN_ROLE',
        entityType: 'user',
        entityId: userId,
        payloadJson: { roleId, roleName: userRole.role.name }
      }
    });

    return {
      ok: true,
      message: 'Role assigned successfully.',
      role: userRole.role
    };
  } catch (error) {
    return reply.status(400).send({
      ok: false,
      message: 'Failed to assign role. User may already have this role.'
    });
  }
});

app.delete('/app/admin/users/:userId/roles/:roleId', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const userRoles = (user.roles || []).map(normalizeRole);
  const isSuperAdmin = userRoles.some((r) => r.includes('SUPER'));
  if (!isSuperAdmin) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission for this action.'
    });
  }

  const { userId, roleId } = request.params as { userId: string; roleId: string };

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    include: { userRoles: { include: { role: true } } }
  });

  if (!targetUser) {
    return reply.status(404).send({
      ok: false,
      message: 'User not found.'
    });
  }

  // Prevent last SUPER_ADMIN from losing their role
  if (targetUser.userRoles.some((ur) => ur.role.name === 'SUPER_ADMIN')) {
    const otherSuperAdmins = await prisma.user.count({
      where: {
        id: { not: userId },
        userRoles: {
          some: {
            role: { name: 'SUPER_ADMIN' }
          }
        }
      }
    });

    if (otherSuperAdmins === 0 && targetUser.userRoles.length === 1) {
      return reply.status(400).send({
        ok: false,
        message: 'Cannot remove last SUPER_ADMIN role.'
      });
    }
  }

  try {
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    await prisma.userRole.delete({
      where: {
        userId_roleId: { userId, roleId }
      }
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorEmail: user.email,
        module: 'admin',
        action: 'REMOVE_ROLE',
        entityType: 'user',
        entityId: userId,
        payloadJson: { roleId, roleName: role?.name }
      }
    });

    return {
      ok: true,
      message: 'Role removed successfully.'
    };
  } catch (error) {
    return reply.status(400).send({
      ok: false,
      message: 'Failed to remove role.'
    });
  }
});

app.patch('/app/admin/users/:userId/status', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const userRoles = (user.roles || []).map(normalizeRole);
  const isSuperAdmin = userRoles.some((r) => r.includes('SUPER'));
  if (!isSuperAdmin) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission for this action.'
    });
  }

  const { userId } = request.params as { userId: string };
  const { isActive } = request.body as { isActive: boolean };

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetUser) {
    return reply.status(404).send({
      ok: false,
      message: 'User not found.'
    });
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { isActive }
  });

  // Log audit
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorEmail: user.email,
      module: 'admin',
      action: isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      entityType: 'user',
      entityId: userId
    }
  });

  return {
    ok: true,
    message: `User ${isActive ? 'activated' : 'deactivated'} successfully.`,
    user: { id: updatedUser.id, email: updatedUser.email, isActive: updatedUser.isActive }
  };
});

app.get('/app/admin/audit-logs', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const userRoles = (user.roles || []).map(normalizeRole);
  const isSuperAdmin = userRoles.some((r) => r.includes('SUPER'));
  if (!isSuperAdmin) {
    return reply.status(403).send({
      ok: false,
      message: 'You do not have permission to view audit logs.'
    });
  }

  const { page, pageSize } = parseListQuery(request.query);

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where: { module: 'admin' } }),
    prisma.auditLog.findMany({
      where: { module: 'admin' },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);

  return {
    ok: true,
    meta: makePageMeta(page, pageSize, total),
    items: logs
  };
});

app.get('/files/handover/:kind/:file', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const params = request.params as { kind: string; file: string };
  const absolutePath = getStoredHandoverFilePath(params.kind, params.file);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    return reply.status(404).send({
      ok: false,
      message: 'Requested file was not found.'
    });
  }

  reply.type(getStoredHandoverFileContentType(params.file));
  return reply.send(fs.createReadStream(absolutePath));
});

app.get('/files/procurement/evidence/:file', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const params = request.params as { file: string };
  const absolutePath = getStoredProcurementEvidencePath(params.file);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    return reply.status(404).send({
      ok: false,
      message: 'Requested evidence file was not found.'
    });
  }

  reply.type(getStoredProcurementEvidenceContentType(params.file));
  return reply.send(fs.createReadStream(absolutePath));
});

app.post('/rpc/:method', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;

  const method = String((request.params as { method?: string } | undefined)?.method || '').trim();
  const body = (request.body && typeof request.body === 'object') ? request.body as { args?: unknown[] } : {};
  const args = Array.isArray(body.args) ? body.args : [];

  switch (method) {
    case 'getAssetDashboardSummary':
      return getParityItamDashboardSummary((args[0] as { forceRefresh?: boolean } | undefined) || {});
    case 'getMasterReferences':
      return getParityMasterReferences();
    case 'getHandoverDependencies':
      return getParityHandoverDependencies();
    case 'getHandoverSigners':
      return await getParityHandoverSigners();
    case 'searchHandoverEmployees':
      return searchParityHandoverEmployees(String(args[0] || ''), args[1] === undefined ? 8 : Number(args[1]));
    case 'getEmployeeDirectoryDetail':
      return getParityEmployeeDirectoryDetail(String(args[0] || ''));
    case 'getEmployeeDirectoryHistoryDetail':
      return getParityEmployeeDirectoryHistoryDetail(String(args[0] || ''), args[1] === undefined ? undefined : Number(args[1]));
    case 'getAssetDetail':
      return getParityAssetDetail(String(args[0] || ''), (args[1] as { includeHolders?: boolean } | undefined) || {});
    case 'getAssetCurrentHolders':
      return getParityAssetCurrentHolders(String(args[0] || ''));
    case 'getHandoverDetail':
      return getParityHandoverDetail(String(args[0] || ''));
    case 'getHandoverHistory':
      return getParityHandoverHistory();
    case 'getDataFromSheet':
      return getParityProcurementRows('monitoring');
    case 'getArchiveData':
      return getParityProcurementRows('archive');
    case 'submitProcurementRequest':
      return submitParityProcurementRequest(args[0] as Record<string, unknown>, {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        roles: user.roles
      });
    case 'updateRequestStatus':
      return updateParityProcurementRequest(args[0] as Record<string, unknown>, {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        roles: user.roles
      });
    case 'checkAssetTagExistence':
      return checkParityAssetTagExistence(String(args[0] || ''));
    case 'submitHandoverTransaction':
      return submitParityHandoverTransaction(args[0], {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        roles: user.roles
      });
    default:
      return reply.status(404).send({
        ok: false,
        message: `RPC method ${method || '(empty)'} is not implemented yet.`
      });
  }
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  if (error instanceof z.ZodError) {
    return reply.status(400).send({
      ok: false,
      message: error.issues.map((issue) => issue.message).join('; ') || 'Invalid request payload.'
    });
  }

  const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
    ? Number((error as { statusCode?: unknown }).statusCode)
    : 500;

  if (statusCode >= 400 && statusCode < 500) {
    const message = error instanceof Error ? error.message : 'Request failed.';
    return reply.status(statusCode).send({
      ok: false,
      message
    });
  }

  reply.status(500).send({
    ok: false,
    message: 'Internal server error'
  });
});

const host = '0.0.0.0';
await ensureLocalSuperAdmin();
await app.listen({ host, port: env.API_PORT });
