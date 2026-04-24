'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import {
  DataSheetGrid,
  createTextColumn,
  intColumn,
  keyColumn
} from 'react-datasheet-grid';
import type { Column } from 'react-datasheet-grid';
import 'react-datasheet-grid/dist/style.css';
import { fetchPageJson } from '../lib/atlas-rpc';

// ── Types ─────────────────────────────────────────────────────────────────────

type NewPoSheet = 'asset' | 'accessories';

type NewPoFieldPatch = {
  itemName?: string;
  serialNumber?: string;
  barcode?: string;
  category?: string;
  quantity?: number | null;
  remarkFor?: string;
  invoiceNumber?: string;
  orderNumber?: string;
  account?: string;
  department?: string;
  remark?: string;
};

type NewPoEntry = {
  id: string;
  sheetName: 'ASSET' | 'ACCESSORIES';
  displayOrder: number;
  itemName: string;
  serialNumber: string;
  barcode: string;
  category: string;
  quantity: number | null;
  remarkFor: string;
  invoiceNumber: string;
  orderNumber: string;
  account: string;
  department: string;
  remark: string;
  generatedTag: string;
  syncStatus: string;
  syncNote: string;
  syncedAssetId: string;
  syncedAssetTag: string;
  syncedQuantity: number | null;
  lastSyncedAt: string;
  createdByEmail: string;
  updatedByEmail: string;
  createdAt: string;
  updatedAt: string;
  requiredFields: Array<{ key: string; label: string }>;
  missingFields: Array<{ key: string; label: string }>;
  readinessPct: number;
  isReady: boolean;
};

type NewPoSummaryBucket = {
  total: number;
  draft: number;
  pending: number;
  blocked: number;
  synced: number;
};

type NewPoListResponse = {
  items: NewPoEntry[];
  meta: { page: number; pageSize: number; total: number; pageCount: number };
  summary: { asset: NewPoSummaryBucket; accessories: NewPoSummaryBucket };
};

type NewPoMutationResponse = { ok: boolean; item: NewPoEntry };
type NewPoDeleteResponse = { ok: boolean; deletedId: string; deletedBy?: string };
type NewPoBulkCreateResponse = { ok: boolean; items: NewPoEntry[]; count: number };
type NewPoBulkUpdateResponse = { ok: boolean; items: NewPoEntry[]; count: number };
type NewPoBulkDeleteResponse = {
  ok: boolean;
  deletedIds: string[];
  deletedCount: number;
  requestedCount: number;
  notFoundIds: string[];
  deletedBy?: string;
};

type NewPoOptionsResponse = {
  ok: boolean;
  catalog: { items: Array<{ name: string; category: string }>; categories: string[] };
  masterReference: { accounts: string[]; departments: string[]; accountDeptMap: Record<string, string[]> };
};

const ASSET_EDITABLE_COL_MAP: Record<number, keyof NewPoFieldPatch> = {
  1: 'itemName',
  2: 'serialNumber',
  3: 'barcode',
  4: 'category',
  5: 'quantity',
  6: 'remarkFor',
  7: 'invoiceNumber',
  8: 'orderNumber',
  9: 'account',
  10: 'department',
  11: 'remark'
};

