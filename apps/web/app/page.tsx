'use client';

export const dynamic = 'force-dynamic';

import { ChangeEvent, ClipboardEvent, DragEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { HandoverFormWorkspace } from './components/handover-form';
import { AdminPortal } from './components/admin-portal';
import { NewPoPortal } from './components/new-po-portal';
import { fetchPageJson, rpcCall } from './lib/atlas-rpc';

type AuthUser = {
  id: string;
  email: string;
  username?: string | null;
  fullName?: string | null;
  roles: string[];
};

type ModuleKey =
  | 'dashboard'
  | 'procurementInput'
  | 'procurementMonitoring'
  | 'procurementArchive'
  | 'employeeDatabase'
  | 'masterReference'
  | 'catalog'
  | 'assets'
  | 'holdings'
  | 'sync'
  | 'handoverForm'
  | 'handoverList'
  | 'newPo'
  | 'adminPortal';

type PageMeta = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

type DashboardOwnerBucket = {
  label: string;
  units: number;
  sharePct: number;
};

type DashboardParityResponse = {
  ok: boolean;
  generatedAt: string;
  source: string;
  snapshot: {
    totalUnits: number;
    totalRows: number;
    allocatedUnits: number;
    allocatedUserUnits: number;
    allocatedSharedUnits: number;
    ownerAccounts: number;
    categories: number;
    ownerAccountByUnits: DashboardOwnerBucket[];
    sharedAccountByUnits: DashboardOwnerBucket[];
    categoryByUnits: DashboardOwnerBucket[];
  };
  dataQuality: {
    missingOwnerRows: number;
    missingPurchaseDateRows: number;
    inUseWithoutHolderRows: number;
    availableWithHolderRows: number;
    missingInvoiceRows: number;
    note?: string;
  };
  health: {
    assetListLastSync?: string;
    holdingsLastSync?: string;
    assignmentLedgerLastSync?: string;
    notices?: string[];
  };
};

type ProcurementRow = {
  timestamp: unknown;
  requestNumber: string;
  requestSource: string;
  sourceReference: string;
  processorEmail: string;
  itemSummary: string;
  quantity: number;
  requestorName: string;
  fulfillment: string;
  referenceNo: string;
  status: string;
  notes: string;
  logText: string;
  statusRemark: string;
};

type ProcurementEvidencePreview = {
  src: string;
  name: string;
};

type HandoverRow = {
  timestamp: unknown;
  docNumber: string;
  transactionType: string;
  holderName: string;
  holderNik: string;
  holderDepartment: string;
  rawItemsText: string;
  notes: string;
  status: string;
  pdfUrl: string;
  rawPayload: string;
  rawRevision: string;
};

type AssetDetailHistoryEntry = {
  timestamp: string;
  docID: string;
  rowType: string;
  transType: string;
  userName: string;
  userNIK: string;
  dept: string;
  itemType: string;
  itemSku: string;
  qty: number;
  qtyDelta: number;
  qtyDisplay: string;
  notes: string;
  status: string;
  pdfUrl: string;
  bastMode: string;
  signerIT: string;
  signerUser: string;
  isShared: boolean;
  isBroken: boolean;
  sharedAccount: string;
  sharedDept: string;
  sharedDetail: string;
};

type AssetDetailResponse = {
  success: boolean;
  message?: string;
  asset?: Record<string, unknown>;
  history?: AssetDetailHistoryEntry[];
};

type AssetListSortKey =
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

type AssetListItem = {
  id: string;
  assetTag: string;
  serialNumber: string;
  itemModel: string;
  category: string;
  quantity: number;
  status: string;
  assignedToText: string;
  assignedAccount: string;
  assignedDept: string;
  location: string;
  invoiceNumber: string;
  orderNumber: string;
  vendorName: string;
  ownerAccount: string;
  ownerDepartment: string;
};

type AssetEditorState = {
  originalTag: string;
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
  saving: boolean;
  message: { kind: 'success' | 'error'; text: string } | null;
};

type AssetCreatorState = {
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
  initialQuantity: string;
  saving: boolean;
  message: { kind: 'success' | 'error'; text: string } | null;
};

type AssetQtyEditorState = {
  assetTag: string;
  currentQty: number;
  delta: string;
  remark: string;
  saving: boolean;
  message: { kind: 'success' | 'error'; text: string } | null;
};

type AssetDeleteState = {
  assetTag: string;
  itemModel: string;
  deleting: boolean;
  message: { kind: 'success' | 'error'; text: string } | null;
};

type CatalogManagerItem = {
  id: string;
  category: string;
  sku: string;
  account: string;
  specification: string;
  estimatedPrice: string;
};

type MasterReferenceDepartmentItem = {
  id: string;
  value: string;
  parentLink: string;
  key: string;
};

type MasterReferenceGroupItem = {
  id: string;
  account: string;
  key: string;
  departmentCount: number;
  departments: MasterReferenceDepartmentItem[];
};

type CatalogCategoryEditorState = {
  name: string;
  saving: boolean;
  message: { kind: 'success' | 'error'; text: string } | null;
};

type CatalogSkuEditorState = {
  mode: 'add' | 'edit';
  originalSku: string;
  category: string;
  sku: string;
  account: string;
  specification: string;
  estimatedPrice: string;
  saving: boolean;
  message: { kind: 'success' | 'error'; text: string } | null;
};

type CatalogDeleteState = {
  kind: 'category' | 'sku';
  targetName: string;
  subtitle: string;
  deleting: boolean;
  message: { kind: 'success' | 'error'; text: string } | null;
};

type EmployeeDirectoryDetailResponse = {
  success: boolean;
  message?: string;
  employee?: {
    employeeKey: string;
    nik: string;
    fullName: string;
    email: string;
    account: string;
    dept: string;
    title: string;
  };
  holdings?: Array<{
    tag: string;
    assetRef: string;
    itemModel: string;
    category: string;
    qty: number;
    location: string;
    status: string;
  }>;
  summary?: {
    totalDistinct: number;
    totalUnits: number;
  };
  snapshotState?: {
    version?: number;
    lastSyncMs?: number;
    stale?: boolean;
    missing?: boolean;
    reason?: string;
  };
};

type EmployeeDirectoryHistoryResponse = {
  success: boolean;
  message?: string;
  employee?: {
    employeeKey: string;
    nik: string;
    fullName: string;
    email: string;
    account: string;
    dept: string;
    title: string;
  };
  historySummary?: Array<{
    tag: string;
    assetRef: string;
    itemModel: string;
    category: string;
    firstOutAt: string;
    lastInAt: string;
    currentSince: string;
    currentState: string;
  }>;
  historyEvents?: Array<{
    tsIso: string;
    transType: string;
    direction: string;
    tag: string;
    assetRef: string;
    itemModel: string;
    category: string;
    qty: number;
    location: string;
    docId: string;
    status: string;
    pdfUrl: string;
  }>;
  historyMeta?: {
    assetsTouched: number;
    eventCount: number;
    countableEventCount: number;
  };
};

type HandoverDetailResponse = {
  success: boolean;
  message?: string;
  handover?: Record<string, unknown>;
  resumeState?: {
    canResume?: boolean;
    strictMode?: boolean;
    itSigned?: boolean;
    userSigned?: boolean;
  };
  resumePayload?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  signatures?: {
    it: Record<string, unknown>;
    user: Record<string, unknown>;
  };
  auditTrail?: Array<Record<string, unknown>>;
  revisionHistory?: Array<Record<string, unknown>>;
};

type ProcurementActivity = {
  timestamp: string;
  sortTs: number;
  user: string;
  status: string;
  message: string;
  kind: 'log' | 'remark' | 'system';
};

type DetailModalState = {
  kind: 'asset' | 'employee' | 'handover' | 'procurement' | 'catalog' | 'reference';
  title: string;
  subtitle?: string;
  loading: boolean;
  error: string;
  data: unknown | null;
};

type BootstrapResponse = {
  user: AuthUser;
  summary: {
    assetCount: number;
    catalogCount: number;
    holdingsCount: number;
    handoverCount: number;
    procurementCount: number;
    ledgerCount: number;
    referenceCount: number;
    locationCount: number;
  };
  portfolio: {
    totalUnits: number;
    assetRows: number;
    assignedUnits: number;
    assignedToUserUnits: number;
    assignedToAccountUnits: number;
    availableUnits: number;
    ownerAccounts: number;
    activeCategories: number;
    latestAssetUpdatedAt?: string | null;
    topOwnerAccounts: DashboardOwnerBucket[];
  };
  latestImport?: Record<string, unknown> | null;
  recentHandovers: Array<Record<string, unknown>>;
  recentProcurement: Array<Record<string, unknown>>;
};

type ModuleResponse = {
  items?: Array<Record<string, unknown>>;
  meta?: PageMeta;
  counts?: Record<string, number>;
  batches?: Array<Record<string, unknown>>;
  masterReferences?: {
    source?: string;
    syncedAt?: string;
    accounts?: string[];
    departments?: string[];
    groups?: MasterReferenceGroupItem[];
  };
  catalog?: {
    categories?: Array<{
      name?: string;
      itemCount?: number;
    }>;
    accountOptions?: string[];
    totalItems?: number;
    totalCategories?: number;
  };
  directory?: {
    provider?: string;
    futureProvider?: string;
    googleWorkspaceReady?: boolean;
    hostedDomain?: string;
    identityMode?: string;
  };
};

type AuthReadinessResponse = {
  ok: boolean;
  googleEnabled: boolean;
  googleClientReady: boolean;
  hostedDomain: string;
  localAuthEnabled: boolean;
  message: string;
};

type EmployeeDirectoryItem = {
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
};

type ProcurementInputResult = {
  success: boolean;
  message?: string;
  requestNumber?: string;
};

type ProcurementEvidenceDraft = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

type ProcurementUpdateResult = {
  success: boolean;
  message?: string;
  item?: Record<string, unknown>;
};

type ProcurementEditorState = {
  requestNumber: string;
  sourceLabel: string;
  itemSummary: string;
  fulfillmentBase: 'Stock' | 'Purchase';
  purchaseMode: 'PO' | 'E-Commerce';
  purchaseReference: string;
  status: string;
  remark: string;
  evidence: ProcurementEvidenceDraft[];
  canEditData: boolean;
  canEditPO: boolean;
  canUpdateStatus: boolean;
  saving: boolean;
};

type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  navLabel: string;
  icon: string;
  headerTitle: string;
  headerSubtitle: string;
  searchPlaceholder?: string;
  endpoint?: string;
  flowState?: 'live' | 'read_only' | 'pending';
};

type NavGroup = {
  key: 'procurement' | 'masterData' | 'assetMgmt' | 'assetOps' | 'admin';
  label: string;
  icon: string;
  items: ModuleKey[];
};

function normalizeRoleLabel(role: string) {
  return String(role || '').trim().toUpperCase();
}

function isPortalUserRole(role: string) {
  return ['USER', 'WFH', 'WFO', 'WFH_WFO'].includes(normalizeRoleLabel(role));
}

function isAdminLikeRole(role: string) {
  const normalized = normalizeRoleLabel(role);
  return normalized.includes('SUPER') || normalized === 'ADMIN' || normalized.includes('IT_OPS') || normalized.includes('IT OPS');
}

function formatRoleLabel(role: string) {
  const normalized = normalizeRoleLabel(role);
  if (normalized.includes('SUPER')) return 'Super Admin';
  if (normalized === 'ADMIN' || normalized.includes('IT_OPS') || normalized.includes('IT OPS')) return 'Admin';
  if (isPortalUserRole(normalized)) return 'User';
  return normalized.replaceAll('_', ' ');
}

function canAccessDashboard(user: AuthUser | null) {
  if (!user) return false;
  const roles = user.roles.map(normalizeRoleLabel);
  return !roles.some(isPortalUserRole);
}

function canAccessModuleByRole(user: AuthUser | null, moduleKey: ModuleKey) {
  if (!user) return false;
  const roles = user.roles.map(normalizeRoleLabel);

  if (moduleKey === 'newPo') {
    return roles.some((role) =>
      role.includes('SUPER') ||
      role === 'ADMIN' ||
      role.includes('IT_OPS') ||
      role.includes('IT OPS') ||
      role.includes('PROCUREMENT') ||
      role.includes('ASSET')
    );
  }

  // Admin portal - SUPER_ADMIN only
  if (moduleKey === 'adminPortal') {
    return roles.some((role) => role.includes('SUPER'));
  }

  const isSuperAdmin = roles.some((role) => role.includes('SUPER'));
  const isAdmin = roles.includes('ADMIN') || roles.some((role) => role.includes('IT_OPS') || role.includes('IT OPS'));
  if (isSuperAdmin || isAdmin) return true;

  const isPortalUser = roles.some(isPortalUserRole);
  if (isPortalUser) {
    return moduleKey === 'handoverForm' || moduleKey === 'handoverList' || moduleKey === 'holdings';
  }

  const isVp = roles.includes('VP');
  const isBod = roles.includes('BOD');
  const isFinanceManager = roles.includes('FINANCE MANAGER');
  const isFinance = roles.includes('FINANCE');
  if (isVp || isBod || isFinanceManager || isFinance) {
    return (
      moduleKey === 'procurementMonitoring' ||
      moduleKey === 'procurementArchive' ||
      moduleKey === 'handoverForm' ||
      moduleKey === 'handoverList'
    );
  }

  return true;
}

function getVisibleNavGroups(user: AuthUser | null) {
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((itemKey) => canAccessModuleByRole(user, itemKey))
    }))
    .filter((group) => group.items.length > 0);
}

function getGroupKeyForModule(moduleKey: ModuleKey) {
  const match = NAV_GROUPS.find((group) => group.items.includes(moduleKey));
  return match?.key || null;
}

function normalizeUiRole(role: unknown) {
  return String(role ?? '')
    .trim()
    .replace(/[^A-Z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function canManageAssetActions(user: AuthUser | null) {
  const roles = Array.isArray(user?.roles) ? user?.roles.map(normalizeUiRole) : [];
  return roles.some((role) =>
    role.includes('SUPER') ||
    role === 'ADMIN' ||
    role.includes('IT_OPS') ||
    role.includes('ASSET')
  );
}

function canManageCatalogActions(user: AuthUser | null) {
  return canManageAssetActions(user);
}

function canManageMasterReferenceActions(user: AuthUser | null) {
  return canManageAssetActions(user);
}

const MODULES: Record<ModuleKey, ModuleDefinition> = {
  dashboard: {
    key: 'dashboard',
    label: 'ITAM Dashboard',
    navLabel: 'ITAM Dashboard',
    icon: 'dashboard',
    headerTitle: 'ATLAS - ITAM DASHBOARD',
    headerSubtitle:
      'EXECUTIVE ASSET SUMMARY FOCUSED ON TOTAL PORTFOLIO, ASSIGNMENT SPLIT, OWNERSHIP FOOTPRINT, AND SHARED-ACCOUNT ALLOCATION.',
    flowState: 'live'
  },
  procurementInput: {
    key: 'procurementInput',
    label: 'Input Request',
    navLabel: 'Input Request',
    icon: 'add_shopping_cart',
    headerTitle: 'NEW PROCUREMENT REQUEST',
    headerSubtitle:
      'SUBMIT REQUESTOR DETAILS, SOURCE REFERENCE, AND RAW REQUEST DATA FOR PROCESSING INTO THE DATABASE.',
    flowState: 'live'
  },
  procurementMonitoring: {
    key: 'procurementMonitoring',
    label: 'Monitoring',
    navLabel: 'Monitoring',
    icon: 'visibility',
    headerTitle: 'LIVE MONITORING',
    headerSubtitle:
      'ACTIVE PROCUREMENT REQUESTS WITH REAL-TIME STATUS TRACKING, FULFILLMENT PROGRESS, AND OPERATIONAL MONITORING.',
    searchPlaceholder: 'Search ID, Requestor, Item, PO/Invoice, or note...',
    endpoint: '/api/app/procurement?view=monitoring',
    flowState: 'read_only'
  },
  procurementArchive: {
    key: 'procurementArchive',
    label: 'Archive',
    navLabel: 'Archive',
    icon: 'archive',
    headerTitle: 'COMPLETED ARCHIVE',
    headerSubtitle:
      'ARCHIVED PROCUREMENT RECORDS FOR HISTORICAL REFERENCE, AUDIT TRAIL, AND COMPLETED REQUEST TRACKING.',
    searchPlaceholder: 'Search archive...',
    endpoint: '/api/app/procurement?view=archive',
    flowState: 'read_only'
  },
  employeeDatabase: {
    key: 'employeeDatabase',
    label: 'Employee Database',
    navLabel: 'Employee Database',
    icon: 'badge',
    headerTitle: 'MASTER EMPLOYEE DATABASE',
    headerSubtitle:
      'EMPLOYEE DIRECTORY WITH ACCOUNT ASSIGNMENT, DEPARTMENT MAPPING, AND ORGANIZATIONAL STRUCTURE.',
    searchPlaceholder: 'Search employee key, NIK, name, email, account, or department',
    endpoint: '/api/app/employees',
    flowState: 'read_only'
  },
  masterReference: {
    key: 'masterReference',
    label: 'Master Reference',
    navLabel: 'Master Reference',
    icon: 'settings_suggest',
    headerTitle: 'ORGANIZATION STRUCTURE (ACCOUNT & DEPT)',
    headerSubtitle:
      'REFERENCE LOOKUPS FOR OPTION SETS, PARENT RELATIONSHIPS, AND OPERATIONAL CONFIGURATION VALUES.',
    searchPlaceholder: 'Search account or department',
    endpoint: '/api/app/master-references/structured',
    flowState: 'read_only'
  },
  catalog: {
    key: 'catalog',
    label: 'Catalog Management',
    navLabel: 'Catalog Management',
    icon: 'list_alt',
    headerTitle: 'MASTER CATALOG MANAGEMENT',
    headerSubtitle:
      'CATALOG MASTER DATA WITH CATEGORY, SPECIFICATION, AND ACCOUNT MAPPING.',
    searchPlaceholder: 'Search item name, category, or specs...',
    endpoint: '/api/app/catalog',
    flowState: 'read_only'
  },
  assets: {
    key: 'assets',
    label: 'List Asset',
    navLabel: 'List Asset',
    icon: 'qr_code_2',
    headerTitle: 'LIST ASSET',
    headerSubtitle:
      'COMPLETE ASSET INVENTORY WITH TAG TRACKING, HOLDER ASSIGNMENT, AND OPERATIONAL STATUS.',
    searchPlaceholder: 'Search Asset Tag, SN, PO Number, Invoice, User, or Sharing Account...',
    endpoint: '/api/app/assets',
    flowState: 'read_only'
  },
  holdings: {
    key: 'holdings',
    label: 'Employee Asset Holdings',
    navLabel: 'Employee Asset Holdings',
    icon: 'inventory',
    headerTitle: 'EMPLOYEE ASSET HOLDINGS',
    headerSubtitle:
      'EMPLOYEE-TO-ASSET HOLDINGS WITH HOLDER-LEVEL DETAIL, ASSIGNMENT TRACKING, AND ACCOUNTABILITY.',
    searchPlaceholder: 'Search NIK, Name, Email, Account, Department...',
    endpoint: '/api/app/holdings',
    flowState: 'read_only'
  },
  sync: {
    key: 'sync',
    label: 'Asset Sync Admin',
    navLabel: 'Asset Sync Admin',
    icon: 'sync_alt',
    headerTitle: 'ASSET SYNC ADMIN',
    headerSubtitle:
      'DATA IMPORT HEALTH, RECORD COUNTS, AND CONSISTENCY STATUS.',
    endpoint: '/api/app/sync-admin',
    flowState: 'read_only'
  },
  handoverForm: {
    key: 'handoverForm',
    label: 'Handover Form (BAST)',
    navLabel: 'Handover Form (BAST)',
    icon: 'assignment_return',
    headerTitle: 'ASSET HANDOVER FORM (BAST)',
    headerSubtitle:
      'Select Standard, WFH, or WFO before filling the form.',
    flowState: 'live'
  },
  handoverList: {
    key: 'handoverList',
    label: 'Handover List',
    navLabel: 'Handover List',
    icon: 'view_list',
    headerTitle: 'HANDOVER LIST (BAST TRACKING)',
    headerSubtitle:
      'Completed BAST document history for holder traceability, PDF access, and document tracking.',
    searchPlaceholder: 'Search Doc ID, Name, or NIK...',
    endpoint: '/api/app/handover',
    flowState: 'read_only'
  },
  adminPortal: {
    key: 'adminPortal',
    label: 'Admin Portal',
    navLabel: 'Admin Portal',
    icon: 'admin_panel_settings',
    headerTitle: 'ADMIN PORTAL',
    headerSubtitle: 'USER MANAGEMENT, ROLE ASSIGNMENT, AND AUDIT LOGS',
    flowState: 'read_only'
  },
  newPo: {
    key: 'newPo',
    label: 'New PO',
    navLabel: 'New PO',
    icon: 'post_add',
    headerTitle: 'NEW PO LIVE INTAKE',
    headerSubtitle: 'REAL-TIME ASSET AND ACCESSORIES INPUT WITH DIRECT AUTO-SYNC TO LIST ASSET.',
    flowState: 'live'
  }
};

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'procurement',
    label: 'PROCUREMENT REQUEST',
    icon: 'shopping_cart',
    items: ['procurementInput', 'procurementMonitoring', 'procurementArchive']
  },
  {
    key: 'masterData',
    label: 'MASTER DATA',
    icon: 'dns',
    items: ['employeeDatabase', 'masterReference']
  },
  {
    key: 'assetMgmt',
    label: 'ASSET MANAGEMENT',
    icon: 'inventory_2',
    items: ['catalog', 'assets', 'holdings', 'sync']
  },
  {
    key: 'assetOps',
    label: 'ASSET OPS',
    icon: 'handshake',
    items: ['handoverForm', 'handoverList']
  },
  {
    key: 'admin',
    label: 'ADMIN',
    icon: 'admin_panel_settings',
    items: ['newPo', 'adminPortal']
  }
];

function parseUnknownDate(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const epochDate = new Date(value);
    return Number.isNaN(epochDate.getTime()) ? null : epochDate;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;

  if (/^\d{12,}$/.test(raw)) {
    const epochDate = new Date(Number(raw));
    return Number.isNaN(epochDate.getTime()) ? null : epochDate;
  }

  const dayFirstMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (dayFirstMatch) {
    const [, day, month, year, hour, minute, second] = dayFirstMatch;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second || '0')
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value: unknown) {
  const date = parseUnknownDate(value);
  if (!date) return String(value ?? '-');

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatDateOnly(value: unknown) {
  const date = parseUnknownDate(value);
  if (!date) return String(value ?? '-');

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function formatDetailedDate(value: unknown) {
  const date = parseUnknownDate(value);
  if (!date) return String(value ?? '-');

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

function formatNumber(value: unknown) {
  if (typeof value !== 'number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return String(value ?? '-');
    return new Intl.NumberFormat('en-US').format(parsed);
  }

  return new Intl.NumberFormat('en-US').format(value);
}

function formatCurrency(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '-';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(numeric);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function toText(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function StatusBadge({ value }: { value: string }) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const className =
    normalized === 'completed' || normalized === 'deployed'
      ? 'status-badge status-success'
      : normalized === 'approved'
        ? 'status-badge status-approved'
        : normalized === 'requested' || normalized === 'ticketcreated'
          ? 'status-badge status-requested'
          : normalized === 'pending'
            ? 'status-badge status-pending'
            : normalized === 'delivered'
              ? 'status-badge status-delivered'
              : normalized === 'rejected' || normalized === 'cancelled' || normalized === 'pocancelled'
                ? 'status-badge status-danger'
                : 'status-badge status-default';

  return <span className={className}>{value}</span>;
}

function employeeDirectoryStatusTone(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === '-' || normalized === 'pending sync') return 'employee-directory-status pending';
  if (normalized.includes('associate') || normalized.includes('staff') || normalized === 'active') {
    return 'employee-directory-status primary';
  }
  if (normalized.includes('senior supervisor') || normalized.includes('sr supervisor')) {
    return 'employee-directory-status info';
  }
  if (normalized.includes('supervisor')) {
    return 'employee-directory-status warning';
  }
  if (normalized.includes('manager')) {
    return 'employee-directory-status success';
  }
  if (normalized.includes('lead') || normalized.includes('head')) {
    return 'employee-directory-status dark';
  }
  if (
    normalized.includes('inactive') ||
    normalized.includes('terminated') ||
    normalized.includes('resign')
  ) {
    return 'employee-directory-status danger';
  }
  return 'employee-directory-status pending';
}

function AtlasMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth="1.2" />
      <polygon points="16,7 23.5,11.5 23.5,20.5 16,25 8.5,20.5 8.5,11.5" fill="rgba(255,255,255,0.10)" />
      <line stroke="white" strokeLinecap="round" strokeWidth="2" x1="16" x2="9" y1="8" y2="22" />
      <line stroke="white" strokeLinecap="round" strokeWidth="2" x1="16" x2="23" y1="8" y2="22" />
      <line stroke="white" strokeLinecap="round" strokeWidth="2" x1="11.5" x2="20.5" y1="17" y2="17" />
      <circle cx="16" cy="8" fill="#60a5fa" r="2.2" />
      <circle cx="9" cy="22" fill="rgba(255,255,255,0.55)" r="1.6" />
      <circle cx="23" cy="22" fill="rgba(255,255,255,0.55)" r="1.6" />
    </svg>
  );
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M21.805 12.23c0-.79-.071-1.547-.203-2.273H12v4.301h5.488a4.69 4.69 0 0 1-2.035 3.078v2.553h3.289c1.925-1.772 3.063-4.385 3.063-7.659Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.76 0 5.074-.914 6.765-2.479l-3.289-2.553c-.913.612-2.079.974-3.476.974-2.671 0-4.935-1.803-5.742-4.227H2.857v2.633A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.258 13.715A5.995 5.995 0 0 1 5.937 12c0-.595.107-1.172.321-1.715V7.652H2.857A10 10 0 0 0 2 12c0 1.61.386 3.135 1.07 4.348l3.188-2.633Z"
        fill="#FBBC05"
      />
      <path
        d="M12 6.058c1.5 0 2.846.516 3.906 1.53l2.93-2.93C17.069 3.016 14.755 2 12 2A10 10 0 0 0 2.857 7.652l3.401 2.633c.807-2.424 3.071-4.227 5.742-4.227Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function formatDateStack(value: unknown) {
  if (!value) return { date: '-', time: '' };
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return { date: String(value), time: '' };
  }
  return {
    date: new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date),
    time: new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date)
  };
}