const ACCESSORIES_EDITABLE_COL_MAP: Record<number, keyof NewPoFieldPatch> = {
  1: 'itemName',
  3: 'category',
  4: 'quantity',
  5: 'remarkFor',
  6: 'invoiceNumber',
  7: 'orderNumber',
  8: 'account',
  9: 'department',
  10: 'remark'
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(v: string) {
  return String(v || '').trim().toLowerCase();
}

function formatRelativeTime(value: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  const diff = Math.round((Date.now() - parsed.getTime()) / 60000);
  if (diff <= 0) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  const h = Math.round(diff / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function syncTone(status: string) {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'SYNCED') return 'xls-chip--synced';
  if (s === 'BLOCKED') return 'xls-chip--blocked';
  if (s === 'PENDING') return 'xls-chip--pending';
  return 'xls-chip--draft';
}

function emptySummary(): NewPoListResponse['summary'] {
  return {
    asset: { total: 0, draft: 0, pending: 0, blocked: 0, synced: 0 },
    accessories: { total: 0, draft: 0, pending: 0, blocked: 0, synced: 0 }
  };
}

// Stable outside component — does not depend on props/state
const dsgText = createTextColumn<string>({ continuousUpdates: true, deletedValue: '' });

// ── Read-only info columns ─────────────────────────────────────────────────────

type EntryRow = {
  syncStatus: string;
  syncNote: string;
  missingFields: Array<{ key: string; label: string }>;
  readinessPct: number;
  createdByEmail: string;
  updatedByEmail: string;
};

function SyncStatusCell({ rowData }: { rowData: EntryRow }) {
  const tone = syncTone(rowData.syncStatus);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', height: '100%' }}>
      <span className={`xls-chip ${tone}`}>{rowData.syncStatus || 'DRAFT'}</span>
      <div className="xls-prog"><span style={{ width: `${rowData.readinessPct}%` }} /></div>
      <small style={{ fontSize: '0.65rem', color: '#65748d' }}>{rowData.readinessPct}%</small>
    </div>
  );
}

function MissingCell({ rowData }: { rowData: EntryRow }) {
  const missing = Array.isArray(rowData.missingFields) ? rowData.missingFields : [];
  if (missing.length === 0) {
    return <span className="xls-info-ok">✓ Complete</span>;
  }
  return (
    <span className="xls-info-missing" title={rowData.syncNote || ''}>
      {missing.map((f) => f.label).join(', ')}
    </span>
  );
}

function mkInfoCol<T extends EntryRow>(
  Comp: (p: { rowData: T }) => ReactElement,
  copyFn: (rowData: T) => string,
  opts: Omit<Partial<Column<T, any, any>>, 'component' | 'copyValue' | 'deleteValue' | 'pasteValue' | 'isCellEmpty' | 'disabled'>
): Partial<Column<T, any, any>> {
  return {
    ...opts,
    disabled: true,
    component: (props: { rowData: T; [k: string]: any }) => <Comp rowData={props.rowData} />,
    copyValue: ({ rowData }: { rowData: T }) => copyFn(rowData),
    deleteValue: ({ rowData }: { rowData: T }) => rowData,
    pasteValue: ({ rowData }: { rowData: T }) => rowData,
    isCellEmpty: () => false,
  };
}

// ── Default column widths ────────────────────────────────────────────────────
const DEFAULT_WIDTHS: Record<string, number> = {
  '#': 48,
  itemName: 215,
  quantity: 72,
  remarkFor: 130,
  invoiceNumber: 130,
  orderNumber: 120,
  account: 195,
  department: 180,
  serialNumber: 160,
  barcode: 145,
  category: 145,
  remark: 200,
  generatedTag: 120,
  status: 170,
  kurang: 230,
  keterangan: 270,
  createdByEmail: 170,
  updatedByEmail: 170,
  deleteAction: 78,
};

// ── Column ID order (user columns, DOM order; gutter is always DOM index 0) ──
// Used to compute nth-child positions for CSS-injection resize.
const ASSET_COL_DOM_ORDER = [
  '#', 'itemName', 'serialNumber', 'barcode', 'category', 'quantity', 'remarkFor',
  'invoiceNumber', 'orderNumber', 'account', 'department', 'remark',
  'status', 'kurang', 'keterangan', 'createdByEmail', 'updatedByEmail', 'deleteAction',
] as const;

const ACCESSORIES_COL_DOM_ORDER = [
  '#', 'itemName', 'generatedTag', 'category', 'quantity', 'remarkFor',
  'invoiceNumber', 'orderNumber', 'account', 'department', 'remark',
  'status', 'kurang', 'keterangan', 'createdByEmail', 'updatedByEmail', 'deleteAction',
] as const;

// Builds CSS with !important overrides so resize is visual-instant (bypasses
// DSG\'s virtualizer + React render cycle entirely during drag).
function computeResizeCSS(
  id: string,
  newWidth: number,
  sheet: 'asset' | 'accessories',
  colWidths: Record<string, number>,
): string {
  const GUTTER_W = 40;
  const order = (sheet === 'asset' ? ASSET_COL_DOM_ORDER : ACCESSORIES_COL_DOM_ORDER) as readonly string[];
  const targetIdx = order.indexOf(id);
  if (targetIdx < 0) return '';

  const widths = order.map((colId, i) =>
    i === targetIdx ? newWidth : (colWidths[colId] ?? DEFAULT_WIDTHS[colId] ?? 120)
  );
  const totalW = GUTTER_W + widths.reduce((s, w) => s + w, 0);
  const targetNth = targetIdx + 2; // +1 for gutter, +1 for nth-child 1-base

  let css = `.xls-po-datagrid .dsg-row > :nth-child(${targetNth}) { width: ${newWidth}px !important; }\n`;
  for (let j = targetIdx + 1; j < widths.length; j++) {
    const left = GUTTER_W + widths.slice(0, j).reduce((s, w) => s + w, 0);
    css += `.xls-po-datagrid .dsg-row > :nth-child(${j + 2}) { left: ${left}px !important; }\n`;
  }
  css += `.xls-po-datagrid .dsg-container > div { width: ${totalW}px !important; }\n`;
  css += `.xls-po-datagrid .dsg-row { width: ${totalW}px !important; }\n`;
  return css;
}

// ── Resizable column header ───────────────────────────────────────────────────
// Defined OUTSIDE component for stable function identity.
// During drag: injects CSS !important rules directly → zero React re-renders,
// true 60 fps real-time resize. Commits to state only on mouseUp.
type ResizableHeaderProps = {
  id: string;
  label: string;
  colWidthsRef: React.MutableRefObject<Record<string, number>>;
  setColWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  activeSheetRef: React.MutableRefObject<'asset' | 'accessories'>;
};

function ResizableHeader({ id, label, colWidthsRef, setColWidths, activeSheetRef }: ResizableHeaderProps) {
  const dragRef = useRef<{ startX: number; startW: number; curW: number; sheet: 'asset' | 'accessories' } | null>(null);

  function onHandleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    (e.nativeEvent as MouseEvent & { stopImmediatePropagation?(): void }).stopImmediatePropagation?.();

    const sheet = activeSheetRef.current;
    const startW = colWidthsRef.current[id] ?? DEFAULT_WIDTHS[id] ?? 120;
    dragRef.current = { startX: e.clientX, startW, curW: startW, sheet };

    let styleEl = document.getElementById('xls-col-resize-style') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'xls-col-resize-style';
      document.head.appendChild(styleEl);
    }
    const el = styleEl;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      d.curW = Math.max(48, d.startW + Math.round(ev.clientX - d.startX));
      el.textContent = computeResizeCSS(id, d.curW, d.sheet, colWidthsRef.current);
    }

    function onUp() {
      const d = dragRef.current;
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);

      if (!d || d.curW === d.startW) {
        el.textContent = '';
        return;
      }

      const targetW = d.curW;
      const sheet = d.sheet;

      // Commit to React state. DSG uses @tanstack/react-virtual whose
      // colVirtualizer.measure() is called inside a useEffect (fires AFTER paint),
      // so DSG needs 2 full render+paint cycles before inline styles are correct.
      // Clearing the CSS override too early causes a visible snap-back.
      //
      // Strategy: keep CSS override alive and poll the actual DSG header cell's
      // inline style.width until it matches our target width, then clear.
      setColWidths(prev => ({ ...prev, [id]: targetW }));

      const order = (sheet === 'asset' ? ASSET_COL_DOM_ORDER : ACCESSORIES_COL_DOM_ORDER) as readonly string[];
      const nth = order.indexOf(id) + 2; // +1 gutter col, +1 for 1-based nth-child
      let tries = 0;

      function waitForDSG() {
        tries++;
        const cells = document.querySelectorAll<HTMLElement>(
          `.xls-po-datagrid .dsg-row-header > :nth-child(${nth})`
        );
        for (const cell of Array.from(cells)) {
          const cellW = parseFloat(cell.style.width || '0');
          if (Math.abs(cellW - targetW) < 1) {
            // DSG has painted the new width — safe to drop the CSS override.
            el.textContent = '';
            return;
          }
        }
        // Retry next frame; bail after ~60 frames (~1 s) as a safety fallback.
        if (tries < 60) {
          requestAnimationFrame(waitForDSG);
        } else {
          el.textContent = '';
        }
      }
      requestAnimationFrame(waitForDSG);
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }

  return (
    <div className="xls-rh-wrap">
      <span className="xls-rh-label">{label}</span>
      <div className="xls-col-resize-handle" onMouseDown={onHandleMouseDown} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function NewPoPortal() {
  const MAX_FLUSH_CONCURRENCY = 6;
  const DELETE_BATCH_SIZE = 250;

  const [activeSheet, setActiveSheet] = useState<NewPoSheet>('asset');
  const [rows, setRows] = useState<NewPoEntry[]>([]);
  const [summary, setSummary] = useState<NewPoListResponse['summary']>(emptySummary());
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<NewPoListResponse['meta'] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
  const [deletingRows, setDeletingRows] = useState<Record<string, boolean>>({});
  const [gridFocused, setGridFocused] = useState(false);
  const [activeCellRow, setActiveCellRow] = useState<number | null>(null);
  const [activeCellCol, setActiveCellCol] = useState<number | null>(null);
  const [selectionRows, setSelectionRows] = useState<{ min: number; max: number } | null>(null);
  const [rowContextMenu, setRowContextMenu] = useState<{ x: number; y: number; rowIndex: number } | null>(null);
  const gridFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  // Refs mirror state so event handlers / closures always see latest values
  const activeCellRowRef = useRef<number | null>(null);
  activeCellRowRef.current = activeCellRow;
  const activeCellColRef = useRef<number | null>(null);
  activeCellColRef.current = activeCellCol;
  const selectionRowsRef = useRef<{ min: number; max: number } | null>(null);
  selectionRowsRef.current = selectionRows;
  // Snapshot taken at right-click time — DSG may reset selection after contextmenu event
  const contextSelectionSnapshotRef = useRef<{ min: number; max: number } | null>(null);
  const gridFocusedRef = useRef(false);
  gridFocusedRef.current = gridFocused;
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>({
    type: 'info',
    text: 'Click any cell to edit — Tab / Enter / Arrow keys to navigate between cells. Ctrl+C / Ctrl+V copies between cells.'
  });
  const [lastRefreshAt, setLastRefreshAt] = useState('');
  const [itemOptions, setItemOptions] = useState<Array<{ name: string; category: string }>>([]);
  const [accountOptions, setAccountOptions] = useState<string[]>([]);
  const [accountDeptMap, setAccountDeptMap] = useState<Record<string, string[]>>({});
  const [gridHeight, setGridHeight] = useState(560);

  const rowsRef = useRef<NewPoEntry[]>([]);
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const pendingPatchRef = useRef<Record<string, NewPoFieldPatch>>({});
  const timerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushQueueRef = useRef<string[]>([]);
  const flushQueuedRef = useRef<Set<string>>(new Set());
  const flushRunningRef = useRef(0);
  const bulkPasteInProgressRef = useRef(false);
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);

  // Kept in sync every render — read by drag handlers for current widths.
  const colWidthsRef = useRef<Record<string, number>>(DEFAULT_WIDTHS);
  colWidthsRef.current = colWidths;
  const activeSheetRef = useRef<'asset' | 'accessories'>('asset');
  activeSheetRef.current = activeSheet;

  // Shorthand factory — ResizableHeader defined outside component for stable identity.
  function rh(id: string, label: string) {
    return <ResizableHeader id={id} label={label} colWidthsRef={colWidthsRef} setColWidths={setColWidths} activeSheetRef={activeSheetRef} />;
  }

  const activeSummary = activeSheet === 'asset' ? summary.asset : summary.accessories;
  const isSaving = Object.values(savingRows).some(Boolean);

  // ── Data fetching ───────────────────────────────────────────────────────────

  async function loadRows(opts?: { silent?: boolean; skipRows?: boolean }) {
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({
        sheet: activeSheet,
        search: searchQuery,
        page: String(page),
        pageSize: '500'
      });
      const result = await fetchPageJson<NewPoListResponse>(`/api/app/admin/new-po/items?${params.toString()}`);
      // skipRows: only refresh summary/meta counts — do NOT overwrite local row state.
      // Used after paste so badge counts update without reverting correctly-set local data.
      if (!opts?.skipRows) {
        setRows(result.items || []);
      }
      setSummary(result.summary || emptySummary());
      setMeta(result.meta || null);
      setLastRefreshAt(new Date().toISOString());
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load.' });
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }

  async function loadOptions() {
    setOptionsLoading(true);
    try {
      const result = await fetchPageJson<NewPoOptionsResponse>('/api/app/admin/new-po/options');
      setItemOptions(Array.isArray(result?.catalog?.items) ? result.catalog.items : []);
      setAccountOptions(Array.isArray(result?.masterReference?.accounts) ? result.masterReference.accounts : []);
      setAccountDeptMap(
        result?.masterReference?.accountDeptMap && typeof result.masterReference.accountDeptMap === 'object'
          ? result.masterReference.accountDeptMap
          : {}
      );
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load dropdown options.' });
    } finally {
      setOptionsLoading(false);
    }
  }

  async function createRow() {
    setCreating(true);
    try {
      const result = await fetchPageJson<NewPoMutationResponse>('/api/app/admin/new-po/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet: activeSheet })
      });
      setRows((prev) => [...prev, result.item].sort((a, b) => a.displayOrder - b.displayOrder));
      scheduleSilentReload(250);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create row.' });
    } finally {
      setCreating(false);
    }
  }

  async function createRowsBulk(count: number, opts?: { silent?: boolean }) {
    const safeCount = Math.max(1, Math.min(2000, Math.trunc(Number(count) || 1)));
    const result = await fetchPageJson<NewPoBulkCreateResponse>('/api/app/admin/new-po/items/bulk-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: activeSheetRef.current, count: safeCount })
    });

    const newItems = Array.isArray(result.items) ? result.items : [];
    if (!newItems.length) {
      throw new Error(`Server created 0 rows (requested ${safeCount}). Check server logs.`);
    }
    const nextRows = [...rowsRef.current, ...newItems].sort((a, b) => a.displayOrder - b.displayOrder);
    rowsRef.current = nextRows;
    setRows(nextRows);
    if (!opts?.silent) {
      scheduleSilentReload(200);
    }
    return newItems;
  }

  async function deleteRows(removedRows: NewPoEntry[]) {
    if (!removedRows.length) return;
    const ids = removedRows.map((r) => r.id);
    setDeletingRows((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = true;
      return next;
    });
    try {
      for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
        const chunk = ids.slice(i, i + DELETE_BATCH_SIZE);
        await fetchPageJson<NewPoBulkDeleteResponse>('/api/app/admin/new-po/items/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: chunk })
        });
      }
      setMessage({
        type: 'success',
        text: `${removedRows.length} row${removedRows.length > 1 ? 's' : ''} deleted.`
      });
      scheduleSilentReload();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to delete row.' });
      scheduleSilentReload(200);
    } finally {
      setDeletingRows((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
    }
  }

  function getContextTargetRows(): NewPoEntry[] {
    const sourceRows = rowsRef.current;
    if (!sourceRows.length) return [];

    // Use snapshot taken at right-click time (before DSG reset selection)
    const sel = contextSelectionSnapshotRef.current ?? selectionRowsRef.current;
    if (sel) {
      const start = Math.max(0, Math.min(sel.min, sel.max));
      const end = Math.min(sourceRows.length - 1, Math.max(sel.min, sel.max));
      const picked = sourceRows.slice(start, end + 1).filter((row) => !deletingRows[row.id]);
      if (picked.length) return picked;
    }

    const targetRow = activeCellRowRef.current;
    if (targetRow === null || targetRow < 0 || targetRow >= sourceRows.length) return [];

    const row = sourceRows[targetRow];
    return row ? [row] : [];
  }

  function handleDeleteRowsImmediate(targetRows: NewPoEntry[]) {
    if (!targetRows.length) {
      setRowContextMenu(null);
      return;
    }

    const targetIds = new Set(targetRows.map((row) => row.id));
    for (const row of targetRows) {
      delete pendingPatchRef.current[row.id];
      if (timerRef.current[row.id]) {
        clearTimeout(timerRef.current[row.id]);
        delete timerRef.current[row.id];
      }
    }

    const nextRows = rowsRef.current.filter((row) => !targetIds.has(row.id));
    rowsRef.current = nextRows;
    setRows(nextRows);
    setRowContextMenu(null);
    void deleteRows(targetRows);
  }

  function handleDeleteFromIcon(row: NewPoEntry) {
    handleDeleteRowsImmediate([row]);
  }

  function handleGridContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    // Snapshot selection NOW — DSG will reset it after this event
    contextSelectionSnapshotRef.current = selectionRowsRef.current;

    const contextRows = getContextTargetRows();
    if (!contextRows.length) {
      setRowContextMenu(null);
      return;
    }

    const targetRow = rowsRef.current.findIndex((row) => row.id === contextRows[0].id);
    if (targetRow < 0) {
      setRowContextMenu(null);
      return;
    }

    setRowContextMenu({ x: event.clientX, y: event.clientY, rowIndex: targetRow });
  }

  function handleDeleteFromContextMenu() {
    const targetRows = getContextTargetRows();
    setRowContextMenu(null);
    contextSelectionSnapshotRef.current = null;
    if (!targetRows.length) return;
    handleDeleteRowsImmediate(targetRows);
  }

  function handleInsertRowFromContextMenu() {
    setRowContextMenu(null);
    void createRow();
  }

  function handleCopyFromContextMenu() {
    setRowContextMenu(null);
    document.execCommand('copy');
  }

  function handlePasteFromContextMenu() {
    setRowContextMenu(null);
    navigator.clipboard.readText().then((text) => {
      if (text && (text.includes('\t') || text.includes('\n'))) {
        void applyClipboardPaste(text);
      }
    }).catch(() => {});
  }

  function handleDeleteAllRows() {
    const allRows = rowsRef.current.filter((row) => !deletingRows[row.id]);
    if (!allRows.length) return;
    if (!window.confirm(`Delete all ${allRows.length} rows on this page?`)) return;
    handleDeleteRowsImmediate(allRows);
  }

  // ── Save logic ──────────────────────────────────────────────────────────────

  async function flushRow(entryId: string) {
    if (!rowsRef.current.some((row) => row.id === entryId)) return;
    const pending = pendingPatchRef.current[entryId];
    if (!pending || !Object.keys(pending).length) return;
    delete pendingPatchRef.current[entryId];
    if (timerRef.current[entryId]) { clearTimeout(timerRef.current[entryId]); delete timerRef.current[entryId]; }
    setSavingRows((prev) => ({ ...prev, [entryId]: true }));
    try {
      const result = await fetchPageJson<NewPoMutationResponse>(
        `/api/app/admin/new-po/items/${encodeURIComponent(entryId)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending) }
      );
      setRows((prev) => prev.map((r) => (r.id === entryId ? result.item : r)));
      scheduleSilentReload(1200);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save row.' });
      scheduleSilentReload(250);
    } finally {
      setSavingRows((prev) => { const next = { ...prev }; delete next[entryId]; return next; });
    }
  }

  function scheduleSilentReload(delay = 700) {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      // Don't reload during paste — would overwrite correctly-set local state.
      if (bulkPasteInProgressRef.current) return;
      void loadRows({ silent: true });
    }, delay);
  }

  function pumpFlushQueue() {
    while (flushRunningRef.current < MAX_FLUSH_CONCURRENCY && flushQueueRef.current.length) {
      const nextEntryId = flushQueueRef.current.shift();
      if (!nextEntryId) break;
      flushQueuedRef.current.delete(nextEntryId);
      flushRunningRef.current += 1;
      void flushRow(nextEntryId).finally(() => {
        flushRunningRef.current -= 1;
        pumpFlushQueue();
      });
    }
  }

  function enqueueFlush(entryId: string) {
    if (flushQueuedRef.current.has(entryId)) return;
    flushQueuedRef.current.add(entryId);
    flushQueueRef.current.push(entryId);
    pumpFlushQueue();
  }

  async function applyClipboardPaste(rawText: string) {
    // Guard: prevent concurrent calls (e.g., both keydown .then() and paste event firing)
    if (bulkPasteInProgressRef.current) return;
    bulkPasteInProgressRef.current = true;
    setMessage({ type: 'info', text: 'Pasting rows… please wait.' });
    let hadChunkError = false;
    try {
      const lines = rawText.replace(/\r/g, '').split('\n');
      if (lines.length && lines[lines.length - 1] === '') {
        lines.pop();
      }
      if (!lines.length) return;

      const matrix = lines.map((line) => line.split('\t'));
      // Always paste starting from column 1 (leftmost data column).
      // The active cell column is irrelevant — Excel data always has all columns.
      // startRow: use active cell row if set, otherwise row 0 (top of sheet).
      const startRow = Math.max(0, activeCellRowRef.current ?? 0);
      const startCol = 1;
      const sheet = activeSheetRef.current;
      const editableMap = sheet === 'asset' ? ASSET_EDITABLE_COL_MAP : ACCESSORIES_EDITABLE_COL_MAP;

      // Snapshot BEFORE any async operation so we don't depend on rowsRef
      // being re-synced by React's useEffect after setRows() is called
      const existingRows = rowsRef.current.slice();
      const requiredRows = startRow + matrix.length;
      const missingRows = requiredRows - existingRows.length;

      setMessage({ type: 'info', text: `Pasting ${matrix.length} rows${missingRows > 0 ? ` (creating ${missingRows} new)` : ''}…` });

      // Build the definitive row list directly from snapshot + API return value.
      // Never re-read rowsRef.current after an await — it may have been
      // overwritten by React's useEffect({ rowsRef.current = rows }) during
      // a concurrent re-render triggered by setRows() inside createRowsBulk.
      let allRows = existingRows;
      if (missingRows > 0) {
        const newItems = await createRowsBulk(missingRows, { silent: true });
        allRows = [...existingRows, ...newItems].sort((a, b) => a.displayOrder - b.displayOrder);
        // Keep rowsRef in sync so other code sees the full list
        rowsRef.current = allRows;
      }

      const updates: Array<{ id: string; patch: NewPoFieldPatch }> = [];

      for (let r = 0; r < matrix.length; r += 1) {
        const rowIndex = startRow + r;
        if (rowIndex < 0 || rowIndex >= allRows.length) continue;
        const baseRow = allRows[rowIndex];
        const patch: NewPoFieldPatch = {};

        for (let c = 0; c < matrix[r].length; c += 1) {
          const colIndex = startCol + c;
          const key = editableMap[colIndex];
          if (!key) continue;

          const rawValue = matrix[r][c] ?? '';
          if (key === 'quantity') {
            const numeric = rawValue.trim() === '' ? null : Number(rawValue);
            patch[key] = Number.isFinite(numeric) ? Math.trunc(numeric as number) : null;
          } else if (key === 'barcode') {
            patch[key] = rawValue.trim().toUpperCase();
          } else {
            patch[key] = rawValue;
          }
        }

        if (!Object.keys(patch).length) continue;

        let updatedRow: NewPoEntry = {
          ...baseRow,
          ...patch
        };

        if (patch.itemName !== undefined) {
          const linked = itemOptions.find((i) => normalize(i.name) === normalize(String(patch.itemName ?? '')));
          if (linked?.category && (patch.category === undefined || String(patch.category || '').trim() === '')) {
            updatedRow = { ...updatedRow, category: linked.category };
            patch.category = linked.category;
          }
        }

        if (patch.account !== undefined) {
          const depts = accountDeptMap[String(updatedRow.account || '')] || [];
          if (updatedRow.department && !depts.includes(updatedRow.department)) {
            updatedRow = { ...updatedRow, department: '' };
            patch.department = '';
          }
        }

        allRows[rowIndex] = updatedRow;
        updates.push({ id: baseRow.id, patch });
      }

      // Reflect pasted data into UI immediately (all rows, including new ones)
      rowsRef.current = allRows;
      setRows([...allRows]);

      // Save to server in chunks
      const BULK_UPDATE_CHUNK_SIZE = 40;
      for (let index = 0; index < updates.length; index += BULK_UPDATE_CHUNK_SIZE) {
        const chunk = updates.slice(index, index + BULK_UPDATE_CHUNK_SIZE);
        setMessage({ type: 'info', text: `Saving rows ${index + 1}–${Math.min(index + BULK_UPDATE_CHUNK_SIZE, updates.length)} of ${updates.length}…` });
        try {
          const result = await fetchPageJson<NewPoBulkUpdateResponse>('/api/app/admin/new-po/items/bulk-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates: chunk })
          });

          if (Array.isArray(result.items) && result.items.length) {
            const map = new Map(result.items.map((item) => [item.id, item]));
            rowsRef.current = rowsRef.current.map((row) => map.get(row.id) || row);
            setRows((prev) => prev.map((row) => map.get(row.id) || row));
          }
        } catch (chunkErr) {
          hadChunkError = true;
          console.error('Bulk update chunk error:', chunkErr);
        }
      }

      setMessage({
        type: 'success',
        text: `Pasted ${matrix.length} row${matrix.length > 1 ? 's' : ''} into New PO.`
      });

      // Only reload from server if a chunk had an error — otherwise trust local state.
      // Unconditional loadRows was overwriting correct local state with stale DB state.
      if (hadChunkError) {
        setTimeout(() => { void loadRows({ silent: true }); }, 400);
      }
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to paste rows.' });
      setTimeout(() => { void loadRows({ silent: true }); }, 300);
    } finally {
      setTimeout(() => {
        bulkPasteInProgressRef.current = false;
        // Refresh summary/meta badge counts from server (skipRows = true so we
        // do NOT overwrite the correctly-set local row state with server data).
        void loadRows({ silent: true, skipRows: true });
      }, 900);
    }
  }

  function queueSave(entryId: string, patch: NewPoFieldPatch) {
    pendingPatchRef.current[entryId] = { ...(pendingPatchRef.current[entryId] || {}), ...patch };
    if (timerRef.current[entryId]) clearTimeout(timerRef.current[entryId]);
    timerRef.current[entryId] = setTimeout(() => enqueueFlush(entryId), 700);
  }

  // ── Grid row change handler ─────────────────────────────────────────────────

  function handleRowsChange(newRows: NewPoEntry[]) {
    // During bulk paste, completely ignore DSG's onChange to prevent conflicts
    if (bulkPasteInProgressRef.current) {
      return;
    }

    const prevRows = rowsRef.current;
    const newIds = new Set(newRows.map((row) => row.id));
    const removedRows = prevRows.filter((row) => !newIds.has(row.id));
    if (removedRows.length > 0) {
      // Guard against transient grid snapshots during heavy paste operations.
      // Only block if a bulk paste is in progress — legitimate user deletes should go through.
      if (bulkPasteInProgressRef.current && removedRows.length > 5) {
        rowsRef.current = prevRows;
        setRows(prevRows);
        return;
      }

      for (const row of removedRows) {
        delete pendingPatchRef.current[row.id];
        if (timerRef.current[row.id]) {
          clearTimeout(timerRef.current[row.id]);
          delete timerRef.current[row.id];
        }
      }

      rowsRef.current = newRows;
      setRows(newRows);
      void deleteRows(removedRows);
      return;
    }

    const editableKeys: (keyof NewPoFieldPatch)[] = [
      'itemName', 'serialNumber', 'barcode', 'category', 'quantity',
      'remarkFor', 'invoiceNumber', 'orderNumber', 'account', 'department', 'remark'
    ];

    const patchedRows = newRows.map((row, idx) => {
      const oldRow = prevRows[idx];
      if (!oldRow || row.id !== oldRow.id) return row;

      let next = row;
      if (row.itemName !== oldRow.itemName) {
        const linked = itemOptions.find((i) => normalize(i.name) === normalize(row.itemName));
        if (linked?.category) next = { ...next, category: linked.category };
      }

      if (row.account !== oldRow.account) {
        const depts = accountDeptMap[row.account] || [];
        if (next.department && !depts.includes(next.department)) {
          next = { ...next, department: '' };
        }
      }

      const patch: NewPoFieldPatch = {};
      for (const f of editableKeys) {
        if (next[f] !== oldRow[f]) (patch as Record<string, unknown>)[f] = next[f];
      }
      if (Object.keys(patch).length > 0) queueSave(next.id, patch);
      return next;
    });

    rowsRef.current = patchedRows;
    setRows(patchedRows);
  }

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => { void loadRows(); }, [activeSheet, page]);
  useEffect(() => { void loadOptions(); }, []);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => {
    const t = setInterval(() => {
      if (bulkPasteInProgressRef.current) return;
      if (Object.keys(pendingPatchRef.current).length) return;
      if (flushRunningRef.current > 0 || flushQueueRef.current.length > 0) return;
      void loadRows({ silent: true });
    }, 8000);
    return () => clearInterval(t);
  }, [activeSheet, page, searchQuery]);
  // Intercept paste event in capture phase — fires before DSG's bubble-phase listener.
  // We use synchronous event.clipboardData (no HTTPS/permission needed).
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      // Block paste entirely while bulk paste is in progress
      if (bulkPasteInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      const target = event.target as HTMLElement | null;

      // Don't intercept search box
      if (target?.closest('.xls-po-search')) return;

      // Don't intercept active cell editor (input/textarea) — let DSG handle
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      const raw = event.clipboardData?.getData('text/plain') || '';
      // Only intercept tabular (multi-column or multi-row) clipboard data
      if (!raw || (!raw.includes('\t') && !raw.includes('\n'))) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void applyClipboardPaste(raw);
    }

    // Capture phase: fires before DSG's document bubble-phase paste listener
    document.addEventListener('paste', handlePaste, true);
    return () => {
      document.removeEventListener('paste', handlePaste, true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemOptions, accountDeptMap, loading]);
  useEffect(() => {
    if (!rowContextMenu) return;

    function close(event: MouseEvent) {
      // Don't close if click is inside the context menu itself
      if (contextMenuRef.current && contextMenuRef.current.contains(event.target as Node)) return;
      setRowContextMenu(null);
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setRowContextMenu(null);
      }
    }

    // Use BUBBLE phase (false) so menu button clicks fire first
    document.addEventListener('click', close, false);
    document.addEventListener('keydown', onEscape, true);
    document.addEventListener('scroll', () => setRowContextMenu(null), true);
    return () => {
      document.removeEventListener('click', close, false);
      document.removeEventListener('keydown', onEscape, true);
      document.removeEventListener('scroll', () => setRowContextMenu(null), true);
    };
  }, [rowContextMenu]);

  // Delete key shortcut: delete selected rows when grid is focused
  useEffect(() => {
    if (!gridFocused) return;
    function onKeyDown(event: KeyboardEvent) {
      // Only act on Delete key (not Backspace — that's used for cell editing)
      if (event.key !== 'Delete') return;
      if (event.repeat) return;
      // Don't intercept if user is typing in an input/textarea
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const targetRows = getContextTargetRows();
      if (!targetRows.length) return;
      if (targetRows.length > 1) {
        event.preventDefault();
        event.stopPropagation();
        handleDeleteRowsImmediate(targetRows);
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [gridFocused, selectionRows, activeCellRow, deletingRows]);

  useEffect(() => {
    return () => {
      Object.values(timerRef.current).forEach((t) => clearTimeout(t));
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  // Excel-like behavior: pressing Enter on the last row auto-creates a new row.
  useEffect(() => {
    if (!gridFocused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.repeat) return;
      if (creating || loading || optionsLoading) return;
      if (activeCellRow === null) return;

      const lastRowIndex = rowsRef.current.length - 1;
      if (lastRowIndex < 0 || activeCellRow !== lastRowIndex) return;

      event.preventDefault();
      event.stopPropagation();
      void createRow();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [gridFocused, activeCellRow, creating, loading, optionsLoading]);

  // Keep DataSheetGrid height synced to the actual wrapper size.
  // This removes the hardcoded 560px gap and keeps the sheet compact to pagination.
  useEffect(() => {
    if (!gridWrapRef.current) return;
    const el = gridWrapRef.current;
    const update = () => setGridHeight(Math.max(220, Math.floor(el.clientHeight)));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Column definitions ──────────────────────────────────────────────────────

  function w(id: string) { return colWidths[id] ?? DEFAULT_WIDTHS[id] ?? 120; }
  function fixedSize(id: string) {
    const width = w(id);
    return { basis: width, minWidth: width, maxWidth: width, grow: 0, shrink: 0 };
  }

  const infoColumns = useMemo<Array<Partial<Column<NewPoEntry, any, any>>>>(() => [
    mkInfoCol<NewPoEntry>(
      SyncStatusCell,
      (r) => r.syncStatus,
      { title: rh('status', 'Status'), ...fixedSize('status') }
    ),
    mkInfoCol<NewPoEntry>(
      MissingCell,
      (r) => r.missingFields.map((f) => f.label).join(', '),
      { title: rh('kurang', 'Missing Fields'), ...fixedSize('kurang') }
    ),
    {
      ...keyColumn('syncNote', dsgText),
      title: rh('keterangan', 'Sync Note'),
      ...fixedSize('keterangan'),
      disabled: true,
    },
    {
      ...keyColumn('createdByEmail', dsgText),
      title: rh('createdByEmail', 'Created By'),
      ...fixedSize('createdByEmail'),
      disabled: true,
    },
    {
      ...keyColumn('updatedByEmail', dsgText),
      title: rh('updatedByEmail', 'Updated By'),
      ...fixedSize('updatedByEmail'),
      disabled: true,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [colWidths]);

  const actionColumn = useMemo<Partial<Column<NewPoEntry, any, any>>>(() => ({
    title: 'Action',
    ...fixedSize('deleteAction'),
    disabled: true,
    component: ({ rowData }: { rowData: NewPoEntry }) => {
      const busy = Boolean(deletingRows[rowData.id]);
      return (
        <button
          type="button"
          className="xls-row-del-btn"
          disabled={busy}
          title="Delete row"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!busy) handleDeleteFromIcon(rowData);
          }}
        >
          {busy ? '…' : '🗑'}
        </button>
      );
    },
    copyValue: () => '',
    deleteValue: ({ rowData }: { rowData: NewPoEntry }) => rowData,
    pasteValue: ({ rowData }: { rowData: NewPoEntry }) => rowData,
    isCellEmpty: () => false,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [colWidths, deletingRows]);

  // Row-index column (not keyed to displayOrder — shows 1,2,3...)
  const rowIndexCol = useMemo<Partial<Column<NewPoEntry, any, any>>>(() => ({
    title: 'No',
    ...fixedSize('#'),
    disabled: true,
    component: ({ rowIndex }: { rowIndex: number; rowData: NewPoEntry }) => (
      <span className="xls-idx">{rowIndex + 1}</span>
    ),
    copyValue: ({ rowIndex }: { rowIndex: number }) => String(rowIndex + 1),
    deleteValue: ({ rowData }: { rowData: NewPoEntry }) => rowData,
    pasteValue: ({ rowData }: { rowData: NewPoEntry }) => rowData,
    isCellEmpty: () => false,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [colWidths]);

  const commonColumns = useMemo<Array<Partial<Column<NewPoEntry>>>>(() => [
    rowIndexCol,
    { ...keyColumn('itemName', dsgText), title: rh('itemName', 'Item'), ...fixedSize('itemName') },
    { ...keyColumn('quantity', intColumn), title: rh('quantity', 'Quantity'), ...fixedSize('quantity') },
    { ...keyColumn('remarkFor', dsgText), title: rh('remarkFor', 'Remark For'), ...fixedSize('remarkFor') },
    { ...keyColumn('invoiceNumber', dsgText), title: rh('invoiceNumber', 'Invoice Number'), ...fixedSize('invoiceNumber') },
    { ...keyColumn('orderNumber', dsgText), title: rh('orderNumber', 'PO'), ...fixedSize('orderNumber') },
    { ...keyColumn('account', dsgText), title: rh('account', 'Account'), ...fixedSize('account') },
    { ...keyColumn('department', dsgText), title: rh('department', 'Departement'), ...fixedSize('department') },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [colWidths, rowIndexCol]);

  const assetColumns = useMemo<Array<Partial<Column<NewPoEntry>>>>(() => [
    rowIndexCol,
    { ...keyColumn('itemName', dsgText), title: rh('itemName', 'Item'), ...fixedSize('itemName') },
    { ...keyColumn('serialNumber', dsgText), title: rh('serialNumber', 'Serial No.'), ...fixedSize('serialNumber') },
    { ...keyColumn('barcode', dsgText), title: rh('barcode', 'Barcode'), ...fixedSize('barcode') },
    { ...keyColumn('category', dsgText), title: rh('category', 'Category'), ...fixedSize('category') },
    { ...keyColumn('quantity', intColumn), title: rh('quantity', 'Quantity'), ...fixedSize('quantity') },
    { ...keyColumn('remarkFor', dsgText), title: rh('remarkFor', 'Remark For'), ...fixedSize('remarkFor') },
    { ...keyColumn('invoiceNumber', dsgText), title: rh('invoiceNumber', 'Invoice Number'), ...fixedSize('invoiceNumber') },
    { ...keyColumn('orderNumber', dsgText), title: rh('orderNumber', 'PO'), ...fixedSize('orderNumber') },
    { ...keyColumn('account', dsgText), title: rh('account', 'Account'), ...fixedSize('account') },
    { ...keyColumn('department', dsgText), title: rh('department', 'Departement'), ...fixedSize('department') },
    { ...keyColumn('remark', dsgText), title: rh('remark', 'Remark'), ...fixedSize('remark') },
    ...infoColumns,
    actionColumn,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rowIndexCol, infoColumns, actionColumn, colWidths]);

  const accessoriesColumns = useMemo<Array<Partial<Column<NewPoEntry>>>>(() => [
    rowIndexCol,
    { ...keyColumn('itemName', dsgText), title: rh('itemName', 'Item'), ...fixedSize('itemName') },
    { ...keyColumn('generatedTag', dsgText), title: rh('generatedTag', 'Tag'), ...fixedSize('generatedTag'), disabled: true },
    { ...keyColumn('category', dsgText), title: rh('category', 'Category'), ...fixedSize('category') },
    { ...keyColumn('quantity', intColumn), title: rh('quantity', 'Quantity'), ...fixedSize('quantity') },
    { ...keyColumn('remarkFor', dsgText), title: rh('remarkFor', 'Remark For'), ...fixedSize('remarkFor') },
    { ...keyColumn('invoiceNumber', dsgText), title: rh('invoiceNumber', 'Invoice Number'), ...fixedSize('invoiceNumber') },
    { ...keyColumn('orderNumber', dsgText), title: rh('orderNumber', 'PO'), ...fixedSize('orderNumber') },
    { ...keyColumn('account', dsgText), title: rh('account', 'Account'), ...fixedSize('account') },
    { ...keyColumn('department', dsgText), title: rh('department', 'Departement'), ...fixedSize('department') },
    { ...keyColumn('remark', dsgText), title: rh('remark', 'Remark'), ...fixedSize('remark') },
    ...infoColumns,
    actionColumn,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rowIndexCol, infoColumns, actionColumn, colWidths]);

  // Keep the grid mounted while column widths change.
  // Remounting on every drag frame breaks pointer capture, so resize stops mid-drag.
  const gridLayoutKey = activeSheet;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="xls-po-shell">
      {/* Top bar: title + live KPI badges + actions */}
      <div className="xls-po-topbar">
        <div className="xls-po-title">
          <h2>New PO <span>— Live Intake</span></h2>
          <div className="xls-po-kpi-strip">
            <span className="xls-kpi xls-kpi--total">{activeSummary.total} rows</span>
            <span className="xls-kpi xls-kpi--synced">{activeSummary.synced} synced</span>
            <span className="xls-kpi xls-kpi--pending">{activeSummary.pending} pending</span>
            {activeSummary.blocked > 0 && <span className="xls-kpi xls-kpi--blocked">{activeSummary.blocked} blocked</span>}
          </div>
        </div>
        <div className="xls-po-acts">
          <button className="atlas-toolbar-btn subtle" onClick={() => void loadRows()} disabled={loading} type="button">
            ↺ Refresh
          </button>
          <button className="atlas-toolbar-btn" onClick={() => void createRow()} disabled={creating || optionsLoading} type="button">
            {creating ? 'Adding…' : '+ Add Row'}
          </button>
          {rows.length > 0 && (
            <button className="atlas-toolbar-btn subtle" onClick={handleDeleteAllRows} disabled={loading} type="button" style={{ color: '#b91c1c' }}>
              🗑 Delete All
            </button>
          )}
        </div>
      </div>

      {/* Dismissible info / error banner */}
      {message ? (
        <div className={`xls-po-msg xls-po-msg--${message.type}`} role="status">
          <span>{message.text}</span>
          <button className="xls-po-msg-close" onClick={() => setMessage(null)} type="button" aria-label="Dismiss">×</button>
        </div>
      ) : null}

      {/* Sheet tabs + search */}
      <div className="xls-po-toolbar">
        <div className="xls-po-tabs">
          <button className={activeSheet === 'asset' ? 'is-active' : ''} onClick={() => { setActiveSheet('asset'); setPage(1); }} type="button">
            Asset Sheet
          </button>
          <button className={activeSheet === 'accessories' ? 'is-active' : ''} onClick={() => { setActiveSheet('accessories'); setPage(1); }} type="button">
            Accessories Sheet
          </button>
        </div>
        <div className="xls-po-search">
          <input
            placeholder={activeSheet === 'asset' ? 'Search item, serial, barcode, PO…' : 'Search item, tag, PO…'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); void loadRows(); } }}
          />
          <button className="atlas-toolbar-btn subtle" onClick={() => { setPage(1); void loadRows(); }} disabled={loading} type="button">
            Search
          </button>
        </div>
      </div>

      {/* Spreadsheet-like data grid */}
      <div className="xls-po-grid-wrap" ref={gridWrapRef} onContextMenuCapture={handleGridContextMenu}>
        {loading ? (
          <div className="xls-po-loading">Loading rows…</div>
        ) : (
          <DataSheetGrid
            key={gridLayoutKey}
            className="xls-po-datagrid"
            value={rows}
            onChange={handleRowsChange}
            onFocus={() => {
              if (gridFocusTimerRef.current) { clearTimeout(gridFocusTimerRef.current); gridFocusTimerRef.current = null; }
              setGridFocused(true);
            }}
            onBlur={() => {
              // Debounce blur — DSG fires blur/focus on internal cell transitions
              if (gridFocusTimerRef.current) clearTimeout(gridFocusTimerRef.current);
              gridFocusTimerRef.current = setTimeout(() => { setGridFocused(false); gridFocusTimerRef.current = null; }, 150);
            }}
            onActiveCellChange={(opts: { cell: { row?: number } | null }) => {
              const cell = opts?.cell;
              setActiveCellRow(typeof cell?.row === 'number' ? cell.row : null);
              setActiveCellCol(typeof (cell as { col?: number } | null)?.col === 'number' ? (cell as { col?: number }).col ?? null : null);
            }}
            onSelectionChange={(opts: { selection: { min: { row: number }; max: { row: number } } | null }) => {
              const selection = opts?.selection;
              if (!selection || typeof selection.min?.row !== 'number' || typeof selection.max?.row !== 'number') {
                setSelectionRows(null);
                return;
              }
              setSelectionRows({ min: selection.min.row, max: selection.max.row });
            }}
            columns={activeSheet === 'asset' ? assetColumns : accessoriesColumns}
            disableContextMenu
            gutterColumn={false}
            rowKey="id"
            height={gridHeight}
            rowHeight={34}
            addRowsComponent={false}
            autoAddRow={false}
            rowClassName={({ rowData }) => {
              const cls: string[] = [];
              if (savingRows[rowData.id]) cls.push('xls-row--saving');
              if (deletingRows[rowData.id]) cls.push('xls-row--saving');
              if (rowData.syncStatus === 'BLOCKED') cls.push('xls-row--blocked');
              return cls.join(' ') || undefined;
            }}
          />
        )}

        {rowContextMenu ? (
          <div
            ref={contextMenuRef}
            style={{
              position: 'fixed',
              top: rowContextMenu.y,
              left: rowContextMenu.x,
              zIndex: 2000,
              background: '#1f2f5d',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 8,
              boxShadow: '0 10px 28px rgba(15, 23, 42, 0.45)',
              padding: '4px 0',
              minWidth: 190
            }}
            onClick={(event) => event.stopPropagation()}
            role="menu"
          >
            <button className="xls-ctx-btn" onClick={handleInsertRowFromContextMenu} type="button">
              <span className="xls-ctx-icon">＋</span> Insert Row
            </button>
            <button className="xls-ctx-btn" onClick={handleCopyFromContextMenu} type="button">
              <span className="xls-ctx-icon">📋</span> Copy
            </button>
            <button className="xls-ctx-btn" onClick={handlePasteFromContextMenu} type="button">
              <span className="xls-ctx-icon">📥</span> Paste
            </button>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', margin: '4px 0' }} />
            <button className="xls-ctx-btn xls-ctx-btn--danger" onClick={handleDeleteFromContextMenu} type="button">
              <span className="xls-ctx-icon">🗑</span>
              {(() => {
                const sel = contextSelectionSnapshotRef.current ?? selectionRows;
                const count = sel ? Math.abs(sel.max - sel.min) + 1 : 1;
                return count > 1 ? `Delete ${count} Rows` : 'Delete Row';
              })()}
            </button>
          </div>
        ) : null}
      </div>

      {/* Status bar: pager + sync indicator + last refresh */}
      <div className="xls-po-statusbar">
        <div className="xls-po-status-left">
          <span>{meta ? `Page ${meta.page}/${meta.pageCount} · ${meta.total} rows` : '—'}</span>
          {isSaving
            ? <span className="xls-saving-ind">● Saving…</span>
            : <span className="xls-autosave-ind">✓ Autosave ON</span>}
          <small>Refreshed {formatRelativeTime(lastRefreshAt)}</small>
        </div>
        <div className="xls-po-pager">
          <button className="atlas-toolbar-btn subtle is-small" disabled={!meta || meta.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} type="button">
            ← Prev
          </button>
          <button className="atlas-toolbar-btn subtle is-small" disabled={!meta || meta.page >= meta.pageCount} onClick={() => setPage((p) => p + 1)} type="button">
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