function getHandoverTypeTone(type: unknown) {
  const normalized = String(type || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (/check\s*in/.test(normalized)) return 'tone-checkin';
  if (/check\s*out\s*wfh/.test(normalized)) return 'tone-wfh';
  if (/check\s*out\s*wfo/.test(normalized)) return 'tone-wfo';
  if (/check\s*out/.test(normalized)) return 'tone-checkout';
  if (/change/.test(normalized)) return 'tone-changes';
  return 'tone-default';
}

function formatHandoverTypeLabel(type: unknown) {
  const normalized = String(type || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (/check\s*in/.test(normalized)) return 'Check In';
  if (/check\s*out\s*wfh/.test(normalized)) return 'Check Out WFH';
  if (/check\s*out\s*wfo/.test(normalized)) return 'Check Out WFO';
  if (/check\s*out/.test(normalized)) return 'Check Out';
  if (/change/.test(normalized)) return 'Changes';
  return toText(type);
}

function TableCard({
  columns,
  rows,
  emptyMessage,
  onRowClick,
  tableClassName
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  emptyMessage: string;
  onRowClick?: (rowIndex: number) => void;
  tableClassName?: string;
}) {
  return (
    <div className="card shadow-sm border-0 mb-3 overflow-hidden">
      <div className="table-responsive">
        <table className={`table table-sm table-striped table-hover align-middle mb-0 atlas-table ${tableClassName || ''}`.trim()}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, rowIndex) => (
                <tr
                  className={onRowClick ? 'is-clickable' : undefined}
                  key={`row-${rowIndex}`}
                  onClick={onRowClick ? () => onRowClick(rowIndex) : undefined}
                >
                  {row.map((cell, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="atlas-empty-cell" colSpan={columns.length}>
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const DEFAULT_PAGE_SIZE = 20;

function paginateItems<T extends Record<string, unknown>>(items: T[], page: number, pageSize = DEFAULT_PAGE_SIZE): ModuleResponse {
  const total = items.length;
  const safePage = Math.max(1, page);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(safePage, pageCount);
  const start = (currentPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    meta: {
      page: currentPage,
      pageSize,
      total,
      pageCount
    }
  };
}

function mapProcurementRows(rows: unknown[]) {
  return (Array.isArray(rows) ? rows : []).map((entry) => {
    const row = Array.isArray(entry) ? entry : [];
    return {
      timestamp: row[0],
      requestNumber: row[1],
      requestSource: row[2],
      sourceReference: row[3],
      processorEmail: row[4],
      itemSummary: row[5],
      quantity: Number(row[6]) || 0,
      requestorName: row[7],
      fulfillment: row[8],
      referenceNo: row[9],
      status: row[10],
      notes: row[11],
      logText: row[12],
      statusRemark: row[13]
    } satisfies ProcurementRow;
  });
}

function mapHandoverRows(rows: unknown[]) {
  return (Array.isArray(rows) ? rows : []).map((entry) => {
    const row = Array.isArray(entry) ? entry : [];
    return {
      timestamp: row[0],
      docNumber: row[1],
      transactionType: row[2],
      holderName: row[3],
      holderNik: row[4],
      holderDepartment: row[5],
      rawItemsText: row[6],
      notes: row[7],
      status: row[8],
      pdfUrl: row[9],
      rawPayload: row[10],
      rawRevision: row[11]
    } satisfies HandoverRow;
  });
}

function parseAtlasDayFirstDateTime(value: string) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  const [, day, month, year, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second || '0')
  ).getTime();
}

function formatActivityActor(value: unknown) {
  let raw = String(value ?? '').trim();
  if (!raw) return 'System';
  if (raw.includes('@')) raw = raw.split('@')[0];
  if (/\s/.test(raw)) return raw;
  return raw
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ''))
    .join(' ');
}

function splitBracketedEntries(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  return raw.split(/\r?\n(?=\[)/).map((entry) => entry.trim()).filter(Boolean);
}

function buildProcurementActivities(item: ProcurementRow) {
  const activities: ProcurementActivity[] = [];
  const fallbackTs = parseAtlasDayFirstDateTime(String(item.timestamp ?? ''));
  const fallbackStamp = fallbackTs ? formatDetailedDate(fallbackTs) : formatDetailedDate(item.timestamp);

  function parseEntry(entry: string, kind: ProcurementActivity['kind']) {
    if (!entry) return null;
    const match = entry.match(/^\[(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?) by (.*?)\]\s*([\s\S]*)$/);
    if (match) {
      const [, stamp, actor, rawContent] = match;
      let status = kind === 'remark' ? 'Remark' : 'Update';
      let message = rawContent.trim();
      const statusMatch = message.match(/^\[(.*?)\]:\s*([\s\S]*)$/);
      if (statusMatch) {
        status = statusMatch[1];
        message = statusMatch[2];
      } else if (kind === 'log' && /processed by ai|fallback|system/i.test(message)) {
        status = 'System Process';
      }

      return {
        timestamp: formatDetailedDate(stamp),
        sortTs: parseAtlasDayFirstDateTime(stamp),
        user: formatActivityActor(actor),
        status,
        message,
        kind
      } satisfies ProcurementActivity;
    }

    const raw = String(entry).trim();
    if (!raw) return null;
    const isAutoCreated = /processed by ai|processed by manual fallback/i.test(raw);
    return {
      timestamp: fallbackStamp,
      sortTs: fallbackTs,
      user: /processed by ai/i.test(raw) ? 'Gemini AI 2.5' : isAutoCreated ? 'ATLAS Parser' : 'System',
      status: isAutoCreated ? 'Auto-Created' : 'System Log',
      message: raw,
      kind: 'system'
    } satisfies ProcurementActivity;
  }

  splitBracketedEntries(item.logText).forEach((entry) => {
    const parsed = parseEntry(entry, 'log');
    if (parsed) activities.push(parsed);
  });
  splitBracketedEntries(item.statusRemark).forEach((entry) => {
    const parsed = parseEntry(entry, 'remark');
    if (parsed) activities.push(parsed);
  });

  activities.push({
    timestamp: fallbackStamp,
    sortTs: fallbackTs,
    user: formatActivityActor(item.processorEmail || item.requestorName || 'System'),
    status: 'Ticket Created',
    message: 'Request submitted to system.',
    kind: 'system'
  });

  return activities.sort((left, right) => right.sortTs - left.sortTs);
}

const PROCUREMENT_STATUS_FLOW = [
  'Requested',
  'Approved',
  'Pending',
  'PO issued',
  'PO Cancelled',
  'On Purchased',
  'Delivered',
  'Ready to Deploy',
  'Deployed',
  'Completed',
  'Rejected'
];

function normalizeAtlasToken(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getProcurementStatusTone(value: unknown) {
  const normalized = normalizeAtlasToken(value);

  if (normalized === 'completed' || normalized === 'deployed') return 'success';
  if (normalized === 'approved') return 'approved';
  if (normalized === 'requested' || normalized === 'ticketcreated') return 'requested';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'delivered') return 'delivered';
  if (normalized === 'readytodeploy') return 'deploy';
  if (normalized === 'rejected' || normalized === 'cancelled' || normalized === 'pocancelled') return 'danger';
  return 'default';
}

function getProcurementActivityIcon(activity: ProcurementActivity) {
  const normalized = normalizeAtlasToken(activity.status);
  if (activity.kind === 'remark') return 'comment';
  if (activity.kind === 'system' && (normalized === 'autocreated' || normalized === 'systemprocess')) return 'smart_toy';
  if (normalized.includes('approved')) return 'check_circle';
  if (normalized.includes('rejected') || normalized.includes('cancelled')) return 'cancel';
  if (normalized.includes('poissued')) return 'receipt_long';
  if (normalized.includes('purchased')) return 'shopping_bag';
  if (normalized.includes('delivered') || normalized.includes('deploy')) return 'inventory_2';
  if (normalized.includes('completed')) return 'verified';
  if (normalized.includes('created')) return 'add_circle_outline';
  return 'info';
}

function splitProcurementItemSummary(value: unknown) {
  return String(value ?? '')
    .split(/\s*,\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getPrimaryRoleLabel(user: AuthUser | null) {
  if (!user?.roles?.length) return 'USER';
  const roles = user.roles.map((role) => formatRoleLabel(role));
  return roles.find((role) => role.includes('SUPER')) || roles[0] || 'USER';
}

function normalizeProcurementFulfillmentMode(value: unknown) {
  const normalized = String(value ?? '').trim();
  if (normalized === 'Purchase - E-Commerce') return { base: 'Purchase' as const, mode: 'E-Commerce' as const };
  if (normalized === 'Purchase - PO' || normalized === 'Purchase') return { base: 'Purchase' as const, mode: 'PO' as const };
  return { base: 'Stock' as const, mode: 'PO' as const };
}

function buildProcurementFulfillmentValue(base: 'Stock' | 'Purchase', mode: 'PO' | 'E-Commerce') {
  if (base !== 'Purchase') return 'Stock';
  return mode === 'E-Commerce' ? 'Purchase - E-Commerce' : 'Purchase - PO';
}

function procurementPurchaseReferenceMeta(mode: 'PO' | 'E-Commerce') {
  return mode === 'E-Commerce'
    ? { label: 'Invoice Number', placeholder: 'Enter invoice number' }
    : { label: 'PO Number', placeholder: '000/PO/IT/ROM/YYYY' };
}

function getProcurementRoleFlags(user: AuthUser | null) {
  const roles = (user?.roles || []).map(normalizeRoleLabel);
  return {
    isSuperAdmin: roles.some((role) => role.includes('SUPER') || role === 'ADMIN'),
    isProcurement: roles.includes('PROCUREMENT'),
    isITOps: roles.includes('IT_OPS') || roles.includes('IT OPS'),
    isFinance: roles.includes('FINANCE')
  };
}

function isProcurementStatusOptionDisabled(
  status: string,
  currentStatus: string,
  user: AuthUser | null
) {
  const roleFlags = getProcurementRoleFlags(user);
  if (roleFlags.isSuperAdmin || roleFlags.isProcurement) return false;
  if (!roleFlags.isITOps) return true;

  const currentIdx = PROCUREMENT_STATUS_FLOW.indexOf(currentStatus);
  const nextIdx = PROCUREMENT_STATUS_FLOW.indexOf(status);

  if (status === 'PO Cancelled') return true;
  if (status === 'PO issued') return true;
  if (status === 'Requested' && currentStatus !== 'Requested') return true;
  if (nextIdx < currentIdx && status !== 'Pending' && !(currentStatus === 'Pending' && status === 'Approved')) return true;

  return false;
}

function coerceProcurementItem(item: Record<string, unknown>): ProcurementRow {
  return {
    timestamp: item.timestamp,
    requestNumber: toText(item.requestNumber),
    requestSource: toText(item.requestSource),
    sourceReference: toText(item.sourceReference),
    processorEmail: toText(item.processorEmail),
    itemSummary: toText(item.itemSummary),
    quantity: Number(item.quantity ?? 0),
    requestorName: toText(item.requestorName),
    fulfillment: toText(item.fulfillment),
    referenceNo: toText(item.referenceNo),
    status: toText(item.status),
    notes: toText(item.notes),
    logText: toText(item.logText),
    statusRemark: toText(item.statusRemark)
  };
}

function buildProcurementEditorState(item: ProcurementRow, user: AuthUser | null, sourceLabel: string): ProcurementEditorState {
  const roleFlags = getProcurementRoleFlags(user);
  const fulfillmentMeta = normalizeProcurementFulfillmentMode(item.fulfillment);
  const referenceNo = toText(item.referenceNo);
  const isStockReference =
    referenceNo === '-' ||
    referenceNo === 'N/A (Stock)' ||
    referenceNo.toLowerCase() === 'n/a' ||
    referenceNo.toLowerCase().includes('stock');
  const canEditData =
    roleFlags.isSuperAdmin ||
    roleFlags.isProcurement ||
    (roleFlags.isITOps && ['Requested', 'Pending', 'Approved'].includes(toText(item.status)));
  const canEditPO = roleFlags.isSuperAdmin || roleFlags.isProcurement;
  const canUpdateStatus = roleFlags.isSuperAdmin || roleFlags.isProcurement || roleFlags.isITOps;

  return {
    requestNumber: toText(item.requestNumber),
    sourceLabel,
    itemSummary: toText(item.itemSummary),
    fulfillmentBase: fulfillmentMeta.base,
    purchaseMode: fulfillmentMeta.mode,
    purchaseReference: isStockReference ? '' : referenceNo,
    status: toText(item.status),
    remark: '',
    evidence: [],
    canEditData,
    canEditPO,
    canUpdateStatus,
    saving: false
  };
}

function buildProcurementEvidenceUrl(fileId: string) {
  return `/api/files/procurement/evidence/${encodeURIComponent(fileId)}`;
}

function coerceAssetListItem(item: Record<string, unknown>): AssetListItem {
  return {
    id: toText(item.id),
    assetTag: toText(item.assetTag),
    serialNumber: toText(item.serialNumber),
    itemModel: toText(item.itemModel),
    category: toText(item.category),
    quantity: Number(item.quantity ?? 0),
    status: toText(item.status),
    assignedToText: toText(item.assignedToText),
    assignedAccount: toText(item.assignedAccount),
    assignedDept: toText(item.assignedDept),
    location: toText(item.location),
    invoiceNumber: toText(item.invoiceNumber),
    orderNumber: toText(item.orderNumber),
    vendorName: toText(item.vendorName),
    ownerAccount: toText(item.ownerAccount),
    ownerDepartment: toText(item.ownerDepartment)
  };
}

function coerceCatalogManagerItem(item: Record<string, unknown>): CatalogManagerItem {
  return {
    id: toText(item.id),
    category: toText(item.category),
    sku: toText(item.sku),
    account: toText(item.account),
    specification: toText(item.specification),
    estimatedPrice: toText(item.estimatedPrice)
  };
}

function coerceEmployeeDirectoryItem(item: Record<string, unknown>): EmployeeDirectoryItem {
  return {
    queryKey: toText(item.queryKey || item.email || item.employeeKey || item.nik || item.fullName),
    employeeKey: toText(item.employeeKey || item.email || item.nik || item.fullName),
    nik: toText(item.nik),
    fullName: toText(item.fullName || item.employeeKey),
    email: toText(item.email),
    account: toText(item.account),
    department: toText(item.department),
    title: String(item.title ?? '').trim(),
    statusLabel: toText(item.statusLabel || item.title),
    assetCount: Number(item.assetCount ?? 0),
    assetRows: Number(item.assetRows ?? 0),
    source: toText(item.source),
    isDirectoryLinked: Boolean(item.isDirectoryLinked),
    isActive: typeof item.isActive === 'boolean' ? item.isActive : null
  };
}

function assetStatusTone(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'available') return 'success';
  if (normalized === 'in use' || normalized === 'assigned') return 'primary';
  if (normalized === 'partially assigned') return 'warning';
  if (normalized === 'broken') return 'danger';
  if (normalized === 'disposed') return 'dark';
  if (normalized === 'out of stock') return 'muted';
  return 'muted';
}

function assetSortIndicator(current: { key: AssetListSortKey; dir: 'asc' | 'desc' }, key: AssetListSortKey) {
  if (current.key !== key) return '↕';
  return current.dir === 'asc' ? '↑' : '↓';
}

function assetDisplayText(value: unknown, empty = '-') {
  const normalized = String(value ?? '').trim();
  return normalized || empty;
}

function normalizeAssignedEmployeeQuery(value: string) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return '';
  const nikMatch = raw.match(/\(([^()]+)\)\s*$/);
  if (nikMatch?.[1]) return nikMatch[1].trim();
  return raw.replace(/\s*\([^()]+\)\s*$/, '').trim();
}

function renderProcurementMessageWithEvidenceTokens(
  message: string,
  onPreview?: (preview: ProcurementEvidencePreview) => void
) {
  const raw = String(message || '');
  if (!raw) return '-';

  const tokenRegex = /\[\[IMG\s+([^|\]]+)\|([^[\]|]+)\]\]/g;
  const matches = [...raw.matchAll(tokenRegex)];
  const clean = raw.replace(tokenRegex, '').trim();

  return (
    <>
      <span>{clean || '-'}</span>
      {matches.length ? (
        <div className="proc-activity-evidence-grid">
          {matches.map((match, index) => {
            const name = String(match[1] || 'Evidence');
            const fileId = String(match[2] || '').trim();
            const src = buildProcurementEvidenceUrl(fileId);
            return (
              <button
                className="proc-activity-evidence-link"
                key={`evidence-${fileId}-${index}`}
                onClick={() => onPreview?.({ src, name })}
                title={name}
                type="button"
              >
                <img alt={name} className="proc-activity-evidence-thumb" src={src} />
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

export default function HomePage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [loginNotice, setLoginNotice] = useState('');
  const [authReadiness, setAuthReadiness] = useState<AuthReadinessResponse | null>(null);
  const [activeModule, setActiveModule] = useState<ModuleKey>('dashboard');
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [procurementSubmitting, setProcurementSubmitting] = useState(false);
  const [procurementMessage, setProcurementMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [procurementDraft, setProcurementDraft] = useState({
    requestorName: '',
    source: 'WhatsApp',
    sourceReference: '',
    rawData: ''
  });
  const [dashboardData, setDashboardData] = useState<DashboardParityResponse | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [moduleData, setModuleData] = useState<ModuleResponse | null>(null);
  const [moduleLoading, setModuleLoading] = useState(false);
  const [moduleError, setModuleError] = useState('');
  const [detailModal, setDetailModal] = useState<DetailModalState | null>(null);
  const [procurementEditor, setProcurementEditor] = useState<ProcurementEditorState | null>(null);
  const [procurementUpdateMessage, setProcurementUpdateMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [procurementEvidencePreview, setProcurementEvidencePreview] = useState<ProcurementEvidencePreview | null>(null);
  const [handoverResumeDoc, setHandoverResumeDoc] = useState<string | null>(null);
  const [handoverResumeNonce, setHandoverResumeNonce] = useState(0);
  const [handoverCancelState, setHandoverCancelState] = useState<{ docNumber: string; reason: string; saving: boolean; message: { kind: 'success' | 'error'; text: string } | null } | null>(null);
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [assetSort, setAssetSort] = useState<{ key: AssetListSortKey; dir: 'asc' | 'desc' }>({
    key: 'tag',
    dir: 'asc'
  });
  const [handoverSort, setHandoverSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({
    key: 'transactionTimestamp',
    dir: 'desc'
  });
  const [handoverStatusFilter, setHandoverStatusFilter] = useState<string>('');
  const [assetEditor, setAssetEditor] = useState<AssetEditorState | null>(null);
  const [assetCreator, setAssetCreator] = useState<AssetCreatorState | null>(null);
  const [assetQtyEditor, setAssetQtyEditor] = useState<AssetQtyEditorState | null>(null);
  const [assetDeleteState, setAssetDeleteState] = useState<AssetDeleteState | null>(null);
  const [myHoldings, setMyHoldings] = useState<{ loading: boolean; error: string; detail: EmployeeDirectoryDetailResponse | null; history: EmployeeDirectoryHistoryResponse | null } | null>(null);
  const [catalogExpandedCategory, setCatalogExpandedCategory] = useState<string | null>(null);
  const [catalogCategoryEditor, setCatalogCategoryEditor] = useState<CatalogCategoryEditorState | null>(null);
  const [catalogSkuEditor, setCatalogSkuEditor] = useState<CatalogSkuEditorState | null>(null);
  const [catalogDeleteState, setCatalogDeleteState] = useState<CatalogDeleteState | null>(null);
  const [masterReferenceExpanded, setMasterReferenceExpanded] = useState<Record<string, boolean>>({});
  const [employeeDetailTab, setEmployeeDetailTab] = useState<'current' | 'history'>('current');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileShell, setIsMobileShell] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<NavGroup['key'], boolean>>({
    procurement: false,
    masterData: false,
    assetMgmt: false,
    assetOps: false,
    admin: false
  });

  const activeConfig = useMemo(() => MODULES[activeModule], [activeModule]);
  const visibleNavGroups = useMemo(() => getVisibleNavGroups(user), [user]);
  const procurementEvidenceInputRef = useRef<HTMLInputElement | null>(null);
  const canManageAssetsNow = useMemo(() => canManageAssetActions(user), [user]);
  const canManageCatalogNow = useMemo(() => canManageCatalogActions(user), [user]);
  const canManageMasterReferenceNow = useMemo(() => canManageMasterReferenceActions(user), [user]);

  useEffect(() => {
    void loadCurrentUser();
    void loadAuthReadiness();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const authError = url.searchParams.get('authError');
    if (!authError) return;

    setError(authError);
    setLoginNotice('');
    url.searchParams.delete('authError');
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, '', nextUrl || '/');
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadBootstrap();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (activeModule !== 'dashboard') return;
    void loadDashboard(false);
  }, [user, activeModule]);

  useEffect(() => {
    const groupKey = getGroupKeyForModule(activeModule);
    if (!groupKey) return;
    setOpenGroups((current) => (
      current[groupKey]
        ? current
        : {
            ...current,
            [groupKey]: true
          }
    ));
  }, [activeModule]);

  useEffect(() => {
    if (!canAccessModuleByRole(user, activeModule)) {
      const fallbackModule = canAccessDashboard(user)
        ? 'dashboard'
        : canAccessModuleByRole(user, 'handoverForm')
          ? 'handoverForm'
          : 'handoverList';
      if (fallbackModule !== activeModule) {
        setActiveModule(fallbackModule);
        return;
      }
    }

    setSearch('');
    setDraftSearch('');
    setPage(1);
    setModuleError('');
    setModuleData(null);
  }, [activeModule, user]);

  useEffect(() => {
    if (!user) return;
    if (activeModule === 'dashboard' || activeModule === 'procurementInput') return;
    if (!activeConfig.endpoint) return;
    // Portal users viewing holdings see their own data (myHoldings state), not the full directory
    const portalRoles = Array.isArray(user.roles) ? user.roles.map(normalizeRoleLabel) : [];
    if (activeModule === 'holdings' && portalRoles.some(isPortalUserRole)) return;
    void loadModuleData(activeModule, activeConfig.endpoint, search, page);
  }, [user, activeConfig, activeModule, search, page, assetSort.key, assetSort.dir, handoverSort.key, handoverSort.dir, handoverStatusFilter]);

  useEffect(() => {
    const roles = Array.isArray(user?.roles) ? user.roles.map(normalizeRoleLabel) : [];
    const isPortalUser = roles.some(isPortalUserRole);
    if (!isPortalUser || activeModule !== 'holdings') {
      setMyHoldings(null);
      return;
    }

    setMyHoldings({ loading: true, error: '', detail: null, history: null });
    void (async () => {
      try {
        const detail = await fetchPageJson<EmployeeDirectoryDetailResponse>('/api/app/holdings/me');
        if (!detail?.success) throw new Error(detail?.message || 'Failed to load your asset holdings.');
        let history: EmployeeDirectoryHistoryResponse | null = null;
        try {
          const email = detail.employee?.email || '';
          if (email) {
            const h = await rpcCall<EmployeeDirectoryHistoryResponse>('getEmployeeDirectoryHistoryDetail', email, 250);
            if (h?.success) history = h;
          }
        } catch {}
        setMyHoldings({ loading: false, error: '', detail, history });
      } catch (err) {
        setMyHoldings({ loading: false, error: err instanceof Error ? err.message : 'Failed to load holdings.', detail: null, history: null });
      }
    })();
  }, [user, activeModule]);

  useEffect(() => {
    function syncViewport() {
      const nextMobile = window.innerWidth <= 900;
      setIsMobileShell(nextMobile);
      if (!nextMobile) {
        setMobileSidebarOpen(false);
      }
    }

    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const shouldLockScroll = isMobileShell && mobileSidebarOpen;
    document.body.classList.toggle('atlas-mobile-sidebar-open', shouldLockScroll);
    return () => {
      document.body.classList.remove('atlas-mobile-sidebar-open');
    };
  }, [isMobileShell, mobileSidebarOpen]);

  useEffect(() => {
    if (!detailModal && !procurementEvidencePreview) return undefined;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (procurementEvidencePreview) {
          setProcurementEvidencePreview(null);
          return;
        }
        closeDetailModal();
      }
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [detailModal, procurementEvidencePreview]);

  async function loadCurrentUser() {
    try {
      const result = await fetchPageJson<{ user: AuthUser }>('/api/auth/me');
      setUser(result.user);
    } catch {
      setUser(null);
    } finally {
      setChecking(false);
    }
  }

  async function loadAuthReadiness() {
    try {
      const result = await fetchPageJson<AuthReadinessResponse>('/api/auth/readiness');
      setAuthReadiness(result);
    } catch {
      setAuthReadiness(null);
    }
  }

  async function loadBootstrap() {
    try {
      const result = await fetchPageJson<BootstrapResponse>('/api/app/bootstrap');
      setBootstrap(result);
    } catch (loadError) {
      setModuleError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard data.');
    }
  }

  async function loadDashboard(forceRefresh: boolean) {
    setDashboardLoading(true);
    setDashboardError('');
    try {
      const result = await rpcCall<DashboardParityResponse>('getAssetDashboardSummary', {
        forceRefresh
      });
      setDashboardData(result);
    } catch (loadError) {
      setDashboardError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard data.');
      setDashboardData(null);
    } finally {
      setDashboardLoading(false);
    }
  }

  async function loadModuleData(moduleKey: ModuleKey, endpoint: string, nextSearch: string, nextPage: number) {
    setModuleLoading(true);
    setModuleError('');

    try {
      let result: ModuleResponse;

      if (moduleKey === 'procurementMonitoring') {
        const rows = await rpcCall<unknown[]>('getDataFromSheet');
        const filtered = mapProcurementRows(rows).filter((item) =>
          !nextSearch ||
          Object.values(item).some((value) => String(value ?? '').toLowerCase().includes(nextSearch.toLowerCase()))
        );
        result = paginateItems(filtered, nextPage);
      } else if (moduleKey === 'procurementArchive') {
        const rows = await rpcCall<unknown[]>('getArchiveData');
        const filtered = mapProcurementRows(rows).filter((item) =>
          !nextSearch ||
          Object.values(item).some((value) => String(value ?? '').toLowerCase().includes(nextSearch.toLowerCase()))
        );
        result = paginateItems(filtered, nextPage);
      } else {
        const url = new URL(endpoint, window.location.origin);
        if (!endpoint.includes('/sync-admin')) {
          url.searchParams.set('search', nextSearch);
          url.searchParams.set('page', String(nextPage));
          url.searchParams.set('pageSize', String(DEFAULT_PAGE_SIZE));
          if (moduleKey === 'assets') {
            url.searchParams.set('sortKey', assetSort.key);
            url.searchParams.set('sortDir', assetSort.dir);
          }
          if (moduleKey === 'handoverList') {
            url.searchParams.set('sortKey', handoverSort.key);
            url.searchParams.set('sortDir', handoverSort.dir);
            if (handoverStatusFilter) {
              url.searchParams.set('statusFilter', handoverStatusFilter);
            }
          }
        }
        result = await fetchPageJson<ModuleResponse>(url.toString());
      }

      setModuleData(result);
    } catch (loadError) {
      setModuleError(loadError instanceof Error ? loadError.message : 'Failed to load module data.');
      setModuleData(null);
    } finally {
      setModuleLoading(false);
    }
  }

  function closeDetailModal() {
    setDetailModal(null);
    setProcurementEditor(null);
    setProcurementUpdateMessage(null);
    setProcurementEvidencePreview(null);
    setEmployeeDetailTab('current');
    setHandoverCancelState(null);
  }

  function openHandoverCancel(docNumber: string) {
    setHandoverCancelState({ docNumber, reason: '', saving: false, message: null });
  }

  async function submitHandoverCancel() {
    if (!handoverCancelState) return;
    setHandoverCancelState((s) => s ? { ...s, saving: true, message: null } : s);
    try {
      const result = await fetchPageJson<{ ok: boolean; message?: string }>(
        `/api/app/handover/${encodeURIComponent(handoverCancelState.docNumber)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: handoverCancelState.reason })
        }
      );
      if (!result.ok) throw new Error(result.message || 'Cancellation failed.');
      setHandoverCancelState(null);
      // Refresh handover list and close modal
      closeDetailModal();
      void loadModuleData(activeModule, activeConfig.endpoint ?? '', search, page);
    } catch (err) {
      setHandoverCancelState((s) => s ? { ...s, saving: false, message: { kind: 'error', text: err instanceof Error ? err.message : 'Cancellation failed.' } } : s);
    }
  }

  function closeProcurementEvidencePreview() {
    setProcurementEvidencePreview(null);
  }

  async function openAssetDetail(assetTag: string) {
    const normalizedTag = toText(assetTag).trim();
    if (!normalizedTag || normalizedTag === '-') return;

    setDetailModal({
      kind: 'asset',
      title: `Asset Detail: ${normalizedTag}`,
      subtitle: '',
      loading: true,
      error: '',
      data: null
    });

    try {
      const result = await rpcCall<AssetDetailResponse>('getAssetDetail', normalizedTag);
      if (!result || !result.success) {
        throw new Error(result?.message || 'Failed to load asset detail.');
      }
      setDetailModal({
        kind: 'asset',
        title: `Asset Detail: ${normalizedTag}`,
        subtitle: '',
        loading: false,
        error: '',
        data: result
      });
    } catch (loadError) {
      setDetailModal({
        kind: 'asset',
        title: `Asset Detail: ${normalizedTag}`,
        subtitle: '',
        loading: false,
        error: loadError instanceof Error ? loadError.message : 'Failed to load asset detail.',
        data: null
      });
    }
  }

  async function openEmployeeDetail(queryKey: string, modalTitle = 'User Detail') {
    const normalizedKey = toText(queryKey).trim();
    if (!normalizedKey || normalizedKey === '-') return;
    setEmployeeDetailTab('current');

    setDetailModal({
      kind: 'employee',
      title: modalTitle,
      subtitle: '',
      loading: true,
      error: '',
      data: null
    });

    try {
      const detail = await rpcCall<EmployeeDirectoryDetailResponse>('getEmployeeDirectoryDetail', normalizedKey);
      if (!detail || !detail.success) {
        throw new Error(detail?.message || 'Failed to load employee asset holdings.');
      }

      let history: EmployeeDirectoryHistoryResponse | null = null;
      try {
        const historyResult = await rpcCall<EmployeeDirectoryHistoryResponse>(
          'getEmployeeDirectoryHistoryDetail',
          normalizedKey,
          250
        );
        if (historyResult?.success) {
          history = historyResult;
        }
      } catch {}

      const employeeName = toText(detail.employee?.fullName || normalizedKey);
      setDetailModal({
        kind: 'employee',
        title: modalTitle,
        subtitle: '',
        loading: false,
        error: '',
        data: {
          detail,
          history
        }
      });
    } catch (loadError) {
      setDetailModal({
        kind: 'employee',
        title: modalTitle,
        subtitle: '',
        loading: false,
        error: loadError instanceof Error ? loadError.message : 'Failed to load employee asset holdings.',
        data: null
      });
    }
  }

  async function openHandoverDetail(docNumber: string) {
    const normalizedDoc = toText(docNumber).trim();
    if (!normalizedDoc || normalizedDoc === '-') return;

    setDetailModal({
      kind: 'handover',
      title: 'Handover Detail',
      subtitle: '',
      loading: true,
      error: '',
      data: null
    });

    try {
      const result = await rpcCall<HandoverDetailResponse>('getHandoverDetail', normalizedDoc);
      if (!result || !result.success) {
        throw new Error(result?.message || 'Failed to load handover detail.');
      }

      setDetailModal({
        kind: 'handover',
        title: 'Handover Detail',
        subtitle: '',
        loading: false,
        error: '',
        data: result
      });
    } catch (loadError) {
      setDetailModal({
        kind: 'handover',
        title: 'Handover Detail',
        subtitle: '',
        loading: false,
        error: loadError instanceof Error ? loadError.message : 'Failed to load handover detail.',
        data: null
      });
    }
  }

  function beginHandoverResume(docNumber: string) {
    const normalizedDoc = toText(docNumber).trim();
    if (!normalizedDoc) return;
    closeDetailModal();
    setHandoverResumeDoc(normalizedDoc);
    setHandoverResumeNonce((current) => current + 1);
    setActiveModule('handoverForm');
  }

  async function handleHandoverSubmitted(result: { docID?: string }) {
    await loadBootstrap();
    setHandoverResumeDoc(null);
    setSearch('');
    setDraftSearch('');
    setPage(1);
    setActiveModule('handoverList');
    if (result.docID) {
      window.setTimeout(() => {
        void openHandoverDetail(result.docID || '');
      }, 220);
    }
  }

  function openProcurementDetail(item: ProcurementRow, sourceLabel: string) {
    setProcurementEditor(buildProcurementEditorState(item, user, sourceLabel));
    setProcurementUpdateMessage(null);
    setDetailModal({
      kind: 'procurement',
      title: `Request Details: ${toText(item.requestNumber)}`,
      subtitle: sourceLabel,
      loading: false,
      error: '',
      data: {
        item,
        activities: buildProcurementActivities(item),
        sourceLabel
      }
    });
  }

  function updateProcurementEditor(
    patch: Partial<ProcurementEditorState> | ((current: ProcurementEditorState) => ProcurementEditorState)
  ) {
    setProcurementEditor((current) => {
      if (!current) return current;
      if (typeof patch === 'function') return patch(current);
      return {
        ...current,
        ...patch
      };
    });
  }

  async function readProcurementEvidenceFiles(files: File[]) {
    return Promise.all(
      files.map(
        (file) =>
          new Promise<ProcurementEvidenceDraft>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                name: String(file.name || 'evidence.png')
                  .replace(/[^a-zA-Z0-9._-]/g, '_')
                  .replace(/_+/g, '_')
                  .slice(0, 80),
                mimeType: file.type || 'image/png',
                dataUrl: String(reader.result || '')
              });
            reader.onerror = () => reject(new Error(`Failed to read file ${file.name || 'evidence'}.`));
            reader.readAsDataURL(file);
          })
      )
    );
  }

  async function appendProcurementEvidence(nextFiles: File[]) {
    if (!procurementEditor || !nextFiles.length) return;

    const remainingSlots = Math.max(0, 3 - procurementEditor.evidence.length);
    if (!remainingSlots) {
      setProcurementUpdateMessage({
        kind: 'error',
        text: 'Maximum 3 evidence images are allowed per update.'
      });
      return;
    }

    const candidates = nextFiles.slice(0, remainingSlots);
    const oversized = candidates.find((file) => file.size / (1024 * 1024) > 2);
    if (oversized) {
      setProcurementUpdateMessage({
        kind: 'error',
        text: `File ${oversized.name} exceeds the 2MB limit per image.`
      });
      return;
    }

    try {
      const staged = await readProcurementEvidenceFiles(candidates);
      updateProcurementEditor((current) => ({
        ...current,
        evidence: [...current.evidence, ...staged]
      }));
      setProcurementUpdateMessage(null);
    } catch (error) {
      setProcurementUpdateMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to stage evidence images.'
      });
    }
  }

  function handleProcurementEvidenceInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    void appendProcurementEvidence(files);
    event.target.value = '';
  }

  function handleProcurementEvidencePaste(event: ClipboardEvent<HTMLElement>) {
    const items = Array.from(event.clipboardData?.items || []);
    const files = items
      .filter((entry) => entry?.type?.startsWith('image/'))
      .map((entry) => entry.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length) {
      event.preventDefault();
      void appendProcurementEvidence(files);
    }
  }

  function handleProcurementEvidenceDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'));
    if (files.length) {
      void appendProcurementEvidence(files);
    }
  }

  function removeProcurementEvidence(index: number) {
    updateProcurementEditor((current) => ({
      ...current,
      evidence: current.evidence.filter((_, evidenceIndex) => evidenceIndex !== index)
    }));
  }

  async function handleProcurementSave() {
    if (!detailModal || detailModal.kind !== 'procurement' || !procurementEditor) return;

    if (procurementEditor.sourceLabel === 'Archive') {
      setProcurementUpdateMessage({
        kind: 'error',
        text: 'Archived requests are read-only.'
      });
      return;
    }

    if (!procurementEditor.canUpdateStatus) {
      setProcurementUpdateMessage({
        kind: 'error',
        text: 'Your role does not have permission to update this request.'
      });
      return;
    }

    if (!procurementEditor.itemSummary.trim()) {
      setProcurementUpdateMessage({
        kind: 'error',
        text: 'Revised item category is required.'
      });
      return;
    }

    if (!procurementEditor.remark.trim()) {
      setProcurementUpdateMessage({
        kind: 'error',
        text: 'A status remark is required for every status update.'
      });
      return;
    }

    updateProcurementEditor({ saving: true });
    setProcurementUpdateMessage(null);

    try {
      const result = await rpcCall<ProcurementUpdateResult>('updateRequestStatus', {
        requestNumber: procurementEditor.requestNumber,
        status: procurementEditor.status,
        fulfillment: buildProcurementFulfillmentValue(procurementEditor.fulfillmentBase, procurementEditor.purchaseMode),
        referenceNo:
          procurementEditor.fulfillmentBase === 'Purchase'
            ? procurementEditor.purchaseReference.trim()
            : '',
        itemSummary: procurementEditor.itemSummary.trim(),
        statusRemark: procurementEditor.remark.trim(),
        evidence: procurementEditor.evidence
      });

      if (!result?.success || !result.item) {
        throw new Error(result?.message || 'Failed to update procurement request.');
      }

      const updatedItem = coerceProcurementItem(result.item);
      const nextEditor = buildProcurementEditorState(updatedItem, user, procurementEditor.sourceLabel);

      setDetailModal((current) => {
        if (!current || current.kind !== 'procurement') return current;
        return {
          ...current,
          data: {
            item: updatedItem,
            activities: buildProcurementActivities(updatedItem),
            sourceLabel: procurementEditor.sourceLabel
          }
        };
      });
      setProcurementEditor(nextEditor);
      setProcurementUpdateMessage({
        kind: 'success',
        text: result.message || `Request ${updatedItem.requestNumber} updated successfully.`
      });

      if (activeConfig.endpoint) {
        await loadModuleData(activeModule, activeConfig.endpoint, search, page);
      }
    } catch (error) {
      setProcurementUpdateMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to update procurement request.'
      });
    } finally {
      updateProcurementEditor((current) => ({
        ...current,
        saving: false
      }));
    }
  }

  function openCatalogDetail(item: Record<string, unknown>) {
    setDetailModal({
      kind: 'catalog',
      title: 'Model Detail',
      subtitle: '',
      loading: false,
      error: '',
      data: item
    });
  }

  function formatCatalogPrice(value: unknown) {
    const raw = String(value ?? '').trim();
    if (!raw || raw === '-') return '-';
    return formatCurrency(raw);
  }

  function openAddCategoryModal() {
    setCatalogCategoryEditor({
      name: '',
      saving: false,
      message: null
    });
  }

  function closeCatalogCategoryEditor() {
    setCatalogCategoryEditor(null);
  }

  function openAddCatalogSkuModal() {
    const categories = Array.isArray(moduleData?.catalog?.categories)
      ? moduleData?.catalog?.categories.map((entry) => toText(entry.name)).filter((value) => value !== '-')
      : [];
    const accounts = Array.isArray(moduleData?.catalog?.accountOptions)
      ? moduleData?.catalog?.accountOptions.filter(Boolean)
      : [];

    setCatalogSkuEditor({
      mode: 'add',
      originalSku: '',
      category: categories[0] || '',
      sku: '',
      account: accounts[0] || '',
      specification: '',
      estimatedPrice: '',
      saving: false,
      message: null
    });
  }

  function openEditCatalogSkuModal(item: CatalogManagerItem) {
    setCatalogSkuEditor({
      mode: 'edit',
      originalSku: item.sku,
      category: item.category === '-' ? '' : item.category,
      sku: item.sku === '-' ? '' : item.sku,
      account: item.account === '-' ? '' : item.account,
      specification: item.specification === '-' ? '' : item.specification,
      estimatedPrice: item.estimatedPrice === '-' ? '' : String(item.estimatedPrice).replace(/\.00$/, ''),
      saving: false,
      message: null
    });
  }

  function closeCatalogSkuEditor() {
    setCatalogSkuEditor(null);
  }

  function openCatalogDelete(kind: 'category' | 'sku', targetName: string, subtitle: string) {
    setCatalogDeleteState({
      kind,
      targetName,
      subtitle,
      deleting: false,
      message: null
    });
  }

  function closeCatalogDeleteState() {
    setCatalogDeleteState(null);
  }

  async function submitCatalogCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!catalogCategoryEditor) return;

    const name = catalogCategoryEditor.name.trim();
    if (!name) {
      setCatalogCategoryEditor((current) => current ? {
        ...current,
        message: { kind: 'error', text: 'Category name cannot be empty.' }
      } : current);
      return;
    }

    try {
      setCatalogCategoryEditor((current) => current ? { ...current, saving: true, message: null } : current);
      const result = await fetchPageJson<{ success: boolean; message?: string }>('/api/app/catalog/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
      });

      setCatalogCategoryEditor((current) => current ? {
        ...current,
        saving: false,
        message: { kind: 'success', text: result.message || 'Category created successfully.' }
      } : current);
      await loadBootstrap();
      if (activeConfig.endpoint) {
        await loadModuleData(activeModule, activeConfig.endpoint, search, 1);
      }
      setCatalogExpandedCategory(name);
      setTimeout(() => setCatalogCategoryEditor(null), 250);
    } catch (submitError) {
      setCatalogCategoryEditor((current) => current ? {
        ...current,
        saving: false,
        message: {
          kind: 'error',
          text: submitError instanceof Error ? submitError.message : 'Failed to create category.'
        }
      } : current);
    }
  }

  async function submitCatalogSku(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!catalogSkuEditor) return;

    const payload = {
      category: catalogSkuEditor.category.trim(),
      sku: catalogSkuEditor.sku.trim(),
      account: catalogSkuEditor.account.trim(),
      specification: catalogSkuEditor.specification.trim(),
      estimatedPrice: catalogSkuEditor.estimatedPrice.trim()
    };

    if (!payload.category || !payload.sku) {
      setCatalogSkuEditor((current) => current ? {
        ...current,
        message: { kind: 'error', text: 'Category and SKU are required.' }
      } : current);
      return;
    }

    const url = catalogSkuEditor.mode === 'edit'
      ? `/api/app/catalog/items/${encodeURIComponent(catalogSkuEditor.originalSku)}`
      : '/api/app/catalog/items';
    const method = catalogSkuEditor.mode === 'edit' ? 'PATCH' : 'POST';

    try {
      setCatalogSkuEditor((current) => current ? { ...current, saving: true, message: null } : current);
      const result = await fetchPageJson<{ success: boolean; message?: string }>(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      setCatalogSkuEditor((current) => current ? {
        ...current,
        saving: false,
        message: {
          kind: 'success',
          text: result.message || (current.mode === 'edit' ? 'Catalog item updated successfully.' : 'Catalog item created successfully.')
        }
      } : current);
      await loadBootstrap();
      if (activeConfig.endpoint) {
        await loadModuleData(activeModule, activeConfig.endpoint, search, 1);
      }
      setCatalogExpandedCategory(payload.category);
      setTimeout(() => setCatalogSkuEditor(null), 250);
    } catch (submitError) {
      setCatalogSkuEditor((current) => current ? {
        ...current,
        saving: false,
        message: {
          kind: 'error',
          text: submitError instanceof Error ? submitError.message : 'Failed to save catalog item.'
        }
      } : current);
    }
  }

  async function submitCatalogDelete() {
    if (!catalogDeleteState) return;

    const url = catalogDeleteState.kind === 'category'
      ? `/api/app/catalog/categories/${encodeURIComponent(catalogDeleteState.targetName)}`
      : `/api/app/catalog/items/${encodeURIComponent(catalogDeleteState.targetName)}`;

    try {
      setCatalogDeleteState((current) => current ? { ...current, deleting: true, message: null } : current);
      const result = await fetchPageJson<{ success: boolean; message?: string }>(url, {
        method: 'DELETE'
      });

      setCatalogDeleteState((current) => current ? {
        ...current,
        deleting: false,
        message: { kind: 'success', text: result.message || 'Deleted successfully.' }
      } : current);
      await loadBootstrap();
      if (activeConfig.endpoint) {
        await loadModuleData(activeModule, activeConfig.endpoint, search, 1);
      }
      setTimeout(() => setCatalogDeleteState(null), 250);
    } catch (deleteError) {
      setCatalogDeleteState((current) => current ? {
        ...current,
        deleting: false,
        message: {
          kind: 'error',
          text: deleteError instanceof Error ? deleteError.message : 'Failed to delete catalog entry.'
        }
      } : current);
    }
  }

  async function openCatalogDetailByName(itemModel: string, category?: string) {
    const query = String(itemModel || '').trim();
    if (!query || query === '-') return;

    const url = new URL('/api/app/catalog', window.location.origin);
    url.searchParams.set('search', query);
    url.searchParams.set('page', '1');
    url.searchParams.set('pageSize', '25');

    try {
      const result = await fetchPageJson<ModuleResponse>(url.toString());
      const catalogItems = Array.isArray(result.items) ? result.items : [];
      const normalizedQuery = query.toLowerCase();
      const normalizedCategory = String(category || '').trim().toLowerCase();
      const target =
        catalogItems.find((entry) => String(entry.sku || '').trim().toLowerCase() === normalizedQuery) ||
        catalogItems.find((entry) =>
          String(entry.sku || '').trim().toLowerCase() === normalizedQuery &&
          String(entry.category || '').trim().toLowerCase() === normalizedCategory
        ) ||
        catalogItems[0];

      if (!target) {
        throw new Error('Catalog item not found.');
      }

      openCatalogDetail(target);
    } catch (lookupError) {
      setModuleError(lookupError instanceof Error ? lookupError.message : 'Failed to load catalog detail.');
    }
  }

  function openReferenceDetail(item: Record<string, unknown>) {
    setDetailModal({
      kind: 'reference',
      title: toText(item.value || 'Reference Detail'),
      subtitle: toText(item.type || 'Master Reference'),
      loading: false,
      error: '',
      data: item
    });
  }

  function openMasterReferenceSourceNotice(actionLabel: string, targetLabel?: string) {
    setDetailModal({
      kind: 'reference',
      title: `${actionLabel} via Employee Database`,
      subtitle: 'Organization Structure',
      loading: false,
      error: '',
      data: {
        mode: 'sourceLockedNotice',
        actionLabel,
        targetLabel: toText(targetLabel),
        source: 'Employee Database / Google Workspace Directory',
        syncPolicy: 'Auto-synced every 15 minutes and on Refresh Data.',
        guidance:
          'To add, change, or remove Account / Department values, update the employee source data first. Master Reference is kept aligned automatically to prevent duplicate or conflicting organization trees.'
      }
    });
  }

  function toggleMasterReferenceGroup(groupKey: string) {
    setMasterReferenceExpanded((current) => ({
      ...current,
      [groupKey]: !current[groupKey]
    }));
  }

  function closeAssetEditor() {
    setAssetEditor(null);
  }

  function openAssetCreator() {
    setAssetCreator({
      assetTag: '',
      serialNumber: '',
      itemModel: '',
      category: '',
      status: 'Available',
      location: '',
      purchaseDate: '',
      vendorName: '',
      purchasingYear: '',
      orderNumber: '',
      invoiceNumber: '',
      ownerAccount: '',
      ownerDepartment: '',
      assignmentMode: 'individual',
      assignedToText: '',
      assignedAccount: '',
      assignedDept: '',
      initialQuantity: '1',
      saving: false,
      message: null
    });
  }

  function closeAssetCreator() {
    setAssetCreator(null);
  }

  function updateAssetCreatorField<K extends keyof AssetCreatorState>(key: K, value: AssetCreatorState[K]) {
    setAssetCreator((current) => (current ? { ...current, [key]: value } : current));
  }

  async function submitAssetCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assetCreator) return;

    const payload = {
      assetTag: assetCreator.assetTag.trim(),
      serialNumber: assetCreator.serialNumber.trim(),
      itemModel: assetCreator.itemModel.trim(),
      category: assetCreator.category.trim(),
      status: assetCreator.status.trim(),
      location: assetCreator.location.trim(),
      purchaseDate: assetCreator.purchaseDate.trim(),
      vendorName: assetCreator.vendorName.trim(),
      purchasingYear: assetCreator.purchasingYear.trim(),
      orderNumber: assetCreator.orderNumber.trim(),
      invoiceNumber: assetCreator.invoiceNumber.trim(),
      ownerAccount: assetCreator.ownerAccount.trim(),
      ownerDepartment: assetCreator.ownerDepartment.trim(),
      assignmentMode: assetCreator.assignmentMode,
      assignedToText: assetCreator.assignedToText.trim(),
      assignedAccount: assetCreator.assignedAccount.trim(),
      assignedDept: assetCreator.assignedDept.trim(),
      initialQuantity: Number(assetCreator.initialQuantity) || 1
    };

    if (!payload.assetTag) {
      setAssetCreator((current) => current ? {
        ...current,
        message: { kind: 'error', text: 'Asset tag is required.' }
      } : current);
      return;
    }
    if (!payload.itemModel || !payload.category) {
      setAssetCreator((current) => current ? {
        ...current,
        message: { kind: 'error', text: 'Item Model and Category are required.' }
      } : current);
      return;
    }

    setAssetCreator((current) => current ? { ...current, saving: true, message: null } : current);
    try {
      const result = await fetchPageJson<{ success: boolean; message?: string }>('/api/app/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!result.success) {
        setAssetCreator((current) => current ? {
          ...current,
          saving: false,
          message: { kind: 'error', text: result.message || 'Failed to create asset.' }
        } : current);
        return;
      }
      setAssetCreator((current) => current ? {
        ...current,
        saving: false,
        message: { kind: 'success', text: result.message || 'Asset created successfully.' }
      } : current);
      await loadBootstrap();
      if (activeConfig.endpoint) {
        await loadModuleData(activeModule, activeConfig.endpoint, search, page);
      }
      setTimeout(() => setAssetCreator(null), 1000);
    } catch (submitError) {
      setAssetCreator((current) => current ? {
        ...current,
        saving: false,
        message: { kind: 'error', text: submitError instanceof Error ? submitError.message : 'Failed to create asset.' }
      } : current);
    }
  }

  function closeAssetQtyEditor() {
    setAssetQtyEditor(null);
  }

  function closeAssetDeleteState() {
    setAssetDeleteState(null);
  }

  async function beginAssetEdit(item: AssetListItem) {
    try {
      const detail = await fetchPageJson<AssetDetailResponse>(`/api/app/assets/${encodeURIComponent(item.assetTag)}/detail`);
      const asset = (detail.asset || {}) as Record<string, unknown>;
      const purchaseDate = String(asset.purchaseDate || '').trim();
      setAssetEditor({
        originalTag: item.assetTag,
        assetTag: toText(asset.assetTag || item.assetTag),
        serialNumber: assetDisplayText(asset.serialNumber || item.serialNumber, ''),
        itemModel: assetDisplayText(asset.itemModel || item.itemModel, ''),
        category: assetDisplayText(asset.category || item.category, ''),
        status: assetDisplayText(asset.status || item.status, 'Available'),
        location: assetDisplayText(asset.location || item.location, ''),
        purchaseDate: purchaseDate ? purchaseDate.slice(0, 10) : '',
        vendorName: assetDisplayText(asset.vendorName || item.vendorName, ''),
        purchasingYear: assetDisplayText(asset.purchasingYear, ''),
        orderNumber: assetDisplayText(asset.orderNumber || item.orderNumber, ''),
        invoiceNumber: assetDisplayText(asset.invoiceNumber || item.invoiceNumber, ''),
        ownerAccount: assetDisplayText(asset.ownerAccount || item.ownerAccount, ''),
        ownerDepartment: assetDisplayText(asset.ownerDepartment || item.ownerDepartment, ''),
        assignmentMode:
          assetDisplayText(asset.assignedAccount || item.assignedAccount, '') ||
          assetDisplayText(asset.assignedDept || item.assignedDept, '')
            ? 'sharing'
            : 'individual',
        assignedToText: assetDisplayText(asset.assignedToText || item.assignedToText, ''),
        assignedAccount: assetDisplayText(asset.assignedAccount || item.assignedAccount, ''),
        assignedDept: assetDisplayText(asset.assignedDept || item.assignedDept, ''),
        saving: false,
        message: null
      });
    } catch (loadError) {
      setModuleError(loadError instanceof Error ? loadError.message : 'Failed to load asset data.');
    }
  }

  function beginAssetQtyEdit(item: AssetListItem) {
    setAssetQtyEditor({
      assetTag: item.assetTag,
      currentQty: Number(item.quantity ?? 0),
      delta: '',
      remark: '',
      saving: false,
      message: null
    });
  }

  function beginAssetDelete(item: AssetListItem) {
    setAssetDeleteState({
      assetTag: item.assetTag,
      itemModel: item.itemModel,
      deleting: false,
      message: null
    });
  }

  function updateAssetEditorField<K extends keyof AssetEditorState>(key: K, value: AssetEditorState[K]) {
    setAssetEditor((current) => (current ? { ...current, [key]: value } : current));
  }

  async function submitAssetEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assetEditor) return;

    const payload = {
      assetTag: assetEditor.assetTag.trim(),
      serialNumber: assetEditor.serialNumber.trim(),
      itemModel: assetEditor.itemModel.trim(),
      category: assetEditor.category.trim(),
      status: assetEditor.status.trim(),
      location: assetEditor.location.trim(),
      purchaseDate: assetEditor.purchaseDate.trim(),
      vendorName: assetEditor.vendorName.trim(),
      purchasingYear: assetEditor.purchasingYear.trim(),
      orderNumber: assetEditor.orderNumber.trim(),
      invoiceNumber: assetEditor.invoiceNumber.trim(),
      ownerAccount: assetEditor.ownerAccount.trim(),
      ownerDepartment: assetEditor.ownerDepartment.trim(),
      assignmentMode: assetEditor.assignmentMode,
      assignedToText: assetEditor.assignedToText.trim(),
      assignedAccount: assetEditor.assignedAccount.trim(),
      assignedDept: assetEditor.assignedDept.trim()
    };

    if (!payload.assetTag || !payload.itemModel || !payload.category) {
      setAssetEditor((current) => current ? {
        ...current,
        message: { kind: 'error', text: 'Asset tag, item model, and category are required.' }
      } : current);
      return;
    }

    try {
      setAssetEditor((current) => current ? { ...current, saving: true, message: null } : current);
      const result = await fetchPageJson<{ success: boolean; message?: string }>(
        `/api/app/assets/${encodeURIComponent(assetEditor.originalTag)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );

      setAssetEditor((current) => current ? {
        ...current,
        saving: false,
        message: { kind: 'success', text: result.message || 'Asset updated successfully.' }
      } : current);
      await loadBootstrap();
      if (activeConfig.endpoint) {
        await loadModuleData(activeModule, activeConfig.endpoint, search, page);
      }
      setTimeout(() => setAssetEditor(null), 250);
    } catch (submitError) {
      setAssetEditor((current) => current ? {
        ...current,
        saving: false,
        message: { kind: 'error', text: submitError instanceof Error ? submitError.message : 'Failed to update asset.' }
      } : current);
    }
  }

  async function submitAssetQtyAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assetQtyEditor) return;

    try {
      setAssetQtyEditor((current) => current ? { ...current, saving: true, message: null } : current);
      const result = await fetchPageJson<{ success: boolean; message?: string }>(
        `/api/app/assets/${encodeURIComponent(assetQtyEditor.assetTag)}/quantity`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            delta: Number(assetQtyEditor.delta),
            remark: assetQtyEditor.remark
          })
        }
      );
      setAssetQtyEditor((current) => current ? {
        ...current,
        saving: false,
        message: { kind: 'success', text: result.message || 'Quantity updated successfully.' }
      } : current);
      await loadBootstrap();
      if (activeConfig.endpoint) {
        await loadModuleData(activeModule, activeConfig.endpoint, search, page);
      }
      setTimeout(() => setAssetQtyEditor(null), 250);
    } catch (submitError) {
      setAssetQtyEditor((current) => current ? {
        ...current,
        saving: false,
        message: { kind: 'error', text: submitError instanceof Error ? submitError.message : 'Failed to adjust quantity.' }
      } : current);
    }
  }

  async function submitAssetDelete() {
    if (!assetDeleteState) return;

    try {
      setAssetDeleteState((current) => current ? { ...current, deleting: true, message: null } : current);
      const result = await fetchPageJson<{ success: boolean; message?: string }>(
        `/api/app/assets/${encodeURIComponent(assetDeleteState.assetTag)}`,
        {
          method: 'DELETE'
        }
      );
      setAssetDeleteState((current) => current ? {
        ...current,
        deleting: false,
        message: { kind: 'success', text: result.message || 'Asset deleted successfully.' }
      } : current);
      await loadBootstrap();
      if (activeConfig.endpoint) {
        await loadModuleData(activeModule, activeConfig.endpoint, search, page);
      }
      setTimeout(() => setAssetDeleteState(null), 250);
    } catch (submitError) {
      setAssetDeleteState((current) => current ? {
        ...current,
        deleting: false,
        message: { kind: 'error', text: submitError instanceof Error ? submitError.message : 'Failed to delete asset.' }
      } : current);
    }
  }

  function handleGoogleLogin() {
    setError('');
    setLoginNotice('Redirecting to Google Workspace...');
    window.location.assign('/api/auth/google');
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
    setUser(null);
    setBootstrap(null);
    setModuleData(null);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSearch(draftSearch.trim());
  }

  function procurementSourceLabel(value: string) {
    if (value === 'iTop') return 'iTop Ticket';
    if (value === 'Email') return 'Email GWS';
    return 'WhatsApp Name/Number';
  }

  async function handleProcurementSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProcurementMessage(null);

    const requestorName = procurementDraft.requestorName.trim();
    const source = procurementDraft.source.trim() || 'WhatsApp';
    const sourceReference = procurementDraft.sourceReference.trim();
    const rawData = procurementDraft.rawData.trim();

    if (!requestorName || !sourceReference || !rawData) {
      setProcurementMessage({
        kind: 'error',
        text: 'Requestor name, source detail, and raw request data are required.'
      });
      return;
    }

    try {
      setProcurementSubmitting(true);
      const result = await rpcCall<ProcurementInputResult>('submitProcurementRequest', {
        requestorName,
        requestSource: source,
        sourceReference,
        rawData
      });
      if (!result?.success) {
        throw new Error(result?.message || 'Failed to process procurement request.');
      }

      setProcurementMessage({
        kind: 'success',
        text: result.message || `Procurement request ${result.requestNumber || ''} was saved successfully.`
      });
      setProcurementDraft({
        requestorName: '',
        source: 'WhatsApp',
        sourceReference: '',
        rawData: ''
      });
      await loadBootstrap();
    } catch (submitError) {
      setProcurementMessage({
        kind: 'error',
        text: submitError instanceof Error ? submitError.message : 'Failed to process procurement request.'
      });
    } finally {
      setProcurementSubmitting(false);
    }
  }

  async function handleRefreshActive() {
    await loadBootstrap();
    if (activeModule === 'dashboard') {
      await loadDashboard(true);
      return;
    }
    if (activeModule === 'procurementInput') {
      setProcurementMessage(null);
      return;
    }
    if (activeModule === 'employeeDatabase') {
      try {
        await fetchPageJson<{ success: boolean; message?: string }>('/api/app/employees/sync/google-workspace', {
          method: 'POST'
        });
      } catch {}
    }
    if (activeModule === 'masterReference') {
      try {
        await fetchPageJson<{ success: boolean; message?: string }>('/api/app/employees/sync/google-workspace', {
          method: 'POST'
        });
      } catch {}
      try {
        await fetchPageJson<{ success: boolean; message?: string }>('/api/app/master-references/sync', {
          method: 'POST'
        });
      } catch {}
    }
    if (activeConfig.endpoint) {
      await loadModuleData(activeModule, activeConfig.endpoint, search, page);
    }
  }

  function toggleGroup(groupKey: NavGroup['key']) {
    setOpenGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey]
    }));
  }

  function handleSidebarToggle() {
    if (isMobileShell) {
      setMobileSidebarOpen((current) => !current);
      return;
    }
    setSidebarCollapsed((current) => !current);
  }

  function handleModuleSelect(moduleKey: ModuleKey) {
    setActiveModule(moduleKey);
    if (isMobileShell) {
      setMobileSidebarOpen(false);
    }
  }

  function renderPageHeader() {
    const updatedAt =
      dashboardData?.generatedAt ||
      bootstrap?.portfolio?.latestAssetUpdatedAt ||
      bootstrap?.latestImport?.completedAt ||
      bootstrap?.latestImport?.startedAt;
    const sourceLabel =
      activeModule === 'dashboard'
        ? String(dashboardData?.source || 'live').toUpperCase()
        : activeModule === 'handoverForm'
          ? 'ON-PREM LIVE TRANSACTION'
          : 'DATABASE';
    const refreshLabel =
      activeModule === 'dashboard'
        ? 'Refresh Dashboard'
        : activeModule === 'procurementMonitoring' || activeModule === 'procurementArchive'
          ? 'Refresh'
          : 'Refresh Data';

    return (
      <div className="atlas-page-banner">
        <div className="atlas-page-heading">
          <div className="atlas-page-title">{activeConfig.headerTitle}</div>
          {activeModule === 'dashboard' ? (
            <div className="atlas-page-subtitle">
              <span className="dash-eyebrow-badge">IT Asset Management</span>
              <span className="dash-eyebrow-sep">·</span>
              <span className="dash-eyebrow-date">
                <span className="material-icons">schedule</span>
                {formatDate(dashboardData?.generatedAt || bootstrap?.portfolio?.latestAssetUpdatedAt)}
              </span>
            </div>
          ) : null}
        </div>
        <div className="atlas-banner-actions">
          {activeModule === 'catalog' && canManageCatalogNow ? (
            <>
              <button className="atlas-header-action info" onClick={openAddCategoryModal} type="button">
                <span className="material-icons">create_new_folder</span>
                <span>Add Category</span>
              </button>
              <button className="atlas-header-action warning" onClick={openAddCatalogSkuModal} type="button">
                <span className="material-icons">add_circle</span>
                <span>Add New SKU</span>
              </button>
            </>
          ) : null}
          {activeModule === 'masterReference' && canManageMasterReferenceNow ? (
            <>
              <button
                className="atlas-header-action info"
                onClick={() => openMasterReferenceSourceNotice('Add Account (Parent)')}
                type="button"
              >
                <span className="material-icons">account_balance</span>
                <span>Add Account (Parent)</span>
              </button>
              <button
                className="atlas-header-action warning"
                onClick={() => openMasterReferenceSourceNotice('Add Dept (Child)')}
                type="button"
              >
                <span className="material-icons">work</span>
                <span>Add Dept (Child)</span>
              </button>
            </>
          ) : null}
          {activeModule === 'dashboard' ? (
            <span className="atlas-banner-meta">
              <span className="material-icons">hub</span>
              {sourceLabel}
            </span>
          ) : null}
          {activeModule !== 'handoverForm' ? (
            <button className="atlas-refresh-btn" onClick={() => void handleRefreshActive()} type="button">
              <span className="material-icons">refresh</span>
              <span>{refreshLabel}</span>
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderDashboard() {
    if (dashboardLoading && !dashboardData) {
      return <div className="itam-empty">Loading dashboard...</div>;
    }

    if (dashboardError) {
      return <div className="atlas-card atlas-error-panel">{dashboardError}</div>;
    }

    if (!dashboardData) {
      return <div className="itam-empty">Preparing asset dashboard summary...</div>;
    }

    const snapshot = dashboardData.snapshot;
    const bs = bootstrap;
    const totalUnits = snapshot.totalUnits || 0;
    const assignedUnits = snapshot.allocatedUnits || 0;
    const assignedUserUnits = snapshot.allocatedUserUnits || 0;
    const assignedAccountUnits = snapshot.allocatedSharedUnits || 0;
    const availableUnits = Math.max(totalUnits - assignedUnits, 0);
    const assignedShare = totalUnits > 0 ? (assignedUnits / totalUnits) * 100 : 0;
    const userShare = totalUnits > 0 ? (assignedUserUnits / totalUnits) * 100 : 0;
    const accountShare = totalUnits > 0 ? (assignedAccountUnits / totalUnits) * 100 : 0;
    const availableShare = totalUnits > 0 ? (availableUnits / totalUnits) * 100 : 0;
    const dq = dashboardData.dataQuality;
    const totalDqIssues = dq.missingOwnerRows + dq.missingPurchaseDateRows + dq.missingInvoiceRows + dq.inUseWithoutHolderRows + dq.availableWithHolderRows;

    // Horizontal bar helper
    const hbarGradients = [
      'linear-gradient(90deg,#2563eb,#60a5fa)',
      'linear-gradient(90deg,#7c3aed,#a78bfa)',
      'linear-gradient(90deg,#0d9488,#2dd4bf)',
      'linear-gradient(90deg,#1d4ed8,#818cf8)',
      'linear-gradient(90deg,#0369a1,#38bdf8)',
      'linear-gradient(90deg,#475569,#94a3b8)',
      'linear-gradient(90deg,#475569,#94a3b8)',
      'linear-gradient(90deg,#374151,#9ca3af)',
    ];
    const renderHBar = (items: DashboardOwnerBucket[], maxItems = 8) => {
      const visible = items.slice(0, maxItems);
      if (!visible.length) return <div className="itam-empty">No data available.</div>;
      const maxUnits = visible[0]?.units || 1;
      return (
        <div className="itam-hbar-list">
          {visible.map((item, i) => (
            <div className="itam-hbar-row" key={`${item.label}-${i}`}>
              <div className="itam-hbar-label" title={item.label}>{item.label}</div>
              <div className="itam-hbar-track">
                <div className="itam-hbar-fill" style={{ width: `${Math.max(2, (item.units / maxUnits) * 100)}%`, background: hbarGradients[i] ?? hbarGradients[5] }} />
              </div>
              <div className="itam-hbar-meta">
                <span className="itam-hbar-val">{formatNumber(item.units)}</span>
                <span className="itam-hbar-pct">{formatPercent(item.sharePct)}</span>
              </div>
            </div>
          ))}
        </div>
      );
    };

    const recentHandovers = Array.isArray(bs?.recentHandovers) ? bs!.recentHandovers : [];
    const recentProcurement = Array.isArray(bs?.recentProcurement) ? bs!.recentProcurement : [];

    const handoverStatusColor = (s: string) => {
      const v = String(s || '').toLowerCase();
      if (v.includes('final') || v.includes('complet')) return '#16a34a';
      if (v.includes('draft') || v.includes('pending')) return '#d97706';
      if (v.includes('void') || v.includes('cancel')) return '#dc2626';
      return '#64748b';
    };

    return (
      <div className="atlas-content-stack">

        {/* ── System Telemetry Bar ─────────────────────────────── */}
        <section className="itam-telemetry-bar">
          <div className="itam-tel-item">
            <span className="material-icons">inventory_2</span>
            <div>
              <div className="itam-tel-val">{formatNumber(bs?.summary?.assetCount ?? snapshot.totalRows)}</div>
              <div className="itam-tel-lbl">Asset Records</div>
            </div>
          </div>
          <div className="itam-tel-sep" />
          <div className="itam-tel-item">
            <span className="material-icons">assignment</span>
            <div>
              <div className="itam-tel-val">{formatNumber(bs?.summary?.handoverCount ?? 0)}</div>
              <div className="itam-tel-lbl">Handover Docs</div>
            </div>
          </div>
          <div className="itam-tel-sep" />
          <div className="itam-tel-item">
            <span className="material-icons">shopping_cart</span>
            <div>
              <div className="itam-tel-val">{formatNumber(bs?.summary?.procurementCount ?? 0)}</div>
              <div className="itam-tel-lbl">Procurement</div>
            </div>
          </div>
          <div className="itam-tel-sep" />
          <div className="itam-tel-item">
            <span className="material-icons">people</span>
            <div>
              <div className="itam-tel-val">{formatNumber(bs?.summary?.holdingsCount ?? 0)}</div>
              <div className="itam-tel-lbl">Holdings</div>
            </div>
          </div>
          <div className="itam-tel-sep" />
          <div className="itam-tel-item">
            <span className="material-icons">receipt_long</span>
            <div>
              <div className="itam-tel-val">{formatNumber(bs?.summary?.ledgerCount ?? 0)}</div>
              <div className="itam-tel-lbl">Ledger Entries</div>
            </div>
          </div>
          <div className="itam-tel-sep" />
          <div className="itam-tel-item">
            <span className="material-icons">category</span>
            <div>
              <div className="itam-tel-val">{formatNumber(bs?.summary?.catalogCount ?? 0)}</div>
              <div className="itam-tel-lbl">Catalog SKUs</div>
            </div>
          </div>
        </section>

        {/* ── KPI Row ──────────────────────────────────────────── */}
        <section className="itam-kpi-row">
          <article className="itam-kpi-card is-blue">
            <div className="itam-kc-accent" />
            <div className="itam-kc-icon"><span className="material-icons">devices</span></div>
            <div className="itam-kc-body">
              <div className="itam-kc-label">Total Portfolio</div>
              <div className="itam-kc-value">{formatNumber(totalUnits)}</div>
              <div className="itam-kc-row">
                <span>{formatNumber(snapshot.totalRows)} rows</span>
                <span>{formatNumber(snapshot.categories)} categories</span>
              </div>
            </div>
            <div className="itam-kc-ring" style={{ background: `conic-gradient(#2563eb ${Math.round(assignedShare * 3.6)}deg, #dbeafe 0deg)` }}>
              <div className="itam-kc-ring-inner">{formatPercent(assignedShare)}<span>util.</span></div>
            </div>
          </article>

          <article className="itam-kpi-card is-green">
            <div className="itam-kc-accent" />
            <div className="itam-kc-icon"><span className="material-icons">check_circle</span></div>
            <div className="itam-kc-body">
              <div className="itam-kc-label">Allocated</div>
              <div className="itam-kc-value">{formatNumber(assignedUnits)}</div>
              <div className="itam-kc-row">
                <span>To user: {formatNumber(assignedUserUnits)}</span>
                <span>To acct: {formatNumber(assignedAccountUnits)}</span>
              </div>
            </div>
            <div className="itam-kc-ring" style={{ background: `conic-gradient(#16a34a ${Math.round(userShare * 3.6)}deg, #4ade80 ${Math.round(userShare * 3.6)}deg ${Math.round((userShare + accountShare) * 3.6)}deg, #dcfce7 0deg)` }}>
              <div className="itam-kc-ring-inner is-green">{formatPercent(assignedShare)}<span>alloc.</span></div>
            </div>
          </article>

          <article className="itam-kpi-card is-slate">
            <div className="itam-kc-accent" />
            <div className="itam-kc-icon"><span className="material-icons">warehouse</span></div>
            <div className="itam-kc-body">
              <div className="itam-kc-label">Available Stock</div>
              <div className="itam-kc-value">{formatNumber(availableUnits)}</div>
              <div className="itam-kc-row">
                <span>{formatNumber(snapshot.ownerAccounts)} owner accounts</span>
                <span>{formatPercent(availableShare)}</span>
              </div>
            </div>
            <div className="itam-kc-ring" style={{ background: `conic-gradient(#475569 ${Math.round(availableShare * 3.6)}deg, #e2e8f0 0deg)` }}>
              <div className="itam-kc-ring-inner is-slate">{formatPercent(availableShare)}<span>free</span></div>
            </div>
          </article>

          <article className={`itam-kpi-card ${totalDqIssues === 0 ? 'is-teal' : totalDqIssues > 50 ? 'is-red' : 'is-amber'}`}>
            <div className="itam-kc-accent" />
            <div className="itam-kc-icon"><span className="material-icons">health_and_safety</span></div>
            <div className="itam-kc-body">
              <div className="itam-kc-label">Data Quality</div>
              <div className="itam-kc-value">{totalDqIssues === 0 ? 'Clean' : formatNumber(totalDqIssues)}</div>
              <div className="itam-kc-row">
                <span>{totalDqIssues === 0 ? 'All checks passed' : 'total incomplete fields'}</span>
              </div>
            </div>
            <div className="itam-kc-ring" style={{ background: totalDqIssues === 0 ? `conic-gradient(#0d9488 360deg, #ccfbf1 0deg)` : `conic-gradient(#d97706 ${Math.min(360, totalDqIssues)}deg, #fef3c7 0deg)` }}>
              <div className={`itam-kc-ring-inner ${totalDqIssues === 0 ? 'is-teal' : 'is-amber'}`}>{totalDqIssues === 0 ? '✓' : totalDqIssues}<span>{totalDqIssues === 0 ? 'ok' : 'issues'}</span></div>
            </div>
          </article>
        </section>

        {/* ── Allocation Full-Width ─────────────────────────────── */}
        <section className="itam-panel itam-alloc-full">
          <div className="itam-panel-head itam-alloc-head">
            <div className="itam-panel-title">Portfolio Allocation Breakdown</div>
            <div className="itam-alloc-chips">
              <span className="itam-alloc-chip chip-user">User&nbsp;<b>{formatPercent(userShare)}</b></span>
              <span className="itam-alloc-chip chip-shared">Account&nbsp;<b>{formatPercent(accountShare)}</b></span>
              <span className="itam-alloc-chip chip-avail">Available&nbsp;<b>{formatPercent(availableShare)}</b></span>
            </div>
          </div>
          <div className="itam-panel-body">
            <div className="itam-alloc-bar-wrap">
              <div className="itam-stacked-meter itam-stacked-xl">
                <span className="seg-user" style={{ width: `${userShare}%` }} />
                <span className="seg-shared" style={{ width: `${accountShare}%` }} />
                <span className="seg-available" style={{ width: `${availableShare}%` }} />
              </div>
              <div className="itam-alloc-legend-row">
                <div className="itam-alloc-leg-item">
                  <div className="itam-alloc-leg-swatch" style={{ background: 'linear-gradient(90deg,#2563eb,#60a5fa)' }} />
                  <div className="itam-alloc-leg-text">
                    <strong>Assigned to User</strong>
                    <span>Named employee-level assignment</span>
                  </div>
                  <div className="itam-alloc-leg-nums">
                    <b>{formatNumber(assignedUserUnits)}</b>
                    <em>{formatPercent(userShare)}</em>
                  </div>
                </div>
                <div className="itam-alloc-leg-item">
                  <div className="itam-alloc-leg-swatch" style={{ background: 'linear-gradient(90deg,#7c3aed,#c4b5fd)' }} />
                  <div className="itam-alloc-leg-text">
                    <strong>Assigned to Account</strong>
                    <span>Shared / pooled at account level</span>
                  </div>
                  <div className="itam-alloc-leg-nums">
                    <b>{formatNumber(assignedAccountUnits)}</b>
                    <em>{formatPercent(accountShare)}</em>
                  </div>
                </div>
                <div className="itam-alloc-leg-item">
                  <div className="itam-alloc-leg-swatch" style={{ background: 'linear-gradient(90deg,#94a3b8,#e2e8f0)' }} />
                  <div className="itam-alloc-leg-text">
                    <strong>Available Stock</strong>
                    <span>Un-allocated, ready for issuance</span>
                  </div>
                  <div className="itam-alloc-leg-nums">
                    <b>{formatNumber(availableUnits)}</b>
                    <em>{formatPercent(availableShare)}</em>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Category + Owner Account ──────────────────────────── */}
        <section className="itam-dual-grid">
          <article className="itam-panel">
            <div className="itam-panel-head">
              <div className="itam-panel-title">Asset Category Distribution</div>
              <div className="itam-panel-chip">{formatNumber(snapshot.categories)} categories</div>
            </div>
            <div className="itam-panel-body">
              {renderHBar(snapshot.categoryByUnits, 8)}
            </div>
          </article>

          <article className="itam-panel">
            <div className="itam-panel-head">
              <div className="itam-panel-title">Ownership by Account</div>
              <div className="itam-panel-chip">{formatNumber(snapshot.ownerAccounts)} accounts</div>
            </div>
            <div className="itam-panel-body">
              {renderHBar(snapshot.ownerAccountByUnits, 8)}
            </div>
          </article>
        </section>

        {/* ── Data Quality + Recent Activity ────────────────────── */}
        <section className="itam-triple-grid">
          <article className="itam-panel">
            <div className="itam-panel-head">
              <div className="itam-panel-title">Data Completeness</div>
              <div className={`itam-panel-chip ${totalDqIssues === 0 ? 'chip-ok' : 'chip-warn'}`}>
                {totalDqIssues === 0 ? 'All Clean' : `${formatNumber(totalDqIssues)} issues`}
              </div>
            </div>
            <div className="itam-panel-body">
              {[
                { label: 'Owner field', val: dq.missingOwnerRows, icon: 'manage_accounts' },
                { label: 'Purchase date', val: dq.missingPurchaseDateRows, icon: 'event' },
                { label: 'Invoice reference', val: dq.missingInvoiceRows, icon: 'receipt' },
                { label: 'In-use holder linked', val: dq.inUseWithoutHolderRows, icon: 'link' },
                { label: 'Available holder cleared', val: dq.availableWithHolderRows, icon: 'link_off' },
              ].map((c) => {
                const isOk = c.val === 0;
                const isBad = c.val > 20;
                const pct = snapshot.totalRows > 0 ? Math.min(100, (c.val / snapshot.totalRows) * 100) : 0;
                return (
                  <div className="itam-dq-row" key={c.label}>
                    <span className={`material-icons itam-dq-icon ${isOk ? 'ok' : isBad ? 'bad' : 'warn'}`}>{c.icon}</span>
                    <div className="itam-dq-body">
                      <div className="itam-dq-top">
                        <span className="itam-dq-label">{c.label}</span>
                        <span className={`itam-dq-count ${isOk ? 'ok' : ''}`}>{isOk ? '✓ Complete' : `${formatNumber(c.val)} rows`}</span>
                      </div>
                      <div className="itam-dq-track">
                        <div className={`itam-dq-fill ${isOk ? 'ok' : isBad ? 'bad' : 'warn'}`} style={{ width: isOk ? '0%' : `${Math.max(2, pct)}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="itam-panel">
            <div className="itam-panel-head">
              <div className="itam-panel-title">Recent Handovers</div>
              <div className="itam-panel-chip">{recentHandovers.length > 0 ? `Latest ${recentHandovers.length}` : 'No data'}</div>
            </div>
            <div className="itam-panel-body">
              {recentHandovers.length === 0 ? (
                <div className="itam-empty">No recent handover transactions.</div>
              ) : (
                <div className="itam-activity-list">
                  {recentHandovers.map((h, i) => {
                    const doc = h as Record<string, unknown>;
                    const status = String(doc.status || '');
                    const txType = String(doc.transactionType || '-');
                    const typeShort = txType.includes('OUT') || txType.includes('Issue') ? 'OUT' : txType.includes('IN') || txType.includes('Return') ? 'IN' : txType.length > 0 ? txType.substring(0,4).toUpperCase() : '-';
                    const color = handoverStatusColor(status);
                    return (
                      <div className="itam-activity-row" key={i}>
                        <div className="itam-act-badge" style={{ background: `${color}18`, color }}>{typeShort}</div>
                        <div className="itam-act-body">
                          <div className="itam-act-title">{String(doc.holderName || '-')}</div>
                          <div className="itam-act-meta">{String(doc.docNumber || '-')}</div>
                        </div>
                        <div className="itam-act-right">
                          <div className="itam-act-status" style={{ color }}>{status || '-'}</div>
                          <div className="itam-act-date">{doc.transactionTimestamp ? formatDate(String(doc.transactionTimestamp)) : '-'}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </article>

          <article className="itam-panel">
            <div className="itam-panel-head">
              <div className="itam-panel-title">Recent Procurement</div>
              <div className="itam-panel-chip">{recentProcurement.length > 0 ? `Latest ${recentProcurement.length}` : 'No data'}</div>
            </div>
            <div className="itam-panel-body">
              {recentProcurement.length === 0 ? (
                <div className="itam-empty">No recent procurement requests.</div>
              ) : (
                <div className="itam-activity-list">
                  {recentProcurement.map((p, i) => {
                    const pr = p as Record<string, unknown>;
                    const status = String(pr.status || '');
                    const fulf = String(pr.fulfillment || '-');
                    const fulfShort = fulf.includes('Purchase') ? 'PO' : fulf.includes('Stock') ? 'STK' : fulf.substring(0, 3).toUpperCase();
                    const statusColor = status.toLowerCase().includes('done') || status.toLowerCase().includes('fulfill') ? '#16a34a' : status.toLowerCase().includes('pending') || status.toLowerCase().includes('process') ? '#d97706' : '#64748b';
                    return (
                      <div className="itam-activity-row" key={i}>
                        <div className="itam-act-badge" style={{ background: `${statusColor}18`, color: statusColor }}>{fulfShort}</div>
                        <div className="itam-act-body">
                          <div className="itam-act-title">{String(pr.requestorName || '-')}</div>
                          <div className="itam-act-meta">{String(pr.itemSummary || pr.requestNumber || '-')}</div>
                        </div>
                        <div className="itam-act-right">
                          <div className="itam-act-status" style={{ color: statusColor }}>{status || '-'}</div>
                          <div className="itam-act-date">{pr.requestTimestamp ? formatDate(String(pr.requestTimestamp)) : '-'}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </article>
        </section>
      </div>
    );
  }

  function renderInlineAction(label: string, onClick: () => void, icon = 'open_in_new') {
    return (
      <button
        className="atlas-inline-link"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        type="button"
      >
        <span className="material-icons">{icon}</span>
        {label}
      </button>
    );
  }

  function renderAssetDetailContent(payload: AssetDetailResponse) {
    const asset = (payload.asset || {}) as Record<string, unknown>;
    const history = Array.isArray(payload.history) ? payload.history : [];
    const assignedMeta = asset.assignedMeta as Record<string, unknown> | null;
    const currentAssignmentHint = asset.currentAssignmentHint as Record<string, unknown> | null;
    const currentHolders = Array.isArray(asset.currentHolders) ? (asset.currentHolders as Array<Record<string, unknown>>) : [];
    const tagValue = toText(asset.tag);
    const categoryValue = toText(asset.category);
    const modelValue = toText(asset.itemModel);
    const locationValue = toText(asset.location);
    const ownerAccount = toText(asset.assetAccount || asset.ownerAccount);
    const ownerDept = toText(asset.assetDepartment || asset.ownerDept);
    const sharedAssignmentText = [
      toText(currentAssignmentHint?.sharedAccount) !== '-' ? `Account: ${toText(currentAssignmentHint?.sharedAccount)}` : '',
      toText(currentAssignmentHint?.sharedDept) !== '-' ? `Dept: ${toText(currentAssignmentHint?.sharedDept)}` : ''
    ]
      .filter(Boolean)
      .join(' • ');
    const normalizedMeta = `${categoryValue} ${modelValue}`.toLowerCase();
    const isLaptop = /laptop|notebook/.test(normalizedMeta);
    const isDesktop = !isLaptop && /desktop|\bpc\b|computer/.test(normalizedMeta);
    const isComputer = isLaptop || isDesktop;
    const techSpecRows = isComputer
      ? [
          ['RAM Size', toText(asset.ramSize)],
          ['RAM Type', toText(asset.ramType)],
          ['Storage Size', toText(asset.storageSize)],
          ['Storage Type', toText(asset.storageType)],
          ...(isDesktop
            ? [
                ['External VGA', toText(asset.extVgaUsed)],
                ['External VGA Type', toText(asset.extVgaType)]
              ]
            : [])
        ]
      : [];
    const poValue = toText(asset.orderNumber);
    const invoiceValue = toText(asset.invoice);
    const purchaseRefs = [
      poValue !== '-' ? `PO / Order: ${poValue}` : '',
      invoiceValue !== '-' ? `Invoice: ${invoiceValue}` : ''
    ]
      .filter(Boolean)
      .join(' • ');

    const renderAssetStatus = (value: unknown) => {
      const normalized = normalizeAtlasToken(value);
      const tone =
        normalized === 'available'
          ? 's-available'
          : normalized === 'inuse' || normalized === 'assigned'
            ? 's-inuse'
            : normalized === 'broken'
              ? 's-broken'
              : 's-other';

      return (
        <span className={`assetd-status ${tone}`}>
          <span className="material-icons">circle</span>
          {toText(value)}
        </span>
      );
    };

    let holderBlock: ReactNode = <div className="assetd-empty">No active holder is currently attached to this asset.</div>;

    if (Boolean(currentAssignmentHint?.isShared)) {
      holderBlock = (
        <div className="assetd-holder">
          <div>
            <div className="assetd-holder-name">
              Sharing Asset <span className="assetd-pill p-shared">Shared</span>
            </div>
            <div className="assetd-holder-meta">
              {sharedAssignmentText || 'Asset ini sedang di-assign sebagai sharing asset.'}
            </div>
            <div className="assetd-small">
              Assignment trace points to a shared account / department, not a specific individual.
            </div>
          </div>
        </div>
      );
    } else if (assignedMeta) {
      const assignedMetaLine = [toText(assignedMeta.account), toText(assignedMeta.dept)]
        .filter((value) => value !== '-')
        .join(' • ');

      holderBlock = (
        <div className="assetd-holder">
          <div>
            <div className="assetd-holder-name">
              {toText(assignedMeta.fullName || asset.assignedTo)}
              {toText(assignedMeta.nik) !== '-' ? <span className="assetd-small"> ({toText(assignedMeta.nik)})</span> : null}
            </div>
            <div className="assetd-holder-meta">{assignedMetaLine || 'Employee profile available'}</div>
            {toText(assignedMeta.title) !== '-' ? <div className="assetd-small">{toText(assignedMeta.title)}</div> : null}
          </div>
          <button
            className="assetd-linkbtn"
            onClick={() => void openEmployeeDetail(toText(assignedMeta.nik || assignedMeta.email || assignedMeta.fullName))}
            type="button"
          >
            <span className="material-icons">person_search</span>
            User Detail
          </button>
        </div>
      );
    } else if (currentHolders.length) {
      const summaryText = `${currentHolders.length} user(s) • ${formatNumber(
        currentHolders.reduce((sum, holder) => sum + Math.max(1, Number(holder.qty ?? holder.balance ?? 1)), 0)
      )} unit(s) in use`;

      holderBlock = (
        <div className="assetd-holder-stack">
          <div className="assetd-holder">
            <div>
              <div className="assetd-holder-name">Multi-user assignment</div>
              <div className="assetd-holder-meta">{summaryText}</div>
            </div>
          </div>
          {currentHolders.map((holder, index) => {
            const metaLine = [toText(holder.account), toText(holder.dept)]
              .filter((value) => value !== '-')
              .join(' • ');
            return (
              <div className="assetd-holder" key={`holder-${index}`}>
                <div>
                  <div className="assetd-holder-name">
                    {toText(holder.userName)}
                    {toText(holder.userNIK) !== '-' ? <span className="assetd-small"> ({toText(holder.userNIK)})</span> : null}
                  </div>
                  <div className="assetd-holder-meta">{metaLine || toText(holder.title || 'BAST active balance')}</div>
                </div>
                <div className="assetd-holder-actions">
                  <span className="assetd-chip assetd-chip-light">
                    <span className="material-icons">inventory</span>
                    {formatNumber(holder.qty ?? holder.balance ?? 0)} unit
                  </span>
                  <button
                    className="assetd-linkbtn"
                    onClick={() => void openEmployeeDetail(toText(holder.userNIK || holder.userEmail || holder.userName))}
                    type="button"
                  >
                    <span className="material-icons">person_search</span>
                    Trace
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="assetd-shell">
        <div className="assetd-hero">
          <div className="assetd-hero-top">
            <div>
              <div className="assetd-title">
                {tagValue} · Asset Detail
              </div>
              <div className="assetd-sub">{purchaseRefs || 'Inventory Asset Detail & Handover Traceability'}</div>
              <div className="assetd-chiprow">
                <span className="assetd-chip">
                  <span className="material-icons">category</span>
                  {categoryValue}
                </span>
                {renderAssetStatus(asset.status)}
                <span className="assetd-chip">
                  <span className="material-icons">place</span>
                  {locationValue}
                </span>
              </div>
            </div>
            {modelValue !== '-' ? (
              <button
                className="assetd-linkbtn assetd-linkbtn-hero"
                onClick={() => void openCatalogDetailByName(modelValue, categoryValue)}
                type="button"
              >
                <span className="material-icons">memory</span>
                Model Spec
              </button>
            ) : null}
          </div>
        </div>

        <div className="assetd-grid">
          <div className="assetd-card assetd-span-8">
            <div className="assetd-card-h">
              <div className="ttl">
                <span className="material-icons">inventory_2</span>
                Identification & Ownership
              </div>
            </div>
            <div className="assetd-card-b">
              <div className="assetd-kv">
                <div className="assetd-f">
                  <div className="assetd-lbl">Asset Tag</div>
                  <div className="assetd-val">{tagValue}</div>
                </div>
                <div className="assetd-f">
                  <div className="assetd-lbl">Serial Number</div>
                  <div className="assetd-val">{toText(asset.sn)}</div>
                </div>
                <div className="assetd-f">
                  <div className="assetd-lbl">Status</div>
                  <div className="assetd-val">{renderAssetStatus(asset.status)}</div>
                </div>
                <div className="assetd-f">
                  <div className="assetd-lbl">Quantity</div>
                  <div className="assetd-val">{formatNumber(asset.quantity ?? 0)}</div>
                </div>
                <div className="assetd-f w8">
                  <div className="assetd-lbl">Item Model</div>
                  <div className="assetd-val">{modelValue}</div>
                </div>
                <div className="assetd-f">
                  <div className="assetd-lbl">Category</div>
                  <div className="assetd-val">{categoryValue}</div>
                </div>
                <div className="assetd-f w6">
                  <div className="assetd-lbl">Owner Account</div>
                  <div className="assetd-val">{ownerAccount}</div>
                </div>
                <div className="assetd-f w6">
                  <div className="assetd-lbl">Owner Department</div>
                  <div className="assetd-val">{ownerDept}</div>
                </div>
                <div className="assetd-f w12">
                  <div className="assetd-lbl">Current Holder</div>
                  {holderBlock}
                </div>
              </div>
            </div>
          </div>

          <div className="assetd-card assetd-span-4">
            <div className="assetd-card-h">
              <div className="ttl">
                <span className="material-icons">receipt_long</span>
                Procurement
              </div>
            </div>
            <div className="assetd-card-b">
              <div className="assetd-kv">
                <div className="assetd-f w12">
                  <div className="assetd-lbl">Vendor</div>
                  <div className="assetd-val">{toText(asset.vendor)}</div>
                </div>
                <div className="assetd-f w12">
                  <div className="assetd-lbl">Purchase Date</div>
                  <div className="assetd-val">{formatDateOnly(asset.purchaseDate)}</div>
                </div>
                <div className="assetd-f">
                  <div className="assetd-lbl">Year</div>
                  <div className="assetd-val">{toText(asset.purchasingYear)}</div>
                </div>
                <div className="assetd-f w8">
                  <div className="assetd-lbl">Location</div>
                  <div className="assetd-val">{locationValue}</div>
                </div>
                <div className="assetd-f w12">
                  <div className="assetd-lbl">Order Number / PO</div>
                  <div className="assetd-val">{poValue}</div>
                </div>
                <div className="assetd-f w12">
                  <div className="assetd-lbl">Invoice</div>
                  <div className="assetd-val">{invoiceValue}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="assetd-card assetd-span-12">
            <div className="assetd-card-h">
              <div className="ttl">
                <span className="material-icons">settings_suggest</span>
                Technical Specification
              </div>
              <div className="assetd-small">
                {isComputer ? (isDesktop ? 'PC/Desktop profile' : 'Laptop/Notebook profile') : 'General asset profile'}
              </div>
            </div>
            <div className="assetd-card-b">
              <div className="assetd-kv">
                {techSpecRows.length ? (
                  techSpecRows.map(([label, value]) => (
                    <div className="assetd-f" key={label}>
                      <div className="assetd-lbl">{label}</div>
                      <div className="assetd-val">{value}</div>
                    </div>
                  ))
                ) : (
                  <div className="assetd-empty">Technical specs belum diwajibkan untuk kategori ini.</div>
                )}
              </div>
            </div>
          </div>

          <div className="assetd-card assetd-span-12">
            <div className="assetd-card-h">
              <div className="ttl">
                <span className="material-icons">history</span>
                Movement & Revision History
              </div>
              <div className="assetd-small">{history.length} record(s) • BAST + manual quantity revision log</div>
            </div>
            <div className="assetd-card-b">
              {history.length ? (
                <div className="assetd-history-wrap">
                  <table className="assetd-history-table">
                    <thead>
                      <tr>
                        <th>Date/Time</th>
                        <th>Doc ID</th>
                        <th>Type</th>
                        <th>User</th>
                        <th>Dept</th>
                        <th>Status</th>
                        <th>Qty</th>
                        <th>Notes</th>
                        <th>BAST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((entry, index) => {
                        const qtyRaw = toText(entry.qtyDisplay || entry.qtyDelta || entry.qty);
                        const qtyNumeric = Number(String(qtyRaw).replace(/[^0-9+-.]/g, ''));
                        const qtyClass = Number.isFinite(qtyNumeric)
                          ? qtyNumeric > 0
                            ? 'qty-positive'
                            : qtyNumeric < 0
                              ? 'qty-negative'
                              : 'qty-neutral'
                          : 'qty-neutral';
                        const typePills = [
                          entry.itemType ? <span className="assetd-pill" key={`type-${index}`}>{toText(entry.itemType).toUpperCase()}</span> : null,
                          entry.isShared ? <span className="assetd-pill p-shared" key={`shared-${index}`}>Shared</span> : null,
                          entry.isBroken ? <span className="assetd-pill p-broken" key={`broken-${index}`}>Broken</span> : null
                        ].filter(Boolean);
                        const sharedDetail = [toText(entry.sharedAccount) !== '-' ? `Account: ${toText(entry.sharedAccount)}` : '', toText(entry.sharedDept) !== '-' ? `Dept: ${toText(entry.sharedDept)}` : '']
                          .filter(Boolean)
                          .join(' • ');

                        return (
                          <tr key={`asset-history-${index}`}>
                            <td>{formatDetailedDate(entry.timestamp)}</td>
                            <td>
                              {toText(entry.docID) !== '-' ? (
                                <button className="assetd-linkbtn" onClick={() => void openHandoverDetail(toText(entry.docID))} type="button">
                                  <span className="material-icons">description</span>
                                  {toText(entry.docID)}
                                </button>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td>
                              <div className="assetd-row-title">{toText(entry.transType || entry.rowType).toUpperCase()}</div>
                              {typePills.length ? <div className="assetd-pill-row">{typePills}</div> : null}
                            </td>
                            <td>
                              {toText(entry.userName) !== '-' && !Boolean(entry.isShared) ? (
                                <button
                                  className="assetd-linkbtn"
                                  onClick={() => void openEmployeeDetail(toText(entry.userNIK || entry.userName))}
                                  type="button"
                                >
                                  <span className="material-icons">person</span>
                                  {toText(entry.userName)}
                                </button>
                              ) : (
                                <span>{toText(entry.userName)}</span>
                              )}
                              {Boolean(entry.isShared) ? <div className="assetd-small">Assigned as sharing asset</div> : null}
                            </td>
                            <td>
                              <div>{toText(entry.dept)}</div>
                              {Boolean(entry.isShared) && sharedDetail ? <div className="assetd-small">{sharedDetail}</div> : null}
                            </td>
                            <td><span className="assetd-pill">{toText(entry.status)}</span></td>
                            <td className="assetd-history-qty">
                              <div className="assetd-qty-stack">
                                <span className={`assetd-qty-main ${qtyClass}`}>{qtyRaw}</span>
                              </div>
                            </td>
                            <td>{toText(entry.notes)}</td>
                            <td>
                              {toText(entry.pdfUrl) !== '-' ? (
                                <a className="assetd-linkbtn" href={toText(entry.pdfUrl)} rel="noopener noreferrer" target="_blank">
                                  <span className="material-icons">picture_as_pdf</span>
                                  BAST
                                </a>
                              ) : (
                                '-'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="assetd-empty">Belum ada history serah-terima untuk asset ini.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderEmployeeDetailContent(payload: {
    detail: EmployeeDirectoryDetailResponse;
    history: EmployeeDirectoryHistoryResponse | null;
  }) {
    const detail = payload.detail;
    const history = payload.history;
    const employee = detail.employee;
    const holdings = Array.isArray(detail.holdings) ? detail.holdings : [];
    const historySummary = Array.isArray(history?.historySummary) ? history.historySummary : [];
    const historyEvents = Array.isArray(history?.historyEvents) ? history.historyEvents : [];
    const historyMeta = history?.historyMeta;
    const accountDept = [toText(employee?.account), toText(employee?.dept)].filter(Boolean).join(' • ');
    const mailHref = toText(employee?.email).includes('@') ? `mailto:${toText(employee?.email)}` : '';
    const employeeRole = toText(employee?.title || 'Pending Sync');
    const historyLoaded = Boolean(history?.success);

    return (
      <div className="assetd-shell">
        <div className="assetd-emp-card">
          <div className="assetd-emp-head">
            <div className="assetd-emp-head-row">
              <div>
                <div className="assetd-emp-name">{toText(employee?.fullName)}</div>
                <div className="assetd-emp-sub">{accountDept || 'Employee Asset Holdings'}</div>
              </div>
              {mailHref ? (
                <a className="assetd-linkbtn assetd-linkbtn-hero" href={mailHref}>
                  <span className="material-icons">mail</span>
                  Email
                </a>
              ) : null}
            </div>
          </div>

          <div className="assetd-emp-body">
            <div className="assetd-grid">
              <div className="assetd-card assetd-span-12">
                <div className="assetd-card-b">
                  <div className="assetd-kv">
                    <div className="assetd-f">
                      <div className="assetd-lbl">NIK</div>
                      <div className="assetd-val">{toText(employee?.nik)}</div>
                    </div>
                    <div className="assetd-f w8">
                      <div className="assetd-lbl">Email</div>
                      <div className="assetd-val">{toText(employee?.email)}</div>
                    </div>
                    <div className="assetd-f">
                      <div className="assetd-lbl">Title</div>
                      <div className="assetd-val">{employeeRole}</div>
                    </div>
                    <div className="assetd-f w6">
                      <div className="assetd-lbl">Account</div>
                      <div className="assetd-val">{toText(employee?.account)}</div>
                    </div>
                    <div className="assetd-f w6">
                      <div className="assetd-lbl">Department</div>
                      <div className="assetd-val">{toText(employee?.dept)}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="assetd-card assetd-span-12">
                <div className="assetd-card-b">
                  <div className="assetd-summary-grid">
                    <div className="assetd-summary-box">
                      <span>Current Item Rows</span>
                      <strong>{formatNumber(detail.summary?.totalDistinct ?? 0)}</strong>
                    </div>
                    <div className="assetd-summary-box">
                      <span>Current Units</span>
                      <strong>{formatNumber(detail.summary?.totalUnits ?? 0)}</strong>
                    </div>
                    <div className="assetd-summary-box">
                      <span>Assets Touched</span>
                      <strong>{historyLoaded ? formatNumber(historyMeta?.assetsTouched ?? 0) : '-'}</strong>
                    </div>
                    <div className="assetd-summary-box">
                      <span>Handover Events</span>
                      <strong>{historyLoaded ? formatNumber(historyMeta?.eventCount ?? 0) : '-'}</strong>
                    </div>
                  </div>
                </div>
              </div>

              <div className="assetd-card assetd-span-12">
                <div className="assetd-card-b">
                  <div className="assetd-tabset">
                    <button
                      className={`assetd-tabbtn ${employeeDetailTab === 'current' ? 'active' : ''}`}
                      onClick={() => setEmployeeDetailTab('current')}
                      type="button"
                    >
                      Current Holdings
                    </button>
                    <button
                      className={`assetd-tabbtn ${employeeDetailTab === 'history' ? 'active' : ''}`}
                      onClick={() => setEmployeeDetailTab('history')}
                      type="button"
                    >
                      History & Trace
                    </button>
                  </div>

                  {employeeDetailTab === 'current' ? (
                    <div className="assetd-tabpanel">
                      <div className="assetd-section-head">
                        <div className="ttl">
                          <span className="material-icons">inventory_2</span>
                          Current Asset Holdings
                        </div>
                        <div className="assetd-small">
                          {formatNumber(detail.summary?.totalDistinct ?? 0)} item row(s) • {formatNumber(detail.summary?.totalUnits ?? 0)} total unit(s)
                        </div>
                      </div>
                      <div className="assetd-table-wrap">
                        <table className="assetd-simple-table">
                          <thead>
                            <tr>
                              <th>Asset Ref</th>
                              <th>Item Model</th>
                              <th>Category</th>
                              <th>Qty</th>
                              <th>Location</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {holdings.length ? (
                              holdings.map((holding, index) => (
                                <tr key={`employee-holding-${index}`}>
                                  <td>
                                    {holding.tag && holding.tag !== 'NO-TAG' ? (
                                      <button className="assetd-linkbtn" onClick={() => void openAssetDetail(holding.tag)} type="button">
                                        <span className="material-icons">qr_code_2</span>
                                        {toText(holding.assetRef || holding.tag)}
                                      </button>
                                    ) : (
                                      toText(holding.assetRef || holding.tag)
                                    )}
                                  </td>
                                  <td>{toText(holding.itemModel)}</td>
                                  <td>{toText(holding.category)}</td>
                                  <td><span className="assetd-pill">{formatNumber(holding.qty ?? 0)}</span></td>
                                  <td>{toText(holding.location)}</td>
                                  <td><span className="assetd-pill">{toText(holding.status)}</span></td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td className="assetd-empty-cell" colSpan={6}>This employee is currently not holding any assets.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="assetd-tabpanel">
                      {historyLoaded ? (
                        <>
                          <div className="assetd-section-head">
                            <div className="ttl">
                              <span className="material-icons">history</span>
                              Asset Journey Summary
                            </div>
                            <div className="assetd-small">
                              Quick trace of when each asset started, returned, or is still held by this employee.
                            </div>
                          </div>
                          <div className="assetd-table-wrap assetd-table-wrap-spaced">
                            <table className="assetd-simple-table">
                              <thead>
                                <tr>
                                  <th>Asset Ref</th>
                                  <th>Item Model</th>
                                  <th>Category</th>
                                  <th>First Check Out</th>
                                  <th>Last Check In</th>
                                  <th>Current State</th>
                                </tr>
                              </thead>
                              <tbody>
                                {historySummary.length ? (
                                  historySummary.map((entry, index) => (
                                    <tr key={`employee-journey-${index}`}>
                                      <td>
                                        {entry.tag && entry.tag !== 'NO-TAG' ? (
                                          <button className="assetd-linkbtn" onClick={() => void openAssetDetail(entry.tag)} type="button">
                                            <span className="material-icons">qr_code_2</span>
                                            {toText(entry.assetRef || entry.tag)}
                                          </button>
                                        ) : (
                                          toText(entry.assetRef || entry.tag)
                                        )}
                                      </td>
                                      <td>{toText(entry.itemModel)}</td>
                                      <td>{toText(entry.category)}</td>
                                      <td>{formatDate(entry.firstOutAt)}</td>
                                      <td>{formatDate(entry.lastInAt)}</td>
                                      <td><span className="assetd-pill">{toText(entry.currentState)}</span></td>
                                    </tr>
                                  ))
                                ) : (
                                  <tr>
                                    <td className="assetd-empty-cell" colSpan={6}>No traceable handover history found for this employee.</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>

                          <div className="assetd-section-head">
                            <div className="ttl">
                              <span className="material-icons">timeline</span>
                              Handover Event Trace
                            </div>
                            <div className="assetd-small">{formatNumber(historyMeta?.eventCount ?? 0)} event(s) captured from BAST log.</div>
                          </div>
                          <div className="assetd-table-wrap">
                            <table className="assetd-simple-table">
                              <thead>
                                <tr>
                                  <th>Timestamp</th>
                                  <th>Activity</th>
                                  <th>Asset Ref</th>
                                  <th>Item Model</th>
                                  <th>Qty</th>
                                  <th>Location</th>
                                  <th>Doc ID</th>
                                  <th>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {historyEvents.length ? (
                                  historyEvents.map((event, index) => (
                                    <tr key={`employee-event-${index}`}>
                                      <td>{formatDetailedDate(event.tsIso)}</td>
                                      <td>
                                        <span className={`assetd-pill ${String(event.direction).toUpperCase() === 'OUT' ? 'p-broken' : 'p-shared'}`}>
                                          {toText(event.transType || event.direction)}
                                        </span>
                                      </td>
                                      <td>
                                        {event.tag && event.tag !== 'NO-TAG' ? (
                                          <button className="assetd-linkbtn" onClick={() => void openAssetDetail(event.tag)} type="button">
                                            <span className="material-icons">qr_code_2</span>
                                            {toText(event.assetRef || event.tag)}
                                          </button>
                                        ) : (
                                          toText(event.assetRef || event.itemModel)
                                        )}
                                      </td>
                                      <td>{toText(event.itemModel)}</td>
                                      <td><span className="assetd-pill">{formatNumber(event.qty ?? 0)}</span></td>
                                      <td>{toText(event.location)}</td>
                                      <td>
                                        {toText(event.docId) !== '-' ? (
                                          <button className="assetd-linkbtn" onClick={() => void openHandoverDetail(event.docId)} type="button">
                                            <span className="material-icons">description</span>
                                            {toText(event.docId)}
                                          </button>
                                        ) : (
                                          '-'
                                        )}
                                      </td>
                                      <td><span className="assetd-pill">{toText(event.status)}</span></td>
                                    </tr>
                                  ))
                                ) : (
                                  <tr>
                                    <td className="assetd-empty-cell" colSpan={8}>No handover events found.</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : (
                        <div className="assetd-empty">History & trace is not available right now for this employee.</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="assetd-modal-note">
              Traceability source: Employee Database + Master Asset current assignment (tagged items) + BAST transaction logs
              (history and current accessory balance).
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderHandoverDetailContent(payload: HandoverDetailResponse) {
    const handover = (payload.handover || {}) as Record<string, unknown>;
    const items = Array.isArray(payload.items) ? payload.items : [];
    const auditTrail = Array.isArray(payload.auditTrail) ? payload.auditTrail : [];
    const signatures = payload.signatures || { it: {}, user: {} };
    const itSignature = (signatures.it || {}) as Record<string, unknown>;
    const userSignature = (signatures.user || {}) as Record<string, unknown>;
    const resumeState = (payload.resumeState || {}) as Record<string, unknown>;
    const canResume = Boolean(resumeState.canResume);
    const itSigned = Boolean(itSignature.signed);
    const userSigned = Boolean(userSignature.signed);
    const locationLabel = toText(handover.dutyLocationLabel || handover.dutyLocation || 'IT Room');
    const signatureSummary = (
      <>
        Current Signature: IT <b>{itSigned ? 'SIGNED' : 'PENDING'}</b> {' | '} User <b>{userSigned ? 'SIGNED' : 'PENDING'}</b>
      </>
    );
    const docStatus = toText(handover.status).toLowerCase();
    const canCancelDoc = canManageAssetsNow && docStatus === 'on hold';
    const isCancellingThis = handoverCancelState?.docNumber === toText(handover.docNumber);

    return (
      <div className="atlas-detail-stack">
        <section className="atlas-detail-card">
          <div className="atlas-detail-card-head">
            <div>
              <h3>Handover Detail</h3>
              <p>Compact BAST view aligned with production GAS behavior.</p>
            </div>
            <div className="atlas-cell-stack compact">
              <StatusBadge value={toText(handover.status)} />
              {handover.pdfUrl ? (
                <a className="atlas-inline-link static" href={toText(handover.pdfUrl)} rel="noopener noreferrer" target="_blank">
                  <span className="material-icons">picture_as_pdf</span>
                  Open PDF
                </a>
              ) : null}
            </div>
          </div>

          <div className="atlas-detail-grid compact">
            <div className="atlas-detail-field"><span>Doc ID</span><strong>{toText(handover.docNumber)}</strong></div>
            <div className="atlas-detail-field"><span>Timestamp</span><strong>{formatDate(handover.transactionTimestamp)}</strong></div>
            <div className="atlas-detail-field"><span>Type</span><strong>{toText(handover.transactionType)}</strong></div>
            <div className="atlas-detail-field"><span>Name</span><strong>{toText(handover.holderName || handover.userName)}</strong></div>
            <div className="atlas-detail-field"><span>NIK</span><strong>{toText(handover.holderNik || handover.userNIK)}</strong></div>
            <div className="atlas-detail-field"><span>Dept</span><strong>{toText(handover.holderDepartment || handover.userDept)}</strong></div>
            <div className="atlas-detail-field"><span>Asset Location</span><strong>{locationLabel}</strong></div>
            <div className="atlas-detail-field"><span>Account</span><strong>{toText(handover.userAccount || handover.userAcc)}</strong></div>
          </div>

          {docStatus === 'cancelled' ? (() => {
            const revHistory = Array.isArray(payload.revisionHistory) ? payload.revisionHistory : [];
            const cancelEntry = [...revHistory].reverse().find(
              (e) => String(e?.action || '').toUpperCase() === 'CANCEL' || String(e?.event || '').toUpperCase() === 'CANCELLED'
            );
            if (!cancelEntry) return null;
            return (
              <div className="atlas-detail-cancel-info">
                <div className="atlas-detail-cancel-info-title">
                  <span className="material-icons">block</span>
                  Cancellation Notice
                </div>
                <div className="atlas-detail-cancel-info-rows">
                  <div className="atlas-detail-cancel-info-row">
                    <span>Cancelled by</span>
                    <strong>{toText(cancelEntry.by)}</strong>
                  </div>
                  <div className="atlas-detail-cancel-info-row">
                    <span>Date</span>
                    <strong>{formatDate(cancelEntry.ts)}</strong>
                  </div>
                  {cancelEntry.reason ? (
                    <div className="atlas-detail-cancel-info-row full">
                      <span>Reason</span>
                      <strong>{toText(cancelEntry.reason)}</strong>
                    </div>
                  ) : (
                    <div className="atlas-detail-cancel-info-row full">
                      <span>Reason</span>
                      <strong className="atlas-muted-text">No reason provided.</strong>
                    </div>
                  )}
                </div>
              </div>
            );
          })() : null}

          {canResume ? (
            <div className="atlas-detail-alert" style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span>This document is On Hold and can be resumed.</span>
              <button
                className="atlas-toolbar-btn"
                onClick={() => beginHandoverResume(toText(handover.docNumber))}
                type="button"
              >
                Resume Transaction
              </button>
            </div>
          ) : null}

          {canCancelDoc && !isCancellingThis ? (
            <div className="atlas-detail-cancel-hint">
              <span className="material-icons">warning</span>
              <span>This BAST is pending IT signature. If the transaction is incorrect, you can void it.</span>
              <button
                className="atlas-detail-cancel-btn"
                onClick={() => openHandoverCancel(toText(handover.docNumber))}
                type="button"
              >
                Cancel BAST
              </button>
            </div>
          ) : null}

          {isCancellingThis && handoverCancelState ? (
            <div className="atlas-detail-cancel-panel">
              <div className="atlas-detail-cancel-panel-title">
                <span className="material-icons">block</span>
                Cancel BAST — {handoverCancelState.docNumber}
              </div>
              <p className="atlas-detail-cancel-panel-desc">
                This will void the handover document. Status will change from <strong>On Hold</strong> to <strong>Cancelled</strong>.
                The user should be informed separately.
              </p>
              <label className="atlas-detail-cancel-reason-label">
                <span>Reason / Note for cancellation (optional)</span>
                <textarea
                  className="atlas-detail-cancel-reason"
                  disabled={handoverCancelState.saving}
                  onChange={(e) => setHandoverCancelState((s) => s ? { ...s, reason: e.target.value } : s)}
                  placeholder="e.g. Wrong employee, wrong asset, duplicate submission..."
                  rows={3}
                  value={handoverCancelState.reason}
                />
              </label>
              {handoverCancelState.message ? (
                <div className={`asset-action-message ${handoverCancelState.message.kind}`}>{handoverCancelState.message.text}</div>
              ) : null}
              <div className="atlas-detail-cancel-actions">
                <button
                  className="atlas-toolbar-btn subtle"
                  disabled={handoverCancelState.saving}
                  onClick={() => setHandoverCancelState(null)}
                  type="button"
                >
                  Keep BAST
                </button>
                <button
                  className="asset-danger-btn"
                  disabled={handoverCancelState.saving}
                  onClick={() => void submitHandoverCancel()}
                  type="button"
                >
                  {handoverCancelState.saving ? 'Cancelling...' : 'Confirm Cancel'}
                </button>
              </div>
            </div>
          ) : null}

          <div className="atlas-detail-note-box"><b>Notes:</b> {toText(handover.notes)}</div>
        </section>

        <section className="atlas-detail-card">
          <div className="atlas-detail-card-head">
            <div>
              <h3>Items Detail</h3>
              <p>Essential line item summary only.</p>
            </div>
          </div>
          <TableCard
            columns={['Type', 'Tag', 'Item', 'Qty', 'Assignment / Condition']}
            emptyMessage="No handover items are attached to this document."
            rows={items.map((item, index) => {
              const assetTag = toText(item.assetTag || item.tag);
              const assignmentBadges: ReactNode[] = [];
              if (Boolean(item.isShared)) assignmentBadges.push(<span className="atlas-mini-pill tone-blue" key={`shared-${index}`}>Shared</span>);
              if (Boolean(item.isBroken)) assignmentBadges.push(<span className="atlas-mini-pill tone-danger" key={`broken-${index}`}>Broken</span>);

              return [
                toText(item.direction || item.type),
                assetTag && assetTag !== 'NO-TAG'
                  ? renderInlineAction(assetTag, () => void openAssetDetail(assetTag), 'qr_code_2')
                  : assetTag || '-',
                toText(item.itemSku || item.itemName || item.sku),
                formatNumber(item.quantity ?? item.qty ?? 0),
                <div className="atlas-cell-stack" key={`assignment-${index}`}>
                  <div className="atlas-mini-pill-row">{assignmentBadges}</div>
                  <small>{toText(item.assignmentLabel || item.sharedDetail || item.conditionNote || 'Standard assignment')}</small>
                </div>
              ];
            })}
          />
        </section>

        <section className="atlas-detail-card">
          <div className="atlas-detail-card-head">
            <div>
              <h3>History / Audit Log</h3>
              <p>Latest first</p>
            </div>
          </div>
          <div className="atlas-detail-note-box">{signatureSummary}</div>
          {auditTrail.length ? (
            <div className="atlas-timeline">
              {auditTrail.map((entry, index) => (
                <div className="atlas-timeline-item" key={`audit-${index}`}>
                  <div className="atlas-timeline-dot" />
                  <div className="atlas-timeline-body">
                    <div className="atlas-timeline-head">
                      <span className="atlas-mini-pill">{toText(entry.label || entry.action || 'Activity')}</span>
                      <small>{formatDate(entry.ts)}</small>
                    </div>
                    <strong>{formatActivityActor(entry.by || entry.actor)}</strong>
                    <p>{toText(entry.message || entry.summary || entry.action)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="atlas-detail-empty">No audit trail available for this BAST document.</div>
          )}

          <div className="atlas-detail-grid compact" style={{ marginTop: 12 }}>
            <div className="atlas-detail-field">
              <span>IT Signature</span>
              <strong>{itSigned ? 'SIGNED' : 'PENDING'}</strong>
              <small>Signed by: {toText(itSignature.label || itSignature.email || handover.signerITEmail || '-')}</small>
            </div>
            <div className="atlas-detail-field">
              <span>User Signature</span>
              <strong>{userSigned ? 'SIGNED' : 'PENDING'}</strong>
              <small>Signed as: {toText(userSignature.label || userSignature.email || handover.signerUserLabel || handover.holderName || '-')}</small>
            </div>
          </div>
        </section>
      </div>
    );
  }

  function renderProcurementDetailContent(payload: {
    item: ProcurementRow;
    activities: ProcurementActivity[];
    sourceLabel?: string;
  }) {
    const item = payload.item;
    const activities = payload.activities;
    const sourceLabel = toText(payload.sourceLabel || 'Monitoring');
    const isArchiveView = sourceLabel === 'Archive';
    const referenceSource = toText(item.requestSource);
    const sourceReference = toText(item.sourceReference);
    const itemList = splitProcurementItemSummary(item.itemSummary);
    const editor = procurementEditor || buildProcurementEditorState(item, user, sourceLabel);
    const purchaseReferenceMeta = procurementPurchaseReferenceMeta(editor.purchaseMode);
    const roleFlags = getProcurementRoleFlags(user);

    return (
      <div className="proc-detail-shell">
        <section className="proc-detail-main">
          <div className="proc-detail-requestor-row">
            <div className="proc-detail-requestor-block">
              <span className="proc-detail-requestor-label">Requestor</span>
              <div className="proc-detail-requestor-name">{toText(item.requestorName)}</div>
            </div>
            <div className="proc-detail-reference-card">
              <span>Reference ({referenceSource})</span>
              <strong>{sourceReference}</strong>
            </div>
          </div>

          <article className="proc-detail-item-panel">
            <div className="proc-detail-item-head">
              <span className="material-icons">inventory_2</span>
              <strong>ITEM REQUESTED</strong>
            </div>
            <div className="proc-detail-item-body">
              <ul>
                {(itemList.length ? itemList : [toText(item.itemSummary)]).map((entry, index) => (
                  <li key={`proc-item-${index}`}>{entry}</li>
                ))}
              </ul>
            </div>
          </article>

          <div className="proc-detail-note-box">
            <strong>Raw Note:</strong> {toText(item.notes)}
          </div>

          {isArchiveView ? (
            <div className="proc-detail-archive-alert">
              Archived request record. Activity history remains available for audit and historical reference.
            </div>
          ) : (
            <div className="proc-detail-update-card">
              <label className="proc-detail-field">
                <span>REVISED ITEM CATEGORY</span>
                <input
                  className="proc-detail-control"
                  disabled={!editor.canEditData || editor.saving}
                  onChange={(event) => updateProcurementEditor({ itemSummary: event.target.value })}
                  type="text"
                  value={editor.itemSummary}
                />
              </label>

              <div className="proc-detail-form-grid">
                <label className="proc-detail-field">
                  <span>FULFILLMENT</span>
                  <select
                    className="proc-detail-control"
                    disabled={!editor.canEditData || editor.saving}
                    onChange={(event) =>
                      updateProcurementEditor({
                        fulfillmentBase: event.target.value === 'Purchase' ? 'Purchase' : 'Stock',
                        purchaseMode: event.target.value === 'Purchase' ? editor.purchaseMode : 'PO',
                        purchaseReference: event.target.value === 'Purchase' ? editor.purchaseReference : ''
                      })
                    }
                    value={editor.fulfillmentBase}
                  >
                    <option value="Stock">Existing Stock</option>
                    <option value="Purchase">Purchase</option>
                  </select>
                </label>

                {editor.fulfillmentBase === 'Purchase' ? (
                  <label className="proc-detail-field">
                    <span>PURCHASE VIA</span>
                    <select
                      className="proc-detail-control"
                      disabled={!editor.canEditData || editor.saving}
                      onChange={(event) =>
                        updateProcurementEditor({
                          purchaseMode: event.target.value === 'E-Commerce' ? 'E-Commerce' : 'PO'
                        })
                      }
                      value={editor.purchaseMode}
                    >
                      <option value="PO">PO</option>
                      <option value="E-Commerce">E-Commerce</option>
                    </select>
                  </label>
                ) : null}

                {editor.fulfillmentBase === 'Purchase' ? (
                  <label className="proc-detail-field">
                    <span>{purchaseReferenceMeta.label.toUpperCase()}</span>
                    <input
                      className="proc-detail-control"
                      disabled={!editor.canEditPO || editor.saving}
                      onChange={(event) => updateProcurementEditor({ purchaseReference: event.target.value })}
                      placeholder={purchaseReferenceMeta.placeholder}
                      type="text"
                      value={editor.purchaseReference}
                    />
                  </label>
                ) : null}
              </div>

              <label className="proc-detail-field">
                <span>STATUS UPDATE</span>
                <select
                  className="proc-detail-control"
                  disabled={!editor.canUpdateStatus || editor.saving}
                  onChange={(event) => {
                    const nextStatus = event.target.value;
                    const shouldForcePurchase = normalizeAtlasToken(nextStatus) === 'poissued' && roleFlags.isSuperAdmin && editor.canEditData;
                    updateProcurementEditor({
                      status: nextStatus,
                      fulfillmentBase: shouldForcePurchase ? 'Purchase' : editor.fulfillmentBase,
                      purchaseMode: shouldForcePurchase ? 'PO' : editor.purchaseMode
                    });
                  }}
                  value={editor.status}
                >
                  {PROCUREMENT_STATUS_FLOW.map((status) => (
                    <option
                      disabled={isProcurementStatusOptionDisabled(status, toText(item.status), user)}
                      key={status}
                      value={status}
                    >
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              <label className="proc-detail-field danger">
                <span>ADD STATUS REMARK *</span>
                <textarea
                  className="proc-detail-control proc-detail-remark"
                  disabled={!editor.canUpdateStatus || editor.saving}
                  onChange={(event) => updateProcurementEditor({ remark: event.target.value })}
                  onPaste={handleProcurementEvidencePaste}
                  placeholder="Enter status update details..."
                  rows={3}
                  value={editor.remark}
                />
              </label>

              <div className="proc-detail-field">
                <span>EVIDENCE (OPTIONAL)</span>
                <div
                  className={`proc-detail-evidence-zone ${!editor.canUpdateStatus ? 'is-disabled' : ''}`.trim()}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDrop={handleProcurementEvidenceDrop}
                  onPaste={handleProcurementEvidencePaste}
                >
                  <div className="proc-detail-evidence-head">
                    <div>
                      <strong>Paste</strong> (Ctrl+V) / <strong>Drag &amp; Drop</strong> / <strong>Upload</strong> image
                      <small>Optional for all status. Max 3 images, 2MB each.</small>
                    </div>
                    <div className="proc-detail-evidence-actions">
                      <span className="proc-detail-counter">{editor.evidence.length}/3</span>
                      <button
                        className="proc-detail-upload-btn"
                        disabled={!editor.canUpdateStatus || editor.saving}
                        onClick={() => procurementEvidenceInputRef.current?.click()}
                        type="button"
                      >
                        <span className="material-icons">file_upload</span>
                        Upload
                      </button>
                      <input
                        accept="image/*"
                        className="proc-detail-upload-input"
                        multiple
                        onChange={handleProcurementEvidenceInput}
                        ref={procurementEvidenceInputRef}
                        type="file"
                      />
                    </div>
                  </div>
                  {editor.evidence.length ? (
                    <div className="proc-detail-evidence-preview">
                      {editor.evidence.map((evidence, index) => (
                        <div className="proc-detail-evidence-card" key={`${evidence.name}-${index}`}>
                          <button
                            className="proc-detail-evidence-zoom"
                            onClick={() => setProcurementEvidencePreview({ src: evidence.dataUrl, name: evidence.name })}
                            title={`Preview ${evidence.name}`}
                            type="button"
                          >
                            <img alt={evidence.name} src={evidence.dataUrl} />
                          </button>
                          <div className="proc-detail-evidence-meta">
                            <small title={evidence.name}>{evidence.name}</small>
                            <button
                              disabled={!editor.canUpdateStatus || editor.saving}
                              onClick={() => removeProcurementEvidence(index)}
                              type="button"
                            >
                              <span className="material-icons">close</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="proc-detail-evidence-empty">No evidence attached (optional).</div>
                  )}
                </div>
              </div>

              {procurementUpdateMessage ? (
                <div className={`proc-detail-update-message ${procurementUpdateMessage.kind}`}>{procurementUpdateMessage.text}</div>
              ) : null}

              <button
                className="proc-detail-save-btn"
                disabled={!editor.canUpdateStatus || editor.saving}
                onClick={() => void handleProcurementSave()}
                type="button"
              >
                {editor.saving ? 'SAVING...' : 'SAVE CHANGES & UPDATES'}
              </button>
              {!editor.canUpdateStatus ? (
                <div className="proc-detail-readonly-note">
                  This request is currently read-only for your role.
                </div>
              ) : null}
              {editor.canEditPO === false && editor.fulfillmentBase === 'Purchase' ? (
                <div className="proc-detail-readonly-note">
                  PO / invoice reference can only be edited by Procurement or Super Admin.
                </div>
              ) : null}
            </div>
          )}
        </section>

        <aside className="proc-detail-history">
          <div className="proc-detail-history-panel">
            <div className="proc-detail-history-head">
              <span className="material-icons">history</span>
              <strong>ACTIVITY HISTORY</strong>
            </div>

            {activities.length ? (
              <div className="proc-activity-list">
                {activities.map((activity, index) => {
                  const tone = getProcurementStatusTone(activity.status);
                  const icon = getProcurementActivityIcon(activity);

                  return (
                    <div className={`proc-activity-item tone-${tone}`} key={`proc-act-${index}`}>
                      <div className="proc-activity-rail">
                        <span className="proc-activity-dot" />
                      </div>
                      <div className="proc-activity-content">
                        <div className="proc-activity-head">
                          <span className={`proc-activity-badge tone-${tone}`}>{activity.status}</span>
                          <small>{activity.timestamp}</small>
                        </div>
                        <div className="proc-activity-card">
                          <div className="proc-activity-user">
                            <span className={`material-icons ${activity.kind === 'system' ? 'system' : ''}`}>{icon}</span>
                            <strong>{activity.user}</strong>
                          </div>
                          <div className="proc-activity-message">
                            {renderProcurementMessageWithEvidenceTokens(activity.message, setProcurementEvidencePreview)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="atlas-detail-empty">No activity history recorded.</div>
            )}
          </div>
        </aside>
      </div>
    );
  }

  function renderSimpleRecordDetailContent(kind: 'catalog' | 'reference', item: Record<string, unknown>) {
    if (kind === 'catalog') {
      return (
        <div className="assetd-shell">
          <div className="assetd-card assetd-span-12">
            <div className="assetd-card-h">
              <div className="ttl">
                <span className="material-icons">memory</span>
                Catalog Model Specification
              </div>
              <div className="assetd-small">Master Katalog</div>
            </div>
            <div className="assetd-card-b">
              <div className="assetd-kv">
                <div className="assetd-f w8">
                  <div className="assetd-lbl">Item Model</div>
                  <div className="assetd-val">{toText(item.sku || item.itemModel)}</div>
                </div>
                <div className="assetd-f">
                  <div className="assetd-lbl">Category</div>
                  <div className="assetd-val">{toText(item.category)}</div>
                </div>
                <div className="assetd-f w6">
                  <div className="assetd-lbl">Account</div>
                  <div className="assetd-val">{toText(item.account)}</div>
                </div>
                <div className="assetd-f w6">
                  <div className="assetd-lbl">Estimated Price</div>
                  <div className="assetd-val">{formatCatalogPrice(item.estimatedPrice)}</div>
                </div>
                <div className="assetd-f w12">
                  <div className="assetd-lbl">Technical Specification / BOM</div>
                  <div className="assetd-val assetd-val-muted assetd-prewrap">{toText(item.specification)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (toText(item.mode) === 'sourceLockedNotice') {
      return (
        <section className="atlas-detail-card master-reference-notice-card">
          <div className="atlas-detail-card-head">
            <div>
              <h3>{toText(item.actionLabel || 'Master Reference Source')}</h3>
              <p>Organization Structure is sourced from Employee Database and kept aligned with Google Workspace.</p>
            </div>
          </div>
          <div className="atlas-detail-grid compact">
            <div className="atlas-detail-field wide">
              <span>Source Of Truth</span>
              <strong>{toText(item.source)}</strong>
            </div>
            {toText(item.targetLabel) ? (
              <div className="atlas-detail-field wide">
                <span>Requested Target</span>
                <strong>{toText(item.targetLabel)}</strong>
              </div>
            ) : null}
            <div className="atlas-detail-field wide">
              <span>Sync Policy</span>
              <strong>{toText(item.syncPolicy)}</strong>
            </div>
            <div className="atlas-detail-field wide">
              <span>How To Change It</span>
              <strong>{toText(item.guidance)}</strong>
            </div>
          </div>
        </section>
      );
    }

    const entries = Object.entries(item || {}).filter(([, value]) => value !== null && value !== undefined && value !== '');
    return (
      <section className="atlas-detail-card">
        <div className="atlas-detail-card-head">
          <div>
            <h3>Reference Detail</h3>
            <p>Production data for reference and tracking.</p>
          </div>
        </div>
        <div className="atlas-detail-grid">
          {entries.map(([key, value]) => (
            <div className="atlas-detail-field" key={key}>
              <span>{key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())}</span>
              <strong>{typeof value === 'object' ? JSON.stringify(value) : toText(value)}</strong>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderDetailModal() {
    if (!detailModal) return null;

    let body: ReactNode = null;
    const isProcurementDetail = detailModal.kind === 'procurement';
    const isHandoverDetail = detailModal.kind === 'handover';
    const isAssetFamilyDetail =
      detailModal.kind === 'asset' ||
      detailModal.kind === 'employee' ||
      detailModal.kind === 'catalog';
    const isCatalogDetail = detailModal.kind === 'catalog';
    const detailRoleLabel = isProcurementDetail ? getPrimaryRoleLabel(user) : '';
    const detailIcon =
      detailModal.kind === 'asset'
        ? 'inventory_2'
        : detailModal.kind === 'employee'
          ? 'badge'
          : detailModal.kind === 'catalog'
            ? 'info'
            : detailModal.kind === 'handover'
              ? ''
              : detailModal.kind === 'reference'
                ? 'dataset'
                : '';

    if (detailModal.loading) {
      body = <div className="atlas-detail-empty">Loading detail data...</div>;
    } else if (detailModal.error) {
      body = <div className="atlas-detail-empty error">{detailModal.error}</div>;
    } else if (!detailModal.data) {
      body = <div className="atlas-detail-empty">No detail data is available.</div>;
    } else if (detailModal.kind === 'asset') {
      body = renderAssetDetailContent(detailModal.data as AssetDetailResponse);
    } else if (detailModal.kind === 'employee') {
      body = renderEmployeeDetailContent(
        detailModal.data as {
          detail: EmployeeDirectoryDetailResponse;
          history: EmployeeDirectoryHistoryResponse | null;
        }
      );
    } else if (detailModal.kind === 'handover') {
      body = renderHandoverDetailContent(detailModal.data as HandoverDetailResponse);
    } else if (detailModal.kind === 'procurement') {
      body = renderProcurementDetailContent(
        detailModal.data as {
          item: ProcurementRow;
          activities: ProcurementActivity[];
          sourceLabel?: string;
        }
      );
    } else if (detailModal.kind === 'catalog' || detailModal.kind === 'reference') {
      body = renderSimpleRecordDetailContent(
        detailModal.kind,
        detailModal.data as Record<string, unknown>
      );
    }

    return (
      <>
        <div
          className="atlas-detail-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeDetailModal();
            }
          }}
        >
          <div
            className={`atlas-detail-dialog ${isProcurementDetail ? 'proc-detail-dialog' : ''} ${isAssetFamilyDetail ? 'assetd-detail-dialog' : ''} ${isCatalogDetail ? 'assetd-catalog-dialog' : ''} ${isHandoverDetail ? 'handover-detail-dialog' : ''}`.trim()}
            role="dialog"
            aria-modal="true"
          >
            <div
              className={`atlas-detail-topbar ${isProcurementDetail ? 'proc-detail-topbar' : ''} ${isAssetFamilyDetail ? 'assetd-detail-topbar' : ''} ${isHandoverDetail ? 'handover-detail-topbar' : ''}`.trim()}
            >
              <div>
                <div className={`atlas-detail-title ${isProcurementDetail ? 'proc-detail-title-row' : ''}`.trim()}>
                  {detailIcon ? <span className="material-icons assetd-modal-icon">{detailIcon}</span> : null}
                  <span>{detailModal.title}</span>
                  {isProcurementDetail ? <span className="proc-detail-role-badge">[Role: {detailRoleLabel}]</span> : null}
                </div>
                {detailModal.subtitle && !isAssetFamilyDetail && !isHandoverDetail ? <div className="atlas-detail-subtitle">{detailModal.subtitle}</div> : null}
              </div>
              <button className="atlas-detail-close" onClick={closeDetailModal} type="button">
                <span className="material-icons">close</span>
              </button>
            </div>
            <div
              className={`atlas-detail-content ${isProcurementDetail ? 'proc-detail-content' : ''} ${isAssetFamilyDetail ? 'assetd-detail-content' : ''} ${isCatalogDetail ? 'assetd-catalog-content' : ''} ${isHandoverDetail ? 'handover-detail-content' : ''}`.trim()}
            >
              {body}
            </div>
          </div>
        </div>
        {procurementEvidencePreview ? (
          <div
            className="atlas-image-preview-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeProcurementEvidencePreview();
              }
            }}
          >
            <div className="atlas-image-preview-dialog" role="dialog" aria-modal="true" aria-label={procurementEvidencePreview.name}>
              <button className="atlas-image-preview-close" onClick={closeProcurementEvidencePreview} type="button">
                <span className="material-icons">close</span>
              </button>
              <div className="atlas-image-preview-frame">
                <img alt={procurementEvidencePreview.name} src={procurementEvidencePreview.src} />
              </div>
              <div className="atlas-image-preview-caption">{procurementEvidencePreview.name}</div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  function renderAssetActionModals() {
    return (
      <>
        {assetCreator ? (
          <div
            className="atlas-detail-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeAssetCreator();
            }}
          >
            <div className="asset-action-dialog wide" role="dialog" aria-modal="true">
              <div className="asset-action-topbar">
                <div>
                  <div className="asset-action-title">Create Asset</div>
                  <div className="asset-action-subtitle">Manual asset entry</div>
                </div>
                <button className="atlas-detail-close" onClick={closeAssetCreator} type="button">
                  <span className="material-icons">close</span>
                </button>
              </div>
              <form className="asset-action-form" onSubmit={(event) => void submitAssetCreate(event)}>
                <div className="asset-action-grid three">
                  <label className="asset-action-field">
                    <span>Asset Tag *</span>
                    <input
                      onChange={(event) => updateAssetCreatorField('assetTag', event.target.value)}
                      placeholder="e.g. ATINB-00001"
                      value={assetCreator.assetTag}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Serial Number</span>
                    <input
                      onChange={(event) => updateAssetCreatorField('serialNumber', event.target.value)}
                      value={assetCreator.serialNumber}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Status</span>
                    <select
                      onChange={(event) => updateAssetCreatorField('status', event.target.value)}
                      value={assetCreator.status}
                    >
                      <option>Available</option>
                      <option>In Use</option>
                      <option>Assigned</option>
                      <option>Partially Assigned</option>
                      <option>Out of Stock</option>
                      <option>Broken</option>
                      <option>Disposed</option>
                      <option>Unknown</option>
                    </select>
                  </label>
                  <label className="asset-action-field asset-action-field-span2">
                    <span>Item Model *</span>
                    <input
                      onChange={(event) => updateAssetCreatorField('itemModel', event.target.value)}
                      placeholder="e.g. Lenovo ThinkPad E14 Gen 4"
                      value={assetCreator.itemModel}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Category *</span>
                    <input
                      onChange={(event) => updateAssetCreatorField('category', event.target.value)}
                      placeholder="e.g. Notebook"
                      value={assetCreator.category}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Initial Quantity</span>
                    <input
                      min="1"
                      onChange={(event) => updateAssetCreatorField('initialQuantity', event.target.value)}
                      type="number"
                      value={assetCreator.initialQuantity}
                    />
                  </label>
                  <label className="asset-action-field asset-action-field-span2">
                    <span>Location</span>
                    <input
                      onChange={(event) => updateAssetCreatorField('location', event.target.value)}
                      value={assetCreator.location}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Vendor</span>
                    <input
                      onChange={(event) => updateAssetCreatorField('vendorName', event.target.value)}
                      value={assetCreator.vendorName}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>PO Number</span>
                    <input
                      onChange={(event) => updateAssetCreatorField('orderNumber', event.target.value)}
                      value={assetCreator.orderNumber}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Invoice</span>
                    <input
                      onChange={(event) => updateAssetCreatorField('invoiceNumber', event.target.value)}
                      value={assetCreator.invoiceNumber}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Purchase Date</span>
                    <input
                      onChange={(event) => updateAssetCreatorField('purchaseDate', event.target.value)}
                      type="date"
                      value={assetCreator.purchaseDate}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Purchasing Year</span>
                    <input
                      onChange={(event) => updateAssetCreatorField('purchasingYear', event.target.value)}
                      value={assetCreator.purchasingYear}
                    />
                  </label>
                </div>

                <div className="asset-action-section">
                  <div className="asset-action-section-title">Ownership</div>
                  <div className="asset-action-grid">
                    <label className="asset-action-field">
                      <span>Owner Account</span>
                      <input
                        onChange={(event) => updateAssetCreatorField('ownerAccount', event.target.value)}
                        value={assetCreator.ownerAccount}
                      />
                    </label>
                    <label className="asset-action-field">
                      <span>Owner Dept</span>
                      <input
                        onChange={(event) => updateAssetCreatorField('ownerDepartment', event.target.value)}
                        value={assetCreator.ownerDepartment}
                      />
                    </label>
                  </div>
                </div>

                <div className="asset-action-section">
                  <div className="asset-action-section-title">Assignment</div>
                  <div className="asset-action-mode-row">
                    <button
                      className={`asset-mode-btn ${assetCreator.assignmentMode === 'individual' ? 'active' : ''}`.trim()}
                      onClick={() => updateAssetCreatorField('assignmentMode', 'individual')}
                      type="button"
                    >
                      Individual
                    </button>
                    <button
                      className={`asset-mode-btn ${assetCreator.assignmentMode === 'sharing' ? 'active' : ''}`.trim()}
                      onClick={() => updateAssetCreatorField('assignmentMode', 'sharing')}
                      type="button"
                    >
                      Sharing
                    </button>
                  </div>

                  {assetCreator.assignmentMode === 'individual' ? (
                    <div className="asset-action-grid">
                      <label className="asset-action-field asset-action-field-span2">
                        <span>Assigned To</span>
                        <input
                          onChange={(event) => updateAssetCreatorField('assignedToText', event.target.value)}
                          placeholder="Employee name / NIK"
                          value={assetCreator.assignedToText}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="asset-action-grid">
                      <label className="asset-action-field">
                        <span>Assigned Account</span>
                        <input
                          onChange={(event) => updateAssetCreatorField('assignedAccount', event.target.value)}
                          value={assetCreator.assignedAccount}
                        />
                      </label>
                      <label className="asset-action-field">
                        <span>Assigned Dept</span>
                        <input
                          onChange={(event) => updateAssetCreatorField('assignedDept', event.target.value)}
                          value={assetCreator.assignedDept}
                        />
                      </label>
                    </div>
                  )}
                </div>

                {assetCreator.message ? (
                  <div className={`asset-action-message ${assetCreator.message.kind}`}>{assetCreator.message.text}</div>
                ) : null}
                <div className="asset-action-footer">
                  <button className="atlas-toolbar-btn subtle" onClick={closeAssetCreator} type="button">
                    Cancel
                  </button>
                  <button className="asset-action-primary-btn" disabled={assetCreator.saving} type="submit">
                    {assetCreator.saving ? 'Creating...' : 'Create Asset'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {assetQtyEditor ? (
          <div
            className="atlas-detail-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeAssetQtyEditor();
            }}
          >
            <div className="asset-action-dialog" role="dialog" aria-modal="true">
              <div className="asset-action-topbar">
                <div>
                  <div className="asset-action-title">Adjust Quantity</div>
                  <div className="asset-action-subtitle">{assetQtyEditor.assetTag}</div>
                </div>
                <button className="atlas-detail-close" onClick={closeAssetQtyEditor} type="button">
                  <span className="material-icons">close</span>
                </button>
              </div>
              <form className="asset-action-form" onSubmit={(event) => void submitAssetQtyAdjustment(event)}>
                <div className="asset-action-grid compact">
                  <label className="asset-action-field">
                    <span>Current Qty</span>
                    <input disabled value={assetQtyEditor.currentQty} />
                  </label>
                  <label className="asset-action-field">
                    <span>Qty Delta</span>
                    <input
                      onChange={(event) => setAssetQtyEditor((current) => current ? { ...current, delta: event.target.value } : current)}
                      placeholder="ex: +2 or -1"
                      value={assetQtyEditor.delta}
                    />
                  </label>
                </div>
                <label className="asset-action-field">
                  <span>Remark</span>
                  <textarea
                    onChange={(event) => setAssetQtyEditor((current) => current ? { ...current, remark: event.target.value } : current)}
                    placeholder="Stock opname, received shipment, replacement, broken unit, etc."
                    rows={4}
                    value={assetQtyEditor.remark}
                  />
                </label>
                {assetQtyEditor.message ? (
                  <div className={`asset-action-message ${assetQtyEditor.message.kind}`}>{assetQtyEditor.message.text}</div>
                ) : null}
                <div className="asset-action-footer">
                  <button className="atlas-toolbar-btn subtle" onClick={closeAssetQtyEditor} type="button">
                    Cancel
                  </button>
                  <button className="asset-action-primary-btn" disabled={assetQtyEditor.saving} type="submit">
                    {assetQtyEditor.saving ? 'Saving...' : 'Save Quantity Update'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {assetEditor ? (
          <div
            className="atlas-detail-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeAssetEditor();
            }}
          >
            <div className="asset-action-dialog wide" role="dialog" aria-modal="true">
              <div className="asset-action-topbar">
                <div>
                  <div className="asset-action-title">Edit Asset</div>
                  <div className="asset-action-subtitle">{assetEditor.originalTag}</div>
                </div>
                <button className="atlas-detail-close" onClick={closeAssetEditor} type="button">
                  <span className="material-icons">close</span>
                </button>
              </div>
              <form className="asset-action-form" onSubmit={(event) => void submitAssetEdit(event)}>
                <div className="asset-action-grid three">
                  <label className="asset-action-field">
                    <span>Asset Tag</span>
                    <input
                      onChange={(event) => updateAssetEditorField('assetTag', event.target.value)}
                      value={assetEditor.assetTag}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Serial Number</span>
                    <input
                      onChange={(event) => updateAssetEditorField('serialNumber', event.target.value)}
                      value={assetEditor.serialNumber}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Status</span>
                    <select
                      onChange={(event) => updateAssetEditorField('status', event.target.value)}
                      value={assetEditor.status}
                    >
                      <option>Available</option>
                      <option>In Use</option>
                      <option>Assigned</option>
                      <option>Partially Assigned</option>
                      <option>Out of Stock</option>
                      <option>Broken</option>
                      <option>Disposed</option>
                      <option>Unknown</option>
                    </select>
                  </label>
                  <label className="asset-action-field asset-action-field-span2">
                    <span>Item Model</span>
                    <input
                      onChange={(event) => updateAssetEditorField('itemModel', event.target.value)}
                      value={assetEditor.itemModel}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Category</span>
                    <input
                      onChange={(event) => updateAssetEditorField('category', event.target.value)}
                      value={assetEditor.category}
                    />
                  </label>
                  <label className="asset-action-field asset-action-field-span2">
                    <span>Location</span>
                    <input
                      onChange={(event) => updateAssetEditorField('location', event.target.value)}
                      value={assetEditor.location}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Vendor</span>
                    <input
                      onChange={(event) => updateAssetEditorField('vendorName', event.target.value)}
                      value={assetEditor.vendorName}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>PO Number</span>
                    <input
                      onChange={(event) => updateAssetEditorField('orderNumber', event.target.value)}
                      value={assetEditor.orderNumber}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Invoice</span>
                    <input
                      onChange={(event) => updateAssetEditorField('invoiceNumber', event.target.value)}
                      value={assetEditor.invoiceNumber}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Purchase Date</span>
                    <input
                      onChange={(event) => updateAssetEditorField('purchaseDate', event.target.value)}
                      type="date"
                      value={assetEditor.purchaseDate}
                    />
                  </label>
                  <label className="asset-action-field">
                    <span>Purchasing Year</span>
                    <input
                      onChange={(event) => updateAssetEditorField('purchasingYear', event.target.value)}
                      value={assetEditor.purchasingYear}
                    />
                  </label>
                </div>

                <div className="asset-action-section">
                  <div className="asset-action-section-title">Ownership</div>
                  <div className="asset-action-grid">
                    <label className="asset-action-field">
                      <span>Owner Account</span>
                      <input
                        onChange={(event) => updateAssetEditorField('ownerAccount', event.target.value)}
                        value={assetEditor.ownerAccount}
                      />
                    </label>
                    <label className="asset-action-field">
                      <span>Owner Dept</span>
                      <input
                        onChange={(event) => updateAssetEditorField('ownerDepartment', event.target.value)}
                        value={assetEditor.ownerDepartment}
                      />
                    </label>
                  </div>
                </div>

                <div className="asset-action-section">
                  <div className="asset-action-section-title">Assignment</div>
                  <div className="asset-action-mode-row">
                    <button
                      className={`asset-mode-btn ${assetEditor.assignmentMode === 'individual' ? 'active' : ''}`.trim()}
                      onClick={() => updateAssetEditorField('assignmentMode', 'individual')}
                      type="button"
                    >
                      Individual
                    </button>
                    <button
                      className={`asset-mode-btn ${assetEditor.assignmentMode === 'sharing' ? 'active' : ''}`.trim()}
                      onClick={() => updateAssetEditorField('assignmentMode', 'sharing')}
                      type="button"
                    >
                      Sharing
                    </button>
                  </div>

                  {assetEditor.assignmentMode === 'individual' ? (
                    <div className="asset-action-grid">
                      <label className="asset-action-field asset-action-field-span2">
                        <span>Assigned To</span>
                        <input
                          onChange={(event) => updateAssetEditorField('assignedToText', event.target.value)}
                          placeholder="Employee name / NIK"
                          value={assetEditor.assignedToText}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="asset-action-grid">
                      <label className="asset-action-field">
                        <span>Assigned Account</span>
                        <input
                          onChange={(event) => updateAssetEditorField('assignedAccount', event.target.value)}
                          value={assetEditor.assignedAccount}
                        />
                      </label>
                      <label className="asset-action-field">
                        <span>Assigned Dept</span>
                        <input
                          onChange={(event) => updateAssetEditorField('assignedDept', event.target.value)}
                          value={assetEditor.assignedDept}
                        />
                      </label>
                    </div>
                  )}
                </div>

                {assetEditor.message ? (
                  <div className={`asset-action-message ${assetEditor.message.kind}`}>{assetEditor.message.text}</div>
                ) : null}
                <div className="asset-action-footer">
                  <button className="atlas-toolbar-btn subtle" onClick={closeAssetEditor} type="button">
                    Cancel
                  </button>
                  <button className="asset-action-primary-btn" disabled={assetEditor.saving} type="submit">
                    {assetEditor.saving ? 'Saving...' : 'Save Asset Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {assetDeleteState ? (
          <div
            className="atlas-detail-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeAssetDeleteState();
            }}
          >
            <div className="asset-action-dialog narrow" role="dialog" aria-modal="true">
              <div className="asset-action-topbar">
                <div>
                  <div className="asset-action-title">Delete Asset</div>
                  <div className="asset-action-subtitle">{assetDeleteState.assetTag}</div>
                </div>
                <button className="atlas-detail-close" onClick={closeAssetDeleteState} type="button">
                  <span className="material-icons">close</span>
                </button>
              </div>
              <div className="asset-action-form">
                <p className="asset-delete-copy">
                  This will permanently remove <strong>{assetDeleteState.assetTag}</strong> from the asset list.
                </p>
                <p className="asset-delete-copy muted">Item Model: {assetDeleteState.itemModel}</p>
                {assetDeleteState.message ? (
                  <div className={`asset-action-message ${assetDeleteState.message.kind}`}>{assetDeleteState.message.text}</div>
                ) : null}
                <div className="asset-action-footer">
                  <button className="atlas-toolbar-btn subtle" onClick={closeAssetDeleteState} type="button">
                    Cancel
                  </button>
                  <button className="asset-danger-btn" disabled={assetDeleteState.deleting} onClick={() => void submitAssetDelete()} type="button">
                    {assetDeleteState.deleting ? 'Deleting...' : 'Delete Asset'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  function renderCatalogActionModals() {
    const categoryOptions = Array.isArray(moduleData?.catalog?.categories)
      ? moduleData?.catalog?.categories.map((entry) => toText(entry.name)).filter((value) => value !== '-')
      : [];
    const accountOptions = Array.isArray(moduleData?.catalog?.accountOptions)
      ? moduleData?.catalog?.accountOptions.filter(Boolean)
      : [];

    return (
      <>
        {catalogCategoryEditor ? (
          <div
            className="atlas-detail-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeCatalogCategoryEditor();
            }}
          >
            <div className="catalog-action-dialog" role="dialog" aria-modal="true">
              <div className="catalog-action-topbar">
                <div>
                  <div className="catalog-action-title">Add Category</div>
                  <div className="catalog-action-subtitle">Create new parent category for catalog grouping.</div>
                </div>
                <button className="atlas-detail-close" onClick={closeCatalogCategoryEditor} type="button">
                  <span className="material-icons">close</span>
                </button>
              </div>
              <form className="catalog-action-form" onSubmit={(event) => void submitCatalogCategory(event)}>
                <label className="catalog-action-field">
                  <span>Category Name</span>
                  <input
                    onChange={(event) => setCatalogCategoryEditor((current) => current ? { ...current, name: event.target.value } : current)}
                    placeholder="e.g. OFFICE EQUIPMENT"
                    value={catalogCategoryEditor.name}
                  />
                </label>
                {catalogCategoryEditor.message ? (
                  <div className={`asset-action-message ${catalogCategoryEditor.message.kind}`}>{catalogCategoryEditor.message.text}</div>
                ) : null}
                <div className="asset-action-footer">
                  <button className="atlas-toolbar-btn subtle" onClick={closeCatalogCategoryEditor} type="button">
                    Cancel
                  </button>
                  <button className="catalog-primary-btn info" disabled={catalogCategoryEditor.saving} type="submit">
                    {catalogCategoryEditor.saving ? 'Saving...' : 'Create Category'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {catalogSkuEditor ? (
          <div
            className="atlas-detail-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeCatalogSkuEditor();
            }}
          >
            <div className="catalog-action-dialog" role="dialog" aria-modal="true">
              <div className="catalog-action-topbar">
                <div>
                  <div className="catalog-action-title">{catalogSkuEditor.mode === 'edit' ? 'Edit SKU' : 'Add New SKU'}</div>
                  <div className="catalog-action-subtitle">
                    {catalogSkuEditor.mode === 'edit' ? catalogSkuEditor.originalSku : 'Register new catalog keyword / SKU.'}
                  </div>
                </div>
                <button className="atlas-detail-close" onClick={closeCatalogSkuEditor} type="button">
                  <span className="material-icons">close</span>
                </button>
              </div>
              <form className="catalog-action-form" onSubmit={(event) => void submitCatalogSku(event)}>
                <label className="catalog-action-field">
                  <span>Category (Parent)</span>
                  <select
                    onChange={(event) => setCatalogSkuEditor((current) => current ? { ...current, category: event.target.value } : current)}
                    value={catalogSkuEditor.category}
                  >
                    <option value="">Select category</option>
                    {categoryOptions.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                  <small>Select the parent category for this SKU.</small>
                </label>

                <label className="catalog-action-field">
                  <span>Item Name / SKU</span>
                  <input
                    onChange={(event) => setCatalogSkuEditor((current) => current ? { ...current, sku: event.target.value } : current)}
                    placeholder="e.g. PC i5 Gen 12"
                    value={catalogSkuEditor.sku}
                  />
                  <small>Name used by the system as keyword during request parsing.</small>
                </label>

                <label className="catalog-action-field">
                  <span>Account</span>
                  <select
                    onChange={(event) => setCatalogSkuEditor((current) => current ? { ...current, account: event.target.value } : current)}
                    value={catalogSkuEditor.account}
                  >
                    <option value="">General</option>
                    {accountOptions.map((account) => (
                      <option key={account} value={account}>{account}</option>
                    ))}
                  </select>
                </label>

                <label className="catalog-action-field">
                  <span>Technical Spec (BOM)</span>
                  <textarea
                    onChange={(event) => setCatalogSkuEditor((current) => current ? { ...current, specification: event.target.value } : current)}
                    placeholder="e.g. i5 Gen 12, RAM 16GB, SSD 512..."
                    rows={3}
                    value={catalogSkuEditor.specification}
                  />
                </label>

                <label className="catalog-action-field">
                  <span>Est. Price</span>
                  <input
                    inputMode="numeric"
                    onChange={(event) => setCatalogSkuEditor((current) => current ? { ...current, estimatedPrice: event.target.value } : current)}
                    placeholder="Input number only"
                    value={catalogSkuEditor.estimatedPrice}
                  />
                  <small>Input angka saja. Sistem akan simpan sebagai numeric value.</small>
                </label>

                {catalogSkuEditor.message ? (
                  <div className={`asset-action-message ${catalogSkuEditor.message.kind}`}>{catalogSkuEditor.message.text}</div>
                ) : null}
                <div className="asset-action-footer">
                  <button className="atlas-toolbar-btn subtle" onClick={closeCatalogSkuEditor} type="button">
                    Cancel
                  </button>
                  <button className="catalog-primary-btn navy" disabled={catalogSkuEditor.saving} type="submit">
                    {catalogSkuEditor.saving ? 'Saving...' : 'Save To Master Data'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {catalogDeleteState ? (
          <div
            className="atlas-detail-overlay"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeCatalogDeleteState();
            }}
          >
            <div className="catalog-action-dialog narrow" role="dialog" aria-modal="true">
              <div className="catalog-action-topbar">
                <div>
                  <div className="catalog-action-title">
                    {catalogDeleteState.kind === 'category' ? 'Delete Category' : 'Delete SKU'}
                  </div>
                  <div className="catalog-action-subtitle">{catalogDeleteState.targetName}</div>
                </div>
                <button className="atlas-detail-close" onClick={closeCatalogDeleteState} type="button">
                  <span className="material-icons">close</span>
                </button>
              </div>
              <div className="catalog-action-form">
                <p className="asset-delete-copy">{catalogDeleteState.subtitle}</p>
                {catalogDeleteState.message ? (
                  <div className={`asset-action-message ${catalogDeleteState.message.kind}`}>{catalogDeleteState.message.text}</div>
                ) : null}
                <div className="asset-action-footer">
                  <button className="atlas-toolbar-btn subtle" onClick={closeCatalogDeleteState} type="button">
                    Cancel
                  </button>
                  <button className="asset-danger-btn" disabled={catalogDeleteState.deleting} onClick={() => void submitCatalogDelete()} type="button">
                    {catalogDeleteState.deleting ? 'Deleting...' : 'Proceed Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  function renderCatalogModule(itemsRaw: Array<Record<string, unknown>>) {
    const items = itemsRaw.map((item) => coerceCatalogManagerItem(item));
    const searchToken = search.trim().toLowerCase();
    const allCategories = Array.isArray(moduleData?.catalog?.categories)
      ? moduleData?.catalog?.categories.map((entry) => toText(entry.name)).filter((value) => value !== '-')
      : [...new Set(items.map((item) => item.category).filter((value) => value !== '-'))].sort((left, right) => left.localeCompare(right));

    const groups = allCategories
      .map((category) => {
        const groupedItems = items.filter((item) => item.category.toLowerCase() === category.toLowerCase());
        const categoryMatches = searchToken ? category.toLowerCase().includes(searchToken) : true;
        return {
          category,
          items: groupedItems,
          isVisible: !searchToken || categoryMatches || groupedItems.length > 0
        };
      })
      .filter((group) => group.isVisible);

    return (
      <div className="atlas-content-stack catalog-manager-shell">
        <article className="atlas-card catalog-manager-card">
          <div className="catalog-accordion">
            {groups.length ? groups.map((group) => {
              const itemCount = group.items.length;
              const isOpen = Boolean(searchToken) || catalogExpandedCategory === group.category;
              return (
                <section className="catalog-group" key={group.category}>
                  <div className={`catalog-group-head ${isOpen ? 'is-open' : ''}`.trim()}>
                    <button
                      className="catalog-group-toggle"
                      onClick={() => setCatalogExpandedCategory((current) => current === group.category ? null : group.category)}
                      type="button"
                    >
                      <span className="catalog-group-main">
                        <span className="material-icons folder">folder</span>
                        <strong>{group.category}</strong>
                        <span className="catalog-count-badge">{itemCount} Items</span>
                      </span>
                      <span className={`material-icons catalog-group-caret ${isOpen ? 'is-open' : ''}`.trim()}>
                        expand_more
                      </span>
                    </button>
                    {canManageCatalogNow ? (
                      <button
                        className="catalog-delete-category-btn"
                        onClick={() => openCatalogDelete('category', group.category, `Delete category '${group.category}' and all SKUs inside it.`)}
                        title="Delete category & all SKUs"
                        type="button"
                      >
                        <span className="material-icons">delete_forever</span>
                      </button>
                    ) : null}
                  </div>
                  {isOpen ? (
                    <div className="catalog-group-body">
                      {itemCount ? (
                        <table className="catalog-items-table">
                          <thead>
                            <tr>
                              <th>Item Name / SKU (Child)</th>
                              <th>Account</th>
                              <th>Spec</th>
                              <th>Price</th>
                              <th className="is-action">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.items.map((item) => (
                              <tr key={item.id || item.sku}>
                                <td className="catalog-col-sku">
                                  <button className="catalog-sku-link" onClick={() => openCatalogDetail(item as unknown as Record<string, unknown>)} type="button">
                                    {item.sku}
                                  </button>
                                </td>
                                <td>
                                  <span className="catalog-account-badge">{item.account === '-' ? 'Gen' : item.account}</span>
                                </td>
                                <td className="catalog-spec-cell">{item.specification === '-' ? '-' : item.specification}</td>
                                <td className="catalog-price-cell">{formatCatalogPrice(item.estimatedPrice)}</td>
                                <td className="catalog-action-cell">
                                  {canManageCatalogNow ? (
                                    <>
                                      <button className="catalog-row-action tone-warning" onClick={() => openEditCatalogSkuModal(item)} title="Edit Item" type="button">
                                        <span className="material-icons">edit</span>
                                      </button>
                                      <button className="catalog-row-action tone-danger" onClick={() => openCatalogDelete('sku', item.sku, `Delete SKU '${item.sku}' from catalog.`)} title="Delete SKU" type="button">
                                        <span className="material-icons">delete</span>
                                      </button>
                                    </>
                                  ) : (
                                    <span className="asset-muted-text">-</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="catalog-empty-row">This category has no items / SKUs yet.</div>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            }) : (
              <div className="catalog-empty-state">No items match your search.</div>
            )}
          </div>
        </article>
      </div>
    );
  }

  function renderPlaceholderPanel() {
    return (
      <section className="atlas-card placeholder-card">
        <div className="placeholder-icon-wrap">
          <span className="material-icons">{activeConfig.icon}</span>
        </div>
        <h3>{activeConfig.label}</h3>
        <p>
          This module is currently unavailable.
        </p>
        <div className="placeholder-points">
          <span>Asset management and operational tracking</span>
          <span>Submit procurement requests for processing and tracking.</span>
          <span>Scope: PO module is not available in this portal</span>
        </div>
      </section>
    );
  }

  function renderProcurementInput() {
    return (
      <div className="atlas-content-stack">
        <section className="procurement-input-card">
          <div className="procurement-card-header">NEW PROCUREMENT REQUEST</div>
          <div className="procurement-card-body">
            <form className="procurement-input-form" onSubmit={handleProcurementSubmit}>
              <div className="procurement-grid two-up">
                <label className="procurement-field">
                  <span>Requestor Name (User)</span>
                  <input
                    onChange={(event) => setProcurementDraft((current) => ({ ...current, requestorName: event.target.value }))}
                    placeholder="Nama karyawan..."
                    value={procurementDraft.requestorName}
                  />
                </label>

                <label className="procurement-field">
                  <span>Source</span>
                  <select
                    onChange={(event) => setProcurementDraft((current) => ({ ...current, source: event.target.value }))}
                    value={procurementDraft.source}
                  >
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="iTop">iTop Ticket</option>
                    <option value="Email">Email GWS</option>
                  </select>
                </label>
              </div>

              <div className="procurement-source-card">
                <label className="procurement-field emphasis">
                  <span>{procurementSourceLabel(procurementDraft.source)}</span>
                  <input
                    onChange={(event) => setProcurementDraft((current) => ({ ...current, sourceReference: event.target.value }))}
                    placeholder="Input detail sumber..."
                    value={procurementDraft.sourceReference}
                  />
                </label>
              </div>

              <label className="procurement-field">
                <span>Raw Request Data</span>
                <textarea
                  onChange={(event) => setProcurementDraft((current) => ({ ...current, rawData: event.target.value }))}
                  placeholder="Paste isi chat atau email di sini..."
                  rows={5}
                  value={procurementDraft.rawData}
                />
              </label>

              <button className="procurement-submit-btn" disabled={procurementSubmitting} type="submit">
                {procurementSubmitting ? 'Processing...' : 'PROCESS TO DATABASE'}
              </button>

              {procurementMessage ? (
                <div className={`procurement-message ${procurementMessage.kind}`}>{procurementMessage.text}</div>
              ) : null}
            </form>
          </div>
        </section>
      </div>
    );
  }

  function renderAssetModule(itemsRaw: Array<Record<string, unknown>>, meta?: PageMeta, counts?: Record<string, number>) {
    const items = itemsRaw.map((item) => coerceAssetListItem(item));
    const summary = {
      rows: Number(counts?.rows ?? meta?.total ?? items.length),
      totalUnits: Number(counts?.totalUnits ?? items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)),
      inUseRows: Number(counts?.inUseRows ?? items.filter((item) => ['in use', 'assigned'].includes(item.status.toLowerCase())).length),
      availableUnits: Number(counts?.availableUnits ?? items.filter((item) => ['available', 'partially assigned'].includes(item.status.toLowerCase())).reduce((sum, item) => sum + Number(item.quantity || 0), 0))
    };

    function handleAssetSort(key: AssetListSortKey) {
      setPage(1);
      setAssetSort((current) => (
        current.key === key
          ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: key === 'qty' ? 'desc' : 'asc' }
      ));
    }

    return (
      <div className="atlas-content-stack asset-list-shell">
        <div className="asset-list-summary-grid">
          <article className="asset-list-summary-card">
            <span>Rows</span>
            <strong>{formatNumber(summary.rows)}</strong>
          </article>
          <article className="asset-list-summary-card">
            <span>Total Units</span>
            <strong>{formatNumber(summary.totalUnits)}</strong>
          </article>
          <article className="asset-list-summary-card">
            <span>In Use Rows</span>
            <strong>{formatNumber(summary.inUseRows)}</strong>
          </article>
          <article className="asset-list-summary-card">
            <span>Available Units</span>
            <strong>{formatNumber(summary.availableUnits)}</strong>
          </article>
        </div>

        <div className="asset-list-filterline">
          <span>Filter: {search ? `Search results for "${search}"` : 'All assets'}</span>
          <div className="asset-list-actions">
            <button className="atlas-toolbar-btn asset-create-btn" onClick={openAssetCreator} type="button">
              <span className="material-icons">add</span>
              Create Asset
            </button>
            <a
              className="atlas-toolbar-btn asset-export-btn"
              download
              href={`/api/app/assets/export?sortKey=${assetSort.key}&sortDir=${assetSort.dir}${search ? `&search=${encodeURIComponent(search)}` : ''}`}
            >
              <span className="material-icons">download</span>
              Export Excel
            </a>
          </div>
        </div>

        <article className="atlas-card asset-list-card">
          <div className="asset-list-scroll">
            <table className="asset-list-table">
              <thead>
                <tr>
                  <th className="asset-list-col-tag">
                    <button className={`asset-sort-btn ${assetSort.key === 'tag' ? 'active' : ''}`.trim()} onClick={() => handleAssetSort('tag')} type="button">
                      Asset Tag <span className="sort-ind">{assetSortIndicator(assetSort, 'tag')}</span>
                    </button>
                  </th>
                  <th>
                    <button className={`asset-sort-btn ${assetSort.key === 'sn' ? 'active' : ''}`.trim()} onClick={() => handleAssetSort('sn')} type="button">
                      SN <span className="sort-ind">{assetSortIndicator(assetSort, 'sn')}</span>
                    </button>
                  </th>
                  <th className="asset-list-col-item">
                    <button className={`asset-sort-btn ${assetSort.key === 'item' ? 'active' : ''}`.trim()} onClick={() => handleAssetSort('item')} type="button">
                      Item Model <span className="sort-ind">{assetSortIndicator(assetSort, 'item')}</span>
                    </button>
                  </th>
                  <th>
                    <button className={`asset-sort-btn ${assetSort.key === 'qty' ? 'active' : ''}`.trim()} onClick={() => handleAssetSort('qty')} type="button">
                      Qty <span className="sort-ind">{assetSortIndicator(assetSort, 'qty')}</span>
                    </button>
                  </th>
                  <th>
                    <button className={`asset-sort-btn ${assetSort.key === 'status' ? 'active' : ''}`.trim()} onClick={() => handleAssetSort('status')} type="button">
                      Status <span className="sort-ind">{assetSortIndicator(assetSort, 'status')}</span>
                    </button>
                  </th>
                  <th className="asset-list-col-user">
                    <button className={`asset-sort-btn ${assetSort.key === 'user' ? 'active' : ''}`.trim()} onClick={() => handleAssetSort('user')} type="button">
                      Assigned To <span className="sort-ind">{assetSortIndicator(assetSort, 'user')}</span>
                    </button>
                  </th>
                  <th className="asset-list-col-owner">
                    <button className={`asset-sort-btn ${assetSort.key === 'assignedAccount' ? 'active' : ''}`.trim()} onClick={() => handleAssetSort('assignedAccount')} type="button">
                      Assigned Account <span className="sort-ind">{assetSortIndicator(assetSort, 'assignedAccount')}</span>
                    </button>
                  </th>
                  <th className="asset-list-col-owner">
                    <button className={`asset-sort-btn ${assetSort.key === 'assignedDept' ? 'active' : ''}`.trim()} onClick={() => handleAssetSort('assignedDept')} type="button">
                      Assigned Dept <span className="sort-ind">{assetSortIndicator(assetSort, 'assignedDept')}</span>
                    </button>
                  </th>
                  <th>
                    <button className={`asset-sort-btn ${assetSort.key === 'location' ? 'active' : ''}`.trim()} onClick={() => handleAssetSort('location')} type="button">
                      Location <span className="sort-ind">{assetSortIndicator(assetSort, 'location')}</span>
                    </button>
                  </th>
                  <th className="asset-list-col-owner">
                    <button className={`asset-sort-btn ${assetSort.key === 'ownerAccount' ? 'active' : ''}`.trim()} onClick={() => handleAssetSort('ownerAccount')} type="button">
                      Owner Account <span className="sort-ind">{assetSortIndicator(assetSort, 'ownerAccount')}</span>
                    </button>
                  </th>
                  <th className="asset-list-col-owner">
                    <button className={`asset-sort-btn ${assetSort.key === 'ownerDept' ? 'active' : ''}`.trim()} onClick={() => handleAssetSort('ownerDept')} type="button">
                      Owner Dept <span className="sort-ind">{assetSortIndicator(assetSort, 'ownerDept')}</span>
                    </button>
                  </th>
                  <th className="asset-list-col-action">
                    <span className="asset-list-action-head">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.length ? (
                  items.map((item) => {
                    const assignedUserQuery = normalizeAssignedEmployeeQuery(item.assignedToText);
                    const showAssignedUser = item.assignedToText !== '-' && item.assignedToText.toLowerCase() !== 'unassigned';

                    return (
                      <tr key={item.id || item.assetTag}>
                        <td>
                          <button
                            className="asset-link primary"
                            onClick={() => void openAssetDetail(item.assetTag)}
                            type="button"
                          >
                            {assetDisplayText(item.assetTag)}
                          </button>
                        </td>
                        <td>{assetDisplayText(item.serialNumber)}</td>
                        <td>
                          <div className="asset-item-stack">
                            <button
                              className="asset-link model"
                              onClick={() => void openCatalogDetailByName(item.itemModel, item.category)}
                              type="button"
                            >
                              {assetDisplayText(item.itemModel)}
                              <span className="material-icons">info</span>
                            </button>
                            <span className="asset-category-pill">{assetDisplayText(item.category)}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`asset-qty-pill ${Number(item.quantity) > 0 ? 'normal' : 'empty'}`.trim()}>
                            {formatNumber(item.quantity)}
                          </span>
                        </td>
                        <td>
                          <span className={`asset-status-pill tone-${assetStatusTone(item.status)}`.trim()}>
                            {assetDisplayText(item.status)}
                          </span>
                        </td>
                        <td>
                          {showAssignedUser ? (
                            <button
                              className="asset-link assigned"
                              onClick={() => void openEmployeeDetail(assignedUserQuery || item.assignedToText)}
                              type="button"
                            >
                              {assetDisplayText(item.assignedToText)}
                            </button>
                          ) : (
                            <span className="asset-muted-text">Unassigned</span>
                          )}
                        </td>
                        <td className="asset-owner-cell">
                          <span className={`asset-owner-pill ${item.assignedAccount !== '-' ? 'acct' : 'na'}`.trim()} title={assetDisplayText(item.assignedAccount)}>
                            {assetDisplayText(item.assignedAccount)}
                          </span>
                        </td>
                        <td className="asset-owner-cell">
                          <span className={`asset-owner-pill ${item.assignedDept !== '-' ? 'dept' : 'na'}`.trim()} title={assetDisplayText(item.assignedDept)}>
                            {assetDisplayText(item.assignedDept)}
                          </span>
                        </td>
                        <td>
                          {item.location !== '-' ? (
                            <span className="asset-loc-cell">{assetDisplayText(item.location)}</span>
                          ) : (
                            <span className="asset-muted-pill">N/A</span>
                          )}
                        </td>
                        <td className="asset-owner-cell">
                          <span className={`asset-owner-pill ${item.ownerAccount !== '-' ? 'acct' : 'na'}`.trim()} title={assetDisplayText(item.ownerAccount)}>
                            {assetDisplayText(item.ownerAccount)}
                          </span>
                        </td>
                        <td className="asset-owner-cell">
                          <span className={`asset-owner-pill ${item.ownerDepartment !== '-' ? 'dept' : 'na'}`.trim()} title={assetDisplayText(item.ownerDepartment)}>
                            {assetDisplayText(item.ownerDepartment)}
                          </span>
                        </td>
                        <td className="asset-cell-action">
                          {canManageAssetsNow ? (
                            <>
                              <button
                                className="asset-action-btn tone-info"
                                onClick={() => beginAssetQtyEdit(item)}
                                title="Edit quantity"
                                type="button"
                              >
                                <span className="material-icons">playlist_add</span>
                              </button>
                              <button
                                className="asset-action-btn tone-warning"
                                onClick={() => void beginAssetEdit(item)}
                                title="Edit asset"
                                type="button"
                              >
                                <span className="material-icons">edit</span>
                              </button>
                              <button
                                className="asset-action-btn tone-danger"
                                onClick={() => beginAssetDelete(item)}
                                title="Delete asset"
                                type="button"
                              >
                                <span className="material-icons">delete</span>
                              </button>
                            </>
                          ) : (
                            <span className="asset-muted-text">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="asset-list-empty" colSpan={12}>
                      No assets matched the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        {meta ? (
          <div className="atlas-pager asset-list-pager">
            <span>
              Showing page {meta.page} of {meta.pageCount} | {formatNumber(meta.total)} total rows
            </span>
            <div className="atlas-pager-actions">
              <button
                className="atlas-toolbar-btn subtle"
                disabled={meta.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                Prev
              </button>
              <button
                className="atlas-toolbar-btn subtle"
                disabled={meta.page >= meta.pageCount}
                onClick={() => setPage((current) => current + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderEmployeeDirectoryModule(itemsRaw: Array<Record<string, unknown>>, meta?: PageMeta) {
    const items = itemsRaw.map((item) => coerceEmployeeDirectoryItem(item));
    const rowBase = meta ? (meta.page - 1) * meta.pageSize : 0;

    return (
      <div className="atlas-content-stack employee-directory-shell">
        <article className="atlas-card employee-directory-card">
          <div className="employee-directory-scroll">
            <table className="employee-directory-table">
              <thead>
                <tr>
                  <th className="employee-directory-col-no">No</th>
                  <th>NIK</th>
                  <th>Full Name</th>
                  <th>Email</th>
                  <th>Account / Departement</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? (
                  items.map((item, rowIndex) => (
                    <tr key={`${item.queryKey}-${rowIndex}`}>
                      <td className="employee-directory-no">{rowBase + rowIndex + 1}</td>
                      <td className="employee-directory-nik">{toText(item.nik)}</td>
                      <td>
                        <div className="employee-directory-name">{toText(item.fullName)}</div>
                      </td>
                      <td className="employee-directory-email">{toText(item.email)}</td>
                      <td>
                        <div className="employee-directory-account-stack">
                          <span className="employee-directory-account">{toText(item.account)}</span>
                          <span className="employee-directory-department">{toText(item.department)}</span>
                        </div>
                      </td>
                      <td className="employee-directory-status-cell">
                        <span className={employeeDirectoryStatusTone(toText(item.statusLabel))}>{toText(item.statusLabel)}</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="employee-directory-empty" colSpan={6}>
                      No employee records matched the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        {meta ? (
          <div className="atlas-pager employee-directory-pager">
            <span>
              Showing page {meta.page} of {meta.pageCount} | {formatNumber(meta.total)} total rows
            </span>
            <div className="atlas-pager-actions">
              <button
                className="atlas-toolbar-btn subtle"
                disabled={meta.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                Prev
              </button>
              <button
                className="atlas-toolbar-btn subtle"
                disabled={meta.page >= meta.pageCount}
                onClick={() => setPage((current) => current + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderHoldingsDirectoryModule(itemsRaw: Array<Record<string, unknown>>, meta?: PageMeta) {
    // Portal users (USER / WFH / WFO) can only see their own holdings
    const roles = Array.isArray(user?.roles) ? user!.roles.map(normalizeRoleLabel) : [];
    const isPortalUser = roles.some(isPortalUserRole);

    if (isPortalUser) {
      if (!myHoldings || myHoldings.loading) {
        return (
          <div className="atlas-content-stack">
            <article className="atlas-card" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
              <span className="material-icons" style={{ fontSize: '2rem', marginBottom: '0.5rem', display: 'block' }}>inventory_2</span>
              Loading your asset holdings…
            </article>
          </div>
        );
      }
      if (myHoldings.error) {
        return (
          <div className="atlas-content-stack">
            <article className="atlas-card" style={{ padding: '2rem', textAlign: 'center', color: '#dc2626' }}>
              {myHoldings.error}
            </article>
          </div>
        );
      }
      if (!myHoldings.detail) {
        return (
          <div className="atlas-content-stack">
            <article className="atlas-card" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
              No holdings data found for your account.
            </article>
          </div>
        );
      }
      return (
        <div className="atlas-content-stack">
          <article className="atlas-card my-holdings-card">
            {renderEmployeeDetailContent({ detail: myHoldings.detail, history: myHoldings.history })}
          </article>
        </div>
      );
    }

    const items = itemsRaw.map((item) => coerceEmployeeDirectoryItem(item));
    const rowBase = meta ? (meta.page - 1) * meta.pageSize : 0;

    return (
      <div className="atlas-content-stack holdings-directory-shell">
        <article className="atlas-card holdings-directory-card">
          <div className="holdings-directory-scroll">
            <table className="holdings-directory-table">
              <thead>
                <tr>
                  <th className="holdings-directory-col-no">No</th>
                  <th>NIK</th>
                  <th>Full Name</th>
                  <th>Email</th>
                  <th>Account / Department</th>
                  <th className="holdings-directory-col-action">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? (
                  items.map((item, rowIndex) => (
                    <tr key={`${item.queryKey}-${rowIndex}`}>
                      <td className="holdings-directory-no">{rowBase + rowIndex + 1}</td>
                      <td className="holdings-directory-nik">{toText(item.nik)}</td>
                      <td>
                        <button
                          className="holdings-directory-name"
                          onClick={() =>
                            void openEmployeeDetail(
                              toText(item.queryKey || item.email || item.employeeKey || item.nik || item.fullName),
                              'Employee Asset Holdings'
                            )
                          }
                          title="View current asset holdings"
                          type="button"
                        >
                          {toText(item.fullName)}
                        </button>
                      </td>
                      <td className="holdings-directory-email">{toText(item.email)}</td>
                      <td>
                        <div className="holdings-directory-account-stack">
                          <span className="holdings-directory-account">{toText(item.account)}</span>
                          <span className="holdings-directory-department">{toText(item.department)}</span>
                        </div>
                      </td>
                      <td className="holdings-directory-action-cell">
                        <button
                          className="holdings-directory-view-btn"
                          onClick={() =>
                            void openEmployeeDetail(
                              toText(item.queryKey || item.email || item.employeeKey || item.nik || item.fullName),
                              'Employee Asset Holdings'
                            )
                          }
                          type="button"
                        >
                          <span className="material-icons">inventory_2</span>
                          View Holdings
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="holdings-directory-empty" colSpan={6}>
                      No employee found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        {meta ? (
          <div className="atlas-pager holdings-directory-pager">
            <span>
              Showing page {meta.page} of {meta.pageCount} | {formatNumber(meta.total)} total rows
            </span>
            <div className="atlas-pager-actions">
              <button
                className="atlas-toolbar-btn subtle"
                disabled={meta.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                Prev
              </button>
              <button
                className="atlas-toolbar-btn subtle"
                disabled={meta.page >= meta.pageCount}
                onClick={() => setPage((current) => current + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderMasterReferenceModule() {
    const groups = Array.isArray(moduleData?.masterReferences?.groups) ? moduleData?.masterReferences?.groups : [];
    const searchActive = Boolean(search.trim());

    return (
      <div className="atlas-content-stack master-reference-shell">
        <article className="atlas-card master-reference-card">
          {groups.length ? (
            <div className="master-reference-accordion">
              {groups.map((group, index) => {
                const isOpen = searchActive ? true : Boolean(masterReferenceExpanded[group.key]);

                return (
                  <section className="master-reference-group" key={group.key || `${group.account}-${index}`}>
                    <div className="master-reference-group-head">
                      <button
                        className="master-reference-group-toggle"
                        onClick={() => toggleMasterReferenceGroup(group.key)}
                        type="button"
                      >
                        <div className="master-reference-group-main">
                          <span className="material-icons account">account_balance</span>
                          <strong>{toText(group.account)}</strong>
                          <span className="master-reference-count-badge">{formatNumber(group.departmentCount)} Depts</span>
                        </div>
                      </button>
                      <div className="master-reference-group-actions">
                        {canManageMasterReferenceNow ? (
                          <>
                            <button
                              className="master-reference-action-btn warning"
                              onClick={() => openMasterReferenceSourceNotice('Edit Account', toText(group.account))}
                              title="Edit Account"
                              type="button"
                            >
                              <span className="material-icons">edit</span>
                            </button>
                            <button
                              className="master-reference-action-btn danger"
                              onClick={() => openMasterReferenceSourceNotice('Delete Account', toText(group.account))}
                              title="Delete Account"
                              type="button"
                            >
                              <span className="material-icons">delete_forever</span>
                            </button>
                          </>
                        ) : null}
                        <button
                          className="master-reference-caret-btn"
                          onClick={() => toggleMasterReferenceGroup(group.key)}
                          title={isOpen ? 'Collapse' : 'Expand'}
                          type="button"
                        >
                          <span className={`material-icons master-reference-caret ${isOpen ? 'is-open' : ''}`.trim()}>
                            expand_more
                          </span>
                        </button>
                      </div>
                    </div>

                    <div className={`master-reference-group-body ${isOpen ? 'is-open' : ''}`.trim()}>
                      {isOpen ? (
                        <div className="master-reference-group-body-inner">
                          {group.departments.length ? (
                            <div className="master-reference-dept-list">
                              {group.departments.map((department) => (
                                <div className="master-reference-dept-row" key={department.key}>
                                  <div className="master-reference-dept-summary">
                                    <span className="material-icons">apartment</span>
                                    <span className="master-reference-dept-name">{toText(department.value)}</span>
                                  </div>
                                  <div className="master-reference-dept-actions">
                                    {canManageMasterReferenceNow ? (
                                      <>
                                        <button
                                          className="master-reference-action-btn warning"
                                          onClick={() =>
                                            openMasterReferenceSourceNotice(
                                              'Edit Department',
                                              `${toText(department.value)} • ${toText(department.parentLink)}`
                                            )
                                          }
                                          title="Edit Department"
                                          type="button"
                                        >
                                          <span className="material-icons">edit</span>
                                        </button>
                                        <button
                                          className="master-reference-action-btn danger"
                                          onClick={() =>
                                            openMasterReferenceSourceNotice(
                                              'Delete Department',
                                              `${toText(department.value)} • ${toText(department.parentLink)}`
                                            )
                                          }
                                          title="Delete Department"
                                          type="button"
                                        >
                                          <span className="material-icons">delete</span>
                                        </button>
                                      </>
                                    ) : (
                                      <span className="atlas-muted-text">-</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="master-reference-empty-children">
                              No Departments under this Account.
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="master-reference-empty">No organization structure matched the current filter.</div>
          )}
        </article>
      </div>
    );
  }

  function renderReadOnlyToolbar() {
    if (!activeConfig.endpoint || activeModule === 'sync') return null;

    // Portal users in holdings module see only their own data — no search bar needed
    if (activeModule === 'holdings') {
      const roles = Array.isArray(user?.roles) ? user!.roles.map(normalizeRoleLabel) : [];
      if (roles.some(isPortalUserRole)) return null;
    }

    if (activeModule === 'procurementMonitoring' || activeModule === 'procurementArchive') {
      return (
        <section className="atlas-toolbar-card procurement-monitor-toolbar">
          <form className="proc-monitor-search-form" onSubmit={handleSearchSubmit}>
            <div className="atlas-search-input proc-monitor-search-input">
              <span className="material-icons">search</span>
              <input
                value={draftSearch}
                onChange={(event) => setDraftSearch(event.target.value)}
                placeholder={activeConfig.searchPlaceholder || 'Search procurement records'}
              />
            </div>
          </form>
        </section>
      );
    }

    if (activeModule === 'catalog') {
      return (
        <section className="atlas-toolbar-card catalog-manager-toolbar">
          <form className="atlas-search-row catalog-search-row" onSubmit={handleSearchSubmit}>
            <div className="atlas-search-input">
              <span className="material-icons">search</span>
              <input
                value={draftSearch}
                onChange={(event) => setDraftSearch(event.target.value)}
                placeholder="Search item name, category, or specs..."
              />
            </div>
          </form>
        </section>
      );
    }

    const qcNote = activeModule === 'handoverList' ? 'BAST document history.' : 'Production records.';

    return (
      <section className="atlas-toolbar-card">
        <form className="atlas-search-row" onSubmit={handleSearchSubmit}>
          <div className="atlas-search-input">
            <span className="material-icons">search</span>
            <input
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder={activeConfig.searchPlaceholder || 'Search module data'}
            />
          </div>
          <button className="atlas-toolbar-btn" type="submit">
            Search
          </button>
        </form>
        <div className="atlas-toolbar-meta">
          <span>{qcNote}</span>
          <span>{search ? `Active filter: "${search}"` : 'No active filter applied.'}</span>
        </div>
      </section>
    );
  }

  function renderDataModule() {
    if (moduleLoading && activeModule !== 'handoverList') {
      return <div className="atlas-card atlas-muted-panel">Loading module data...</div>;
    }

    if (moduleError) {
      return <div className="atlas-card atlas-error-panel">{moduleError}</div>;
    }

    if (activeModule === 'sync') {
      return (
        <div className="atlas-content-stack">
          <div className="atlas-sync-note">
            Data import health and record consistency status.
          </div>

          <section className="atlas-stat-grid">
            {Object.entries(moduleData?.counts || {}).map(([key, value]) => (
              <article className="atlas-stat-card tone-slate" key={key}>
                <span className="atlas-stat-label">
                  {key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())}
                </span>
                <strong>{formatNumber(value)}</strong>
                <p>Current record count</p>
                <div className="mini-progress">
                  <span style={{ width: '100%' }} />
                </div>
                <div className="atlas-stat-foot">
                  <span>Status</span>
                  <b>Aligned</b>
                </div>
              </article>
            ))}
          </section>

          <article className="atlas-card">
            <div className="atlas-card-heading">
              <h3>Import Batch History</h3>
              <p>Import batch history and processing status.</p>
            </div>
            <TableCard
              columns={['Source File', 'Status', 'Imported Rows', 'Started', 'Completed']}
              rows={(moduleData?.batches || []).map((item) => [
                toText(item.sourceFile),
                <StatusBadge key={`batch-${item.startedAt}`} value={toText(item.status)} />,
                formatNumber(item.importedRows ?? 0),
                formatDate(item.startedAt),
                formatDate(item.completedAt)
              ])}
              emptyMessage="No import batches are recorded yet."
            />
          </article>
        </div>
      );
    }

    const items = moduleData?.items || [];
    const meta = moduleData?.meta;

    if (activeModule === 'employeeDatabase') {
      return renderEmployeeDirectoryModule(items, meta);
    }

    if (activeModule === 'holdings') {
      return renderHoldingsDirectoryModule(items, meta);
    }

    if (activeModule === 'masterReference') {
      return renderMasterReferenceModule();
    }

    if (activeModule === 'catalog') {
      return renderCatalogModule(items);
    }

    if (activeModule === 'assets') {
      return renderAssetModule(items, meta, moduleData?.counts);
    }

    if (activeModule === 'procurementMonitoring' || activeModule === 'procurementArchive') {
      const procurementItems = items.map((entry) => coerceProcurementItem(entry));
      const dateLabel = activeModule === 'procurementArchive' ? 'Finished Date' : 'Date';

      return (
        <div className="atlas-content-stack procurement-monitor-shell">
          <article className="atlas-card procurement-monitor-card">
            <div className="proc-monitor-scroll">
              <table className="proc-monitor-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Reference</th>
                    <th>Requestor</th>
                    <th>Item</th>
                    <th>Reference No.</th>
                    <th>Status</th>
                    <th>{dateLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {procurementItems.length ? (
                    procurementItems.map((item, rowIndex) => {
                      const refNoValue = toText(item.referenceNo);
                      const refNoTone =
                        refNoValue === '-'
                          ? 'is-empty'
                          : refNoValue.toLowerCase().includes('stock')
                            ? 'is-stock'
                            : '';

                      return (
                        <tr
                          className="is-clickable"
                          key={`${item.requestNumber}-${rowIndex}`}
                          onClick={() =>
                            openProcurementDetail(
                              item,
                              activeModule === 'procurementArchive' ? 'Archive' : 'Monitoring'
                            )
                          }
                        >
                          <td>
                            <span className="proc-monitor-id">{toText(item.requestNumber)}</span>
                          </td>
                          <td>
                            <div className="proc-monitor-reference">
                              <strong>{toText(item.sourceReference)}</strong>
                              <small>{toText(item.requestSource)}</small>
                            </div>
                          </td>
                          <td>
                            <span className="proc-monitor-requestor">{toText(item.requestorName)}</span>
                          </td>
                          <td>
                            <span className="proc-monitor-item" title={toText(item.itemSummary)}>
                              {toText(item.itemSummary)}
                            </span>
                          </td>
                          <td>
                            <span className={`proc-monitor-refno ${refNoTone}`.trim()}>{refNoValue}</span>
                          </td>
                          <td>
                            <span className={`proc-monitor-status tone-${getProcurementStatusTone(item.status)}`}>
                              {toText(item.status)}
                            </span>
                          </td>
                          <td className="proc-monitor-date">{formatDate(item.timestamp)}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="proc-monitor-empty" colSpan={7}>
                        No procurement records matched the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          {meta ? (
            <div className="atlas-pager procurement-monitor-pager">
              <span>
                Showing page {meta.page} of {meta.pageCount} | {formatNumber(meta.total)} total rows
              </span>
              <div className="atlas-pager-actions">
                <button
                  className="atlas-toolbar-btn subtle"
                  disabled={meta.page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  type="button"
                >
                  Prev
                </button>
                <button
                  className="atlas-toolbar-btn subtle"
                  disabled={meta.page >= meta.pageCount}
                  onClick={() => setPage((current) => current + 1)}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    let columns: string[] = [];
    let rows: Array<Array<ReactNode>> = [];
    let emptyMessage = 'No data available.';
    let onRowClick: ((rowIndex: number) => void) | undefined;

    if (activeModule === 'handoverList') {
      function hoSortBtn(label: string, key: string) {
        const active = handoverSort.key === key;
        const indicator = active ? (handoverSort.dir === 'asc' ? '↑' : '↓') : '↕';
        return (
          <button
            className={`asset-sort-btn${active ? ' active' : ''}`}
            disabled={moduleLoading}
            onClick={() => {
              setHandoverSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
              setPage(1);
            }}
            type="button"
          >
            {label}<span className="sort-ind">{indicator}</span>
          </button>
        );
      }

      const STATUS_OPTIONS = ['', 'Completed', 'On Hold', 'Cancelled'];

      return (
        <div className="atlas-content-stack">
          <article className="atlas-card ho-list-card">
            <div className="ho-list-scroll">
              <table className="ho-list-table">
                <thead>
                  <tr>
                    <th className="ho-col-doc">{hoSortBtn('Doc ID', 'docNumber')}</th>
                    <th className="ho-col-ts">{hoSortBtn('Timestamp', 'transactionTimestamp')}</th>
                    <th className="ho-col-type">{hoSortBtn('Type', 'transactionType')}</th>
                    <th className="ho-col-user">{hoSortBtn('User Info', 'holderName')}</th>
                    <th className="ho-col-status">
                      <div className="ho-status-th">
                        <span className="asset-sort-btn" style={{ cursor: 'default' }}>Status</span>
                        <select
                          className="ho-status-filter"
                          disabled={moduleLoading}
                          value={handoverStatusFilter}
                          onChange={(e) => { setHandoverStatusFilter(e.target.value); setPage(1); }}
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt.toLowerCase()}>{opt || 'All'}</option>
                          ))}
                        </select>
                      </div>
                    </th>
                    <th className="ho-col-action"><span className="asset-sort-btn" style={{ cursor: 'default' }}>Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {moduleLoading ? (
                    <tr>
                      <td className="atlas-empty-cell ho-loading-cell" colSpan={6}>
                        <span className="material-icons ho-loading-spin">sync</span>
                        Loading...
                      </td>
                    </tr>
                  ) : moduleError ? (
                    <tr>
                      <td className="atlas-empty-cell" colSpan={6} style={{ color: '#b91c1c' }}>{moduleError}</td>
                    </tr>
                  ) : items.length ? items.map((item, rowIndex) => {
                    const ts = formatDateStack(item.transactionTimestamp || item.timestamp || item.createdAt || item.updatedAt);
                    return (
                      <tr className="is-clickable" key={`ho-row-${item.docNumber}-${rowIndex}`} onClick={() => void openHandoverDetail(toText(item.docNumber))}>
                        <td>
                          <div className="atlas-cell-stack compact">
                            <strong className="atlas-doc-link">{toText(item.docNumber)}</strong>
                          </div>
                        </td>
                        <td>
                          <div className="atlas-cell-stack compact">
                            <strong>{ts.date}</strong>
                            <small>{ts.time || '-'}</small>
                          </div>
                        </td>
                        <td>
                          <div className="atlas-cell-stack compact">
                            <strong className={`atlas-handover-type ${getHandoverTypeTone(item.transactionType)}`}>
                              {formatHandoverTypeLabel(item.transactionType)}
                            </strong>
                          </div>
                        </td>
                        <td>
                          <div className="atlas-user-stack">
                            <strong>{toText(item.holderName)}</strong>
                            <small>{toText(item.holderDepartment)}</small>
                            {toText(item.holderNik) !== '-' ? <small>NIK: {toText(item.holderNik)}</small> : null}
                          </div>
                        </td>
                        <td><StatusBadge value={toText(item.status)} /></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="atlas-cell-actions">
                            {toText(item.pdfUrl) ? (
                              <button
                                className="atlas-icon-btn"
                                onClick={(event) => { event.stopPropagation(); window.open(toText(item.pdfUrl), '_blank', 'noopener,noreferrer'); }}
                                type="button"
                                title="Open PDF"
                              >
                                <span className="material-icons">open_in_new</span>
                              </button>
                            ) : (
                              <span className="atlas-muted-text">-</span>
                            )}
                            {toText(item.status).toLowerCase() === 'on hold' ? (
                              <button
                                className="atlas-icon-btn secondary"
                                onClick={(event) => { event.stopPropagation(); beginHandoverResume(toText(item.docNumber)); }}
                                type="button"
                                title="Resume"
                              >
                                <span className="material-icons">edit_note</span>
                              </button>
                            ) : null}
                            {toText(item.status).toLowerCase() === 'on hold' && canManageAssetsNow ? (
                              <button
                                className="atlas-icon-btn danger"
                                onClick={(event) => { event.stopPropagation(); void openHandoverDetail(toText(item.docNumber)); openHandoverCancel(toText(item.docNumber)); }}
                                type="button"
                                title="Cancel BAST"
                              >
                                <span className="material-icons">block</span>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td className="atlas-empty-cell" colSpan={6}>
                        No handover records matched the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          {meta ? (
            <div className="atlas-pager">
              <span>
                Showing page {meta.page} of {meta.pageCount} | {formatNumber(meta.total)} total rows
              </span>
              <div className="atlas-pager-actions">
                <button className="atlas-toolbar-btn subtle" disabled={meta.page <= 1} onClick={() => setPage((c) => Math.max(1, c - 1))} type="button">Prev</button>
                <button className="atlas-toolbar-btn subtle" disabled={meta.page >= meta.pageCount} onClick={() => setPage((c) => c + 1)} type="button">Next</button>
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    switch (activeModule) {
      default:
        break;
    }

    return (
      <div className="atlas-content-stack">
        <article className="atlas-card">
          <TableCard
            columns={columns}
            rows={rows}
            emptyMessage={emptyMessage}
            onRowClick={onRowClick}
          />
        </article>

        {meta ? (
          <div className="atlas-pager">
            <span>
              Showing page {meta.page} of {meta.pageCount} | {formatNumber(meta.total)} total rows
            </span>
            <div className="atlas-pager-actions">
              <button
                className="atlas-toolbar-btn subtle"
                disabled={meta.page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                Prev
              </button>
              <button
                className="atlas-toolbar-btn subtle"
                disabled={meta.page >= meta.pageCount}
                onClick={() => setPage((current) => current + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderModuleBody() {
    if (activeModule === 'dashboard') return renderDashboard();
    if (activeModule === 'procurementInput') return renderProcurementInput();
    if (activeModule === 'newPo') return <NewPoPortal />;
    if (activeModule === 'adminPortal') return <AdminPortal />;
    if (activeModule === 'handoverForm') {
      return user ? (
        <HandoverFormWorkspace
          onResumeCleared={() => setHandoverResumeDoc(null)}
          onSubmitted={handleHandoverSubmitted}
          resumeDocNumber={handoverResumeDoc}
          resumeNonce={handoverResumeNonce}
          user={user}
        />
      ) : null;
    }
    if (activeConfig.flowState === 'pending') return renderPlaceholderPanel();
    return renderDataModule();
  }

  if (checking) {
    return (
      <main className="auth-shell">
        <section className="login-shell">
          <div className="login-brand-panel">
            <span className="login-pill">
              <span className="material-icons">verified_user</span>
              Your Company
            </span>
            <div className="login-brand-logo atlas-brand-logo-panel">
              <AtlasMark className="atlas-brand-mark atlas-brand-mark-lg" />
            </div>
            <div className="login-brand-copy">
              <h1>ATLAS</h1>
              <p>Asset Tracking &amp; Lifecycle Administration System</p>
            </div>
            <div className="login-brand-footer">
              <div className="login-brand-meta">
                <strong>Powered by</strong>
                <span>Your Company</span>
                <span>Technology-driven internal operations environment</span>
              </div>
              <img
                alt="Your Company"
                className="login-ati-logo login-ati-logo-light"
                src="/auth/ATI_Logo_Main_White_1.png"
              />
            </div>
          </div>
          <div className="login-form-panel">
            <div className="login-badge">
              <span className="material-icons">login</span>
              Corporate Sign-In
            </div>
            <h2>Checking session</h2>
            <p>Please wait while the system validates your corporate access.</p>
          </div>
        </section>
      </main>
    );
  }

  if (!user) {
    const showGoogleLogin = Boolean(authReadiness?.googleEnabled && authReadiness?.googleClientReady);

    return (
      <main className="auth-shell">
        <section className="login-shell">
          <div className="login-brand-panel">
            <span className="login-pill">
              <span className="material-icons">verified_user</span>
              Your Company
            </span>
            <div className="login-brand-logo atlas-brand-logo-panel">
              <AtlasMark className="atlas-brand-mark atlas-brand-mark-lg" />
            </div>
            <div className="login-brand-copy">
              <h1>ATLAS</h1>
              <p>
                Asset Tracking &amp; Lifecycle
                <br />
                Administration System
              </p>
            </div>
            <div className="login-brand-footer">
              <div className="login-brand-meta">
                <strong>Powered by</strong>
                <span>Your Company</span>
                <span>Technology-driven internal operations environment</span>
              </div>
              <img
                alt="Your Company"
                className="login-ati-logo login-ati-logo-light"
                src="/auth/ATI_Logo_Main_White_1.png"
              />
            </div>
          </div>

          <div className="login-form-panel">
            <div className="login-badge">
              <span className="material-icons">login</span>
              Corporate Sign-In
            </div>
            <h2>Welcome back</h2>
            <p>
              Sign in with your corporate Google account to continue.
            </p>

            <div className="login-auth-stack">
              <div className="login-info-grid">
                <div className="login-info-card">
                  <span>Access</span>
                  <strong>Google Workspace Corporate Sign-In</strong>
                </div>
                <div className="login-info-card">
                  <span>Portal</span>
                  <strong>Internal Operations Dashboard</strong>
                </div>
              </div>

              {showGoogleLogin ? (
                <>
                  <button
                    className="atlas-toolbar-btn subtle login-google-btn"
                    onClick={handleGoogleLogin}
                    type="button"
                  >
                    <GoogleMark className="login-google-mark" />
                    Sign in with Google Account
                  </button>
                </>
              ) : authReadiness?.googleEnabled ? (
                <p className="login-support-note">
                  Google sign-in is enabled, but client credentials are still missing.
                </p>
              ) : null}

              <div className="login-note-card">
                <strong>Note:</strong> Access is restricted to authorized internal users only.
              </div>

              <p className="login-support-note login-support-note-relaxed">
                If your account should already have access but you still cannot sign in, please contact the portal administrator.
              </p>

              {loginNotice ? <p className="login-support-note">{loginNotice}</p> : null}
              {error ? <p className="login-error">{error}</p> : null}
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <>
      <div
        id="wrapper"
        className={`atlas-shell ${!isMobileShell && sidebarCollapsed ? 'toggled' : ''} ${isMobileShell ? 'is-mobile' : ''} ${mobileSidebarOpen ? 'mobile-open' : ''}`.trim()}
      >
        {isMobileShell ? (
          <button
            aria-expanded={mobileSidebarOpen}
            aria-label={mobileSidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="atlas-mobile-menu-trigger"
            onClick={handleSidebarToggle}
            type="button"
          >
            <span className="material-icons">menu</span>
          </button>
        ) : null}
        <aside className="sidebar">
        <div className="sidebar-nav-container">
          <div className="sidebar-header">
            <div className="sidebar-brand">
              <span aria-hidden="true" className="atlas-logo atlas-logo-shell">
                <AtlasMark className="atlas-brand-mark" />
              </span>
              <div className="brand-text">
                <strong>ATLAS</strong>
                <span>BY ATI BUSINESS GROUP</span>
              </div>
            </div>
            <button
              className="sidebar-toggle"
              onClick={handleSidebarToggle}
              type="button"
              title="Toggle Sidebar"
            >
              <span className="material-icons">menu</span>
            </button>
          </div>
          <hr className="sidebar-separator" />

          <nav className="atlas-nav">
            {canAccessDashboard(user) ? (
              <button
                className={`nav-link ${activeModule === 'dashboard' ? 'active' : ''}`}
                onClick={() => handleModuleSelect('dashboard')}
                type="button"
                data-tip="ITAM Dashboard"
              >
                <span className="material-icons">dashboard</span>
                <span className="nav-text">ITAM Dashboard</span>
              </button>
            ) : null}

            {visibleNavGroups.map((group) => (
              <div className="nav-item" key={group.key}>
                <button
                  className={`nav-link nav-group ${group.items.includes(activeModule) && !openGroups[group.key] ? 'active' : ''}`.trim()}
                  onClick={() => toggleGroup(group.key)}
                  type="button"
                  data-tip={group.label}
                >
                  <span className="material-icons">{group.icon}</span>
                  <span className="nav-text">{group.label}</span>
                  <span className={`material-icons menu-caret ${openGroups[group.key] ? 'is-open' : ''}`.trim()}>
                    expand_more
                  </span>
                </button>
                <div className={`sub-menu ${openGroups[group.key] ? 'is-open' : ''}`.trim()} aria-hidden={!openGroups[group.key]}>
                  <div className="sub-menu-inner">
                    {group.items.map((itemKey) => (
                      <button
                        className={`nav-link ${activeModule === itemKey ? 'active' : ''}`}
                        key={itemKey}
                        onClick={() => handleModuleSelect(itemKey)}
                        type="button"
                        data-tip={MODULES[itemKey].label}
                      >
                        <span className="material-icons">{MODULES[itemKey].icon}</span>
                        <span className="nav-text">{MODULES[itemKey].navLabel}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </nav>
        </div>

        <div className="user-section">
          <div className="user-mini-head">
            <span className="material-icons">account_circle</span>
            <div className="user-mini-meta">
              <span className="company-label">YOUR COMPANY</span>
              <span className="user-email-text">{user.email}</span>
              <span className="user-role-badge">{Array.from(new Set(user.roles.map((role) => formatRoleLabel(role)))).join(', ')}</span>
            </div>
          </div>
          <button className="sidebar-signout" onClick={handleLogout} type="button">
            Sign Out
          </button>
        </div>
        </aside>
        <button
          aria-label="Close sidebar"
          className="sidebar-overlay"
          onClick={() => setMobileSidebarOpen(false)}
          type="button"
        />

        <main className={`main-content ${activeModule === 'dashboard' ? 'is-dashboard-module' : ''}`.trim()}>
          {activeModule === 'dashboard' ? (
            <div className="itam-dashboard-shell">
              {renderPageHeader()}
              {renderModuleBody()}
            </div>
          ) : activeModule === 'procurementInput' || activeModule === 'handoverForm' ? (
            renderModuleBody()
          ) : (
            <>
              {renderPageHeader()}
              {renderReadOnlyToolbar()}
              {renderModuleBody()}
            </>
          )}
        </main>
      </div>
      {renderDetailModal()}
      {renderAssetActionModals()}
      {renderCatalogActionModals()}
    </>
  );
}
