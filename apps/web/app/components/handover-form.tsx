'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import SignaturePadLib from 'signature_pad';
import { rpcCall } from '../lib/atlas-rpc';

type AuthUserLike = {
  email: string;
  roles: string[];
  fullName?: string | null;
};

type HandoverDeps = {
  accounts: string[];
  departments: string[];
  accountDeptMap: Record<string, string[]>;
  skuList: string[];
  skuMetaMap: Record<string, { category?: string; type?: string; unit?: string; isAccessory?: boolean }>;
  locations: Array<{ location: string; floor: string; label: string }>;
};

type EmployeeOption = {
  employeeKey: string;
  nik: string;
  fullName: string;
  email: string;
  account: string;
  dept: string;
  title: string;
  source?: string;
};

type HandoverItem = {
  id: string;
  type: 'IN' | 'OUT';
  sku: string;
  tag: string;
  tagPrefix: string;
  qty: number;
  noTag: boolean;
  isBroken: boolean;
  isShared: boolean;
  sharedAccount: string;
  sharedDept: string;
};

type SignaturePoint = {
  x: number;
  y: number;
};

type SignatureStroke = SignaturePoint[];

type SignaturePayload = {
  dataUrl: string;
  strokes: SignatureStroke[];
  empty: boolean;
};

type SignatureCanvasProps = {
  label: string;
  note: string;
  accent?: 'user' | 'it';
  disabled?: boolean;
  resetToken?: number;
  onChange: (payload: SignaturePayload) => void;
};

type HandoverSubmitResult = {
  success: boolean;
  message?: string;
  pdfUrl?: string;
  docID?: string;
  status?: string;
};

type ExistingSignatureState = {
  signed: boolean;
  fileUrl: string;
  inlineDataUrl: string;
  label: string;
};

type HandoverResumePayload = {
  docID?: string;
  bastMode?: string;
  manualEntry?: boolean;
  holderMode?: string;
  userName?: string;
  userNIK?: string;
  userEmail?: string;
  userAcc?: string;
  userDept?: string;
  dutyLocationSite?: string;
  dutyLocationFloor?: string;
  dutyLocationLabel?: string;
  transType?: string;
  notes?: string;
  userSigType?: 'RECIPIENT' | 'ACKNOWLEDGEMENT' | string;
  repName?: string;
  repEmail?: string;
  itSignerName?: string;
  items?: Array<Record<string, unknown>>;
};

type HandoverDetailResponse = {
  success: boolean;
  message?: string;
  handover?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  signatures?: {
    it?: Record<string, unknown>;
    user?: Record<string, unknown>;
  };
  resumeState?: {
    canResume?: boolean;
    strictMode?: boolean;
    itSigned?: boolean;
    userSigned?: boolean;
  };
  resumePayload?: HandoverResumePayload;
};

const EMPTY_SIGNATURE: SignaturePayload = {
  dataUrl: '',
  strokes: [],
  empty: true
};

const EMPTY_EXISTING_SIGNATURE: ExistingSignatureState = {
  signed: false,
  fileUrl: '',
  inlineDataUrl: '',
  label: ''
};

function normalizeAssetTag(value: string) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw === 'NO TAG' || raw === 'NOTAG') return 'NO-TAG';
  return raw;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeMode(value: unknown) {
  const normalized = text(value).toUpperCase();
  if (normalized === 'WFH' || normalized === 'WFO') return normalized;
  return '';
}

function normalizeResumeItem(input: Record<string, unknown>) {
  const type = String(input.type || input.direction || 'OUT').toUpperCase().startsWith('IN') ? 'IN' : 'OUT';
  const tag = normalizeAssetTag(String(input.tag || input.assetTag || ''));
  return {
    id: globalThis.crypto?.randomUUID?.() || `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    sku: String(input.sku || input.itemSku || input.itemName || '').trim(),
    tag,
    tagPrefix: '',
    qty: Math.max(1, Number(input.qty ?? input.quantity ?? 1) || 1),
    noTag: tag === 'NO-TAG',
    isBroken: Boolean(input.isBroken),
    isShared: Boolean(input.isShared),
    sharedAccount: String(input.sharedAccount || '').trim(),
    sharedDept: String(input.sharedDept || '').trim()
  } satisfies HandoverItem;
}

function makeItem(type: 'IN' | 'OUT'): HandoverItem {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    sku: '',
    tag: '',
    tagPrefix: '',
    qty: 1,
    noTag: false,
    isBroken: false,
    isShared: false,
    sharedAccount: '',
    sharedDept: ''
  };
}

function resolveSkuMeta(
  skuMetaMap: HandoverDeps['skuMetaMap'] | null | undefined,
  skuValue: string
) {
  const normalized = String(skuValue || '').trim();
  if (!normalized || !skuMetaMap) return null;
  const direct = skuMetaMap[normalized];
  if (direct) return direct;

  const directLower = skuMetaMap[normalized.toLowerCase()];
  if (directLower) return directLower;

  const lookup = normalized.toLowerCase();
  const matchedKey = Object.keys(skuMetaMap).find((key) => key.toLowerCase() === lookup);
  return matchedKey ? skuMetaMap[matchedKey] : null;
}

function isAccessorySku(skuValue: string, meta: HandoverDeps['skuMetaMap'][string] | null) {
  const combined = `${String(skuValue || '')} ${String(meta?.category || '')}`.toLowerCase();
  return Boolean(meta?.isAccessory)
    || /^acc-/i.test(String(meta?.category || ''))
    || /accessories|accessory|aksesoris|aksesori/i.test(combined);
}

function detectSkuTagPrefix(skuValue: string, meta: HandoverDeps['skuMetaMap'][string] | null) {
  const combined = `${String(skuValue || '')} ${String(meta?.category || '')}`.toLowerCase();
  const monitorMatch = combined.match(/monitor[^\d]*(\d{2})/i) || combined.match(/(\d{2})["\s']*(?:inch|in\b)/i);

  if (monitorMatch?.[1]) return `ATIMT${monitorMatch[1]}-`;
  if (/\bmonitor\b/i.test(combined)) return 'ATIMT-';
  if (/laptop|notebook|\bnb\b/i.test(combined)) return 'ATINB-';
  if (/\bpc\b|\bdesktop\b|\bpersonal\s*comp/i.test(combined)) return 'ATIPC-';
  return '';
}

function normalizeTagInputWithPrefix(rawValue: string, prefix: string) {
  const normalizedPrefix = String(prefix || '').trim().toUpperCase();
  if (!normalizedPrefix) return normalizeAssetTag(rawValue);
  const upper = String(rawValue || '').trim().toUpperCase();
  const suffix = upper.startsWith(normalizedPrefix)
    ? upper.slice(normalizedPrefix.length).replace(/\D/g, '')
    : upper.replace(/\D/g, '');
  return `${normalizedPrefix}${suffix}`;
}

function SignatureCanvas({ label, note, accent = 'user', disabled = false, resetToken = 0, onChange }: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePadLib | null>(null);

  // Resize canvas to match CSS dimensions (preserves strokes)
  function resizeCanvas(pad: SignaturePadLib) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    const data = pad.toData();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(ratio, ratio);
    pad.fromData(data);
  }

  function emitChange(pad: SignaturePadLib) {
    if (pad.isEmpty()) {
      onChange(EMPTY_SIGNATURE);
    } else {
      onChange({
        dataUrl: pad.toDataURL('image/png'),
        strokes: pad.toData() as unknown as SignatureStroke[],
        empty: false
      });
    }
  }

  // Mount signature_pad
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const penColor = accent === 'it' ? '#1e2f5d' : '#111827';
    const pad = new SignaturePadLib(canvas, {
      penColor,
      minWidth: 0.5,
      maxWidth: 2.5,
      velocityFilterWeight: 0.7
    });

    padRef.current = pad;

    // Initial size
    resizeCanvas(pad);

    // Resize handler
    function handleResize() { resizeCanvas(pad); }
    window.addEventListener('resize', handleResize);

    // Emit on each stroke end
    pad.addEventListener('endStroke', () => emitChange(pad));

    if (disabled) pad.off();

    return () => {
      window.removeEventListener('resize', handleResize);
      pad.off();
      padRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent]);

  // Sync disabled state
  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    if (disabled) pad.off();
    else pad.on();
  }, [disabled]);

  // Reset on resetToken change
  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    pad.clear();
    onChange(EMPTY_SIGNATURE);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  return (
    <div className={`signature-box mt-2${disabled ? ' is-disabled' : ''}`}>
      <canvas
        aria-label={`${label} signature canvas`}
        ref={canvasRef}
        className="ho-signature-canvas"
        style={{ cursor: disabled ? 'not-allowed' : 'crosshair', touchAction: 'none' }}
      />
    </div>
  );
}

function SignaturePreviewCard({
  label,
  note,
  statusLabel,
  imageUrl
}: {
  label: string;
  note: string;
  statusLabel: string;
  imageUrl: string;
}) {
  const nameMatch = note.match(/Signed by:\s*(.+)/);
  const signerName = nameMatch ? nameMatch[1] : note;

  return (
    <div className="signature-box mt-2 is-preview">
      <div className="ho-signature-preview-header">
        <h4 className="ho-signature-preview-title">{label}</h4>
        <span className="ho-signature-status-badge">{statusLabel}</span>
      </div>
      <div className="ho-signature-preview-image-wrapper">
        {imageUrl ? (
          <img alt={label} className="ho-signature-preview-image" src={imageUrl} />
        ) : (
          <div className="ho-signature-preview-empty">Saved signature preview</div>
        )}
      </div>
      <div className="ho-signature-preview-footer">
        <span className="ho-signature-preview-label">Signed by</span>
        <span className="ho-signature-preview-name">{signerName}</span>
      </div>
    </div>
  );
}

export function HandoverFormWorkspace({
  user,
  onSubmitted,
  resumeDocNumber,
  resumeNonce = 0,
  onResumeCleared
}: {
  user: AuthUserLike;
  onSubmitted?: (result: HandoverSubmitResult) => Promise<void> | void;
  resumeDocNumber?: string | null;
  resumeNonce?: number;
  onResumeCleared?: () => void;
}) {
  const [deps, setDeps] = useState<HandoverDeps | null>(null);
  const [signers, setSigners] = useState<string[]>([]);
  const [depsLoading, setDepsLoading] = useState(true);
  const [depsError, setDepsError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);

  const [mode, setMode] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [transType, setTransType] = useState<'' | 'Check Out' | 'Check In' | 'Changes'>('');
  const [holder, setHolder] = useState({
    name: '',
    nik: '',
    email: '',
    account: '',
    dept: ''
  });
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [employeeNikQuery, setEmployeeNikQuery] = useState('');
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [employeeLookupLoading, setEmployeeLookupLoading] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeOption | null>(null);
  const [dutySite, setDutySite] = useState('');
  const [dutyFloor, setDutyFloor] = useState('');
  const [notes, setNotes] = useState('');
  const [userSigType, setUserSigType] = useState<'RECIPIENT' | 'ACKNOWLEDGEMENT'>('RECIPIENT');
  const [repName, setRepName] = useState('');
  const [repQuery, setRepQuery] = useState('');
  const [repOptions, setRepOptions] = useState<EmployeeOption[]>([]);
  const [repLookupLoading, setRepLookupLoading] = useState(false);
  const [selectedRep, setSelectedRep] = useState<EmployeeOption | null>(null);
  const [itSignerName, setItSignerName] = useState('');
  const [returnItems, setReturnItems] = useState<HandoverItem[]>([]);
  const [issueItems, setIssueItems] = useState<HandoverItem[]>([]);
  // Tracks which item IDs have had their SKU confirmed via dropdown selection.
  // Typing alone does NOT confirm — user must pick from the list.
  const [confirmedSkuIds, setConfirmedSkuIds] = useState<Set<string>>(new Set());
  const [activeSkuDropdown, setActiveSkuDropdown] = useState<string | null>(null);
  const [activePlacementDropdown, setActivePlacementDropdown] = useState<null | 'site' | 'floor'>(null);
  const [userSignature, setUserSignature] = useState<SignaturePayload>(EMPTY_SIGNATURE);
  const [itSignature, setItSignature] = useState<SignaturePayload>(EMPTY_SIGNATURE);
  const [existingUserSignature, setExistingUserSignature] = useState<ExistingSignatureState>(EMPTY_EXISTING_SIGNATURE);
  const [existingItSignature, setExistingItSignature] = useState<ExistingSignatureState>(EMPTY_EXISTING_SIGNATURE);
  const [userSignatureResetToken, setUserSignatureResetToken] = useState(0);
  const [itSignatureResetToken, setItSignatureResetToken] = useState(0);
  const [formMessage, setFormMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [currentDocId, setCurrentDocId] = useState('');
  const [resumeMode, setResumeMode] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [confirmIntent, setConfirmIntent] = useState<null | 'reset' | 'cancelResume' | 'enableEdit'>(null);

  const isWfhRole = useMemo(() => user.roles.some((role) => String(role).toUpperCase().includes('WFH')), [user.roles]);
  const isWfoRole = useMemo(() => user.roles.some((role) => String(role).toUpperCase().includes('WFO')), [user.roles]);
  const isPortalUser = useMemo(() => user.roles.some((role) => {
    const r = String(role ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return ['USER', 'WFH', 'WFO', 'WFH_WFO'].includes(r);
  }), [user.roles]);
  const isWfhWfoRole = isWfhRole || isWfoRole;
  // Portal users can only submit handovers for themselves — lock identity to their own account
  const selfLocked = isPortalUser && !resumeMode;
  const strictResumeMode = resumeMode && !editMode;
  const modeLocked = resumeMode;
  const identityLocked = resumeMode;
  const transactionLocked = resumeMode;
  const rowLocked = strictResumeMode;
  const userSignatureLocked = strictResumeMode && existingUserSignature.signed;
  const itSignatureLocked = strictResumeMode && existingItSignature.signed;

  useEffect(() => {
    let cancelled = false;

    async function loadBootstrap() {
      setDepsLoading(true);
      setDepsError('');
      try {
        const [depsResult, signersResult] = await Promise.all([
          rpcCall<HandoverDeps>('getHandoverDependencies'),
          rpcCall<{ success: boolean; items: string[] }>('getHandoverSigners')
        ]);
        if (cancelled) return;
        setDeps(depsResult);
        setSigners(Array.isArray(signersResult.items) ? signersResult.items : []);
        if (!resumeDocNumber) {
          setMode(null);
          setDutySite('');
        }
      } catch (error) {
        if (cancelled) return;
        setDepsError(error instanceof Error ? error.message : 'Failed to load handover form dependencies.');
      } finally {
        if (!cancelled) setDepsLoading(false);
      }
    }

    void loadBootstrap();
    return () => {
      cancelled = true;
    };
  }, [isWfhRole, isWfoRole, resumeDocNumber]);

  useEffect(() => {
    if (mode === 'WFH') {
      setDutySite('WFH');
      setDutyFloor('');
      return;
    }

    if (dutySite === 'WFH') {
      setDutySite('');
    }

    setDutyFloor('');
  }, [mode]);

  useEffect(() => {
    if (!isWfhWfoRole || resumeMode) return;
    setManualEntry(false);
    setUserSigType('RECIPIENT');
    setRepName('');
    setRepQuery('');
    setRepOptions([]);
    setSelectedRep(null);
    setItSignerName('');
  }, [isWfhWfoRole, resumeMode]);

  useEffect(() => {
    if (resumeMode) {
      if (!transType) {
        setReturnItems([]);
        setIssueItems([]);
        return;
      }

      if (transType === 'Check Out') {
        setReturnItems([]);
        setIssueItems((current) => current.map((item) => ({ ...item, type: 'OUT' as const })));
        return;
      }

      if (transType === 'Check In') {
        setIssueItems([]);
        setReturnItems((current) => current.map((item) => ({ ...item, type: 'IN' as const })));
        return;
      }

      setReturnItems((current) => current.map((item) => ({ ...item, type: 'IN' as const })));
      setIssueItems((current) => current.map((item) => ({ ...item, type: 'OUT' as const })));
      return;
    }

    if (!transType) {
      setReturnItems([]);
      setIssueItems([]);
      return;
    }

    if (transType === 'Check Out') {
      setReturnItems([]);
      setIssueItems((current) => (current.length ? current.map((item) => ({ ...item, type: 'OUT' as const })) : [makeItem('OUT')]));
      return;
    }

    if (transType === 'Check In') {
      setIssueItems([]);
      setReturnItems((current) => (current.length ? current.map((item) => ({ ...item, type: 'IN' as const })) : [makeItem('IN')]));
      return;
    }

    setReturnItems((current) => (current.length ? current.map((item) => ({ ...item, type: 'IN' as const })) : [makeItem('IN')]));
    setIssueItems((current) => (current.length ? current.map((item) => ({ ...item, type: 'OUT' as const })) : [makeItem('OUT')]));
  }, [transType, resumeMode]);

  useEffect(() => {
    if (identityLocked) {
      setEmployeeOptions([]);
      return;
    }

    if (manualEntry) {
      setEmployeeOptions([]);
      setSelectedEmployee(null);
      return;
    }

    if (selectedEmployee) {
      setEmployeeOptions([]);
      return;
    }

    const query = employeeQuery.trim() || employeeNikQuery.trim();
    if (query.length < 2) {
      setEmployeeOptions([]);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(async () => {
      setEmployeeLookupLoading(true);
      try {
        const result = await rpcCall<{ success: boolean; items: EmployeeOption[] }>('searchHandoverEmployees', query, 8);
        if (!active) return;
        setEmployeeOptions(Array.isArray(result.items) ? result.items : []);
      } catch {
        if (!active) return;
        setEmployeeOptions([]);
      } finally {
        if (active) setEmployeeLookupLoading(false);
      }
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [employeeQuery, employeeNikQuery, manualEntry, selectedEmployee, identityLocked]);

  useEffect(() => {
    if (userSigType !== 'ACKNOWLEDGEMENT' || selectedRep) {
      setRepOptions([]);
      return;
    }
    const query = repQuery.trim();
    if (query.length < 2) {
      setRepOptions([]);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(async () => {
      setRepLookupLoading(true);
      try {
        const result = await rpcCall<{ success: boolean; items: EmployeeOption[] }>('searchHandoverEmployees', query, 8);
        if (!active) return;
        setRepOptions(Array.isArray(result.items) ? result.items : []);
      } catch {
        if (!active) return;
        setRepOptions([]);
      } finally {
        if (active) setRepLookupLoading(false);
      }
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [repQuery, userSigType, selectedRep]);

  // Portal users: auto-load their own employee record and lock identity
  useEffect(() => {
    if (!selfLocked || !deps) return;
    if (selectedEmployee) return;
    let active = true;
    void (async () => {
      try {
        const result = await rpcCall<{ success: boolean; items: EmployeeOption[] }>('searchHandoverEmployees', user.email, 1);
        if (!active) return;
        const found = Array.isArray(result.items) ? result.items[0] : null;
        if (found) {
          setSelectedEmployee(found);
          setEmployeeQuery(found.fullName || found.employeeKey || '');
          setEmployeeNikQuery(found.nik || '');
          setHolder({
            name: found.fullName || '',
            nik: found.nik || '',
            email: found.email || '',
            account: found.account || '',
            dept: found.dept || ''
          });
        }
      } catch {
        // ignore — user can still see form, identity will show as empty
      }
    })();
    return () => { active = false; };
  }, [selfLocked, deps, user.email, selectedEmployee]);

  const siteOptions = useMemo(() => {
    if (!deps) return [];
    if (mode === 'WFH') return ['WFH'];
    const values = deps.locations.map((entry) => entry.location).filter(Boolean);
    if (!values.includes('E-Building')) values.push('E-Building');
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
  }, [deps, mode]);

  const floorOptions = useMemo(() => {
    if (!deps || !dutySite || mode === 'WFH') return [];
    return deps.locations
      .filter((entry) => entry.location === dutySite && entry.floor)
      .map((entry) => entry.floor)
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }, [deps, dutySite, mode]);

  const dutyLocationLabel = useMemo(() => {
    if (mode === 'WFH') return 'WFH';
    if (dutySite && dutyFloor) return `${dutySite} - ${dutyFloor}`;
    if (dutySite) return dutySite;
    return '';
  }, [mode, dutySite, dutyFloor]);

  const showReturnSection = transType === 'Check In' || transType === 'Changes';
  const showIssueSection = transType === 'Check Out' || transType === 'Changes';
  const needsModeSelection = mode === null && !resumeMode;
  const effectiveHolder = manualEntry
    ? holder
    : {
        name: selectedEmployee?.fullName || holder.name,
        nik: selectedEmployee?.nik || holder.nik,
        email: selectedEmployee?.email || holder.email,
        account: selectedEmployee?.account || holder.account,
        dept: selectedEmployee?.dept || holder.dept
      };

  function setItemValue(direction: 'IN' | 'OUT', id: string, patch: Partial<HandoverItem>) {
    const setter = direction === 'IN' ? setReturnItems : setIssueItems;
    setter((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        if (patch.noTag === true) {
          next.tag = '';
          next.tagPrefix = '';
        }
        if (patch.isShared === false) {
          next.sharedAccount = '';
          next.sharedDept = '';
        }
        return next;
      })
    );
  }

  function addItem(direction: 'IN' | 'OUT') {
    const setter = direction === 'IN' ? setReturnItems : setIssueItems;
    setter((current) => [...current, makeItem(direction)]);
  }

  function removeItem(direction: 'IN' | 'OUT', id: string) {
    const setter = direction === 'IN' ? setReturnItems : setIssueItems;
    setter((current) => {
      const next = current.filter((item) => item.id !== id);
      if (direction === 'IN' && showReturnSection && next.length === 0) return [makeItem('IN')];
      if (direction === 'OUT' && showIssueSection && next.length === 0) return [makeItem('OUT')];
      return next;
    });
    setConfirmedSkuIds((current) => { const next = new Set(current); next.delete(id); return next; });
  }

  function handleEmployeeSelect(option: EmployeeOption) {
    setSelectedEmployee(option);
    setEmployeeQuery(option.fullName || option.employeeKey || '');
    setEmployeeNikQuery(option.nik || '');
    setEmployeeOptions([]);
    setHolder({
      name: option.fullName || '',
      nik: option.nik || '',
      email: option.email || '',
      account: option.account || '',
      dept: option.dept || ''
    });
    setFormMessage(null);
  }

  function clearResumeState() {
    setCurrentDocId('');
    setResumeMode(false);
    setEditMode(false);
    setExistingItSignature(EMPTY_EXISTING_SIGNATURE);
    setExistingUserSignature(EMPTY_EXISTING_SIGNATURE);
    if (onResumeCleared) onResumeCleared();
  }

  function openModePicker() {
    if (modeLocked || editMode) return;
    setMode(null);
    setTransType('');
    setDutySite('');
    setDutyFloor('');
    setReturnItems([]);
    setIssueItems([]);
    setFormMessage(null);
  }

  function selectMode(nextMode: string) {
    setMode(nextMode);
    setTransType('');
    setDutySite(nextMode === 'WFH' ? 'WFH' : '');
    setDutyFloor('');
    setReturnItems([]);
    setIssueItems([]);
    setFormMessage(null);
  }

  function resetForm() {
    clearResumeState();
    setMode(null);
    setManualEntry(false);
    setTransType('');
    setHolder({ name: '', nik: '', email: '', account: '', dept: '' });
    setEmployeeQuery('');
    setEmployeeNikQuery('');
    setEmployeeOptions([]);
    setSelectedEmployee(null);
    setDutySite('');
    setDutyFloor('');
    setNotes('');
    setUserSigType('RECIPIENT');
    setRepName('');
    setRepQuery('');
    setRepOptions([]);
    setSelectedRep(null);
    setItSignerName('');
    setReturnItems([]);
    setIssueItems([]);
    setConfirmedSkuIds(new Set());
    setUserSignature(EMPTY_SIGNATURE);
    setItSignature(EMPTY_SIGNATURE);
    setExistingUserSignature(EMPTY_EXISTING_SIGNATURE);
    setExistingItSignature(EMPTY_EXISTING_SIGNATURE);
    setUserSignatureResetToken((value) => value + 1);
    setItSignatureResetToken((value) => value + 1);
    setFormMessage(null);
  }

  function enableEditMode() {
    if (!currentDocId) return;
    setEditMode(true);
    setExistingItSignature(EMPTY_EXISTING_SIGNATURE);
    setExistingUserSignature(EMPTY_EXISTING_SIGNATURE);
    setUserSignature(EMPTY_SIGNATURE);
    setItSignature(EMPTY_SIGNATURE);
    setUserSignatureResetToken((value) => value + 1);
    setItSignatureResetToken((value) => value + 1);
    setFormMessage({
      kind: 'info',
      text: 'Edit mode active. Make your changes, then re-sign before submitting.'
    });
  }

  function handleConfirmAction() {
    if (confirmIntent === 'reset' || confirmIntent === 'cancelResume') {
      resetForm();
    }

    if (confirmIntent === 'enableEdit') {
      enableEditMode();
    }

    setConfirmIntent(null);
  }

  function clearSignature(which: 'user' | 'it') {
    if (which === 'user') {
      if (userSignatureLocked) return;
      setUserSignature(EMPTY_SIGNATURE);
      setExistingUserSignature(EMPTY_EXISTING_SIGNATURE);
      setUserSignatureResetToken((value) => value + 1);
      return;
    }

    if (itSignatureLocked) return;
    setItSignature(EMPTY_SIGNATURE);
    setExistingItSignature(EMPTY_EXISTING_SIGNATURE);
    setItSignatureResetToken((value) => value + 1);
  }

  function getSkuOptions(query: string) {
    const list = Array.isArray(deps?.skuList) ? deps.skuList : [];
    const normalized = text(query).toLowerCase();
    if (!normalized) return list.slice(0, 12);
    return list
      .filter((sku) => sku.toLowerCase().includes(normalized))
      .sort((left, right) => {
        const leftStarts = left.toLowerCase().startsWith(normalized) ? 1 : 0;
        const rightStarts = right.toLowerCase().startsWith(normalized) ? 1 : 0;
        if (leftStarts !== rightStarts) return rightStarts - leftStarts;
        return left.localeCompare(right);
      })
      .slice(0, 12);
  }

  function handleSkuSelect(direction: 'IN' | 'OUT', id: string, skuValue: string) {
    applySkuBehavior(direction, id, skuValue);
    setActiveSkuDropdown(null);
    setConfirmedSkuIds((current) => { const next = new Set(current); next.add(id); return next; });
  }

  function applySkuBehavior(direction: 'IN' | 'OUT', id: string, skuValue: string) {
    const meta = resolveSkuMeta(deps?.skuMetaMap, skuValue);
    const accessory = isAccessorySku(skuValue, meta);
    const prefix = accessory ? '' : detectSkuTagPrefix(skuValue, meta);

    setItemValue(direction, id, (accessory
      ? {
          sku: skuValue,
          noTag: true,
          tag: '',
          tagPrefix: '',
          isShared: direction === 'OUT' ? false : undefined
        }
      : {
          sku: skuValue,
          noTag: false,
          tagPrefix: prefix
        }) as Partial<HandoverItem>);

    if (accessory || !prefix) return;

    const setter = direction === 'IN' ? setReturnItems : setIssueItems;
    setter((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const currentTag = String(item.tag || '').trim().toUpperCase();
        const shouldReplace =
          !currentTag
          || item.noTag
          || currentTag === String(item.tagPrefix || '').toUpperCase()
          || /^ATI[A-Z0-9-]+$/.test(currentTag);

        if (!shouldReplace) {
          return { ...item, sku: skuValue, noTag: false, tagPrefix: prefix };
        }

        return {
          ...item,
          sku: skuValue,
          noTag: false,
          tagPrefix: prefix,
          tag: prefix
        };
      })
    );
  }

  function applyResumeDetail(result: HandoverDetailResponse) {
    const handover = result.handover || {};
    const resumePayload = result.resumePayload || {};
    const handoverItems = Array.isArray(result.items) ? result.items : [];
    const payloadItems = Array.isArray(resumePayload.items) ? resumePayload.items : [];
    const sourceItems = payloadItems.length ? payloadItems : handoverItems;

    const loadedMode = normalizeMode(resumePayload.bastMode || handover.mode);
    const loadedType = String(resumePayload.transType || handover.transactionType || 'Check Out') as 'Check Out' | 'Check In' | 'Changes';
    const loadedManualEntry =
      Boolean(resumePayload.manualEntry)
      || String(resumePayload.holderMode || '').toUpperCase() === 'MANUAL_ENTRY';
    const dutyLabel = text(resumePayload.dutyLocationLabel || handover.dutyLocationLabel || handover.dutyLocation);
    const [sitePart, ...floorParts] = dutyLabel.split(' - ');
    const loadedSite = loadedMode === 'WFH' ? 'WFH' : text(resumePayload.dutyLocationSite || sitePart);
    const loadedFloor = loadedMode === 'WFH' ? '' : text(resumePayload.dutyLocationFloor || floorParts.join(' - '));
    const normalizedItems = sourceItems.map((item) => normalizeResumeItem(item));
    const resolvedResumeEmployee = loadedManualEntry
      ? null
      : {
          employeeKey: text(resumePayload.userEmail || handover.holderEmail || resumePayload.userName || handover.holderName || 'resume'),
          nik: text(resumePayload.userNIK || handover.holderNik),
          fullName: text(resumePayload.userName || handover.holderName),
          email: text(resumePayload.userEmail || handover.holderEmail),
          account: text(resumePayload.userAcc || handover.userAccount),
          dept: text(resumePayload.userDept || handover.holderDepartment),
          title: '',
          source: 'resume'
        } satisfies EmployeeOption;

    setCurrentDocId(text(resumePayload.docID || handover.docNumber));
    setResumeMode(true);
    setEditMode(false);
    setMode(loadedMode);
    setManualEntry(loadedManualEntry);
    setTransType(loadedType);
    setEmployeeQuery(loadedManualEntry ? '' : text(resumePayload.userName || handover.holderName));
    setEmployeeNikQuery(loadedManualEntry ? '' : text(resumePayload.userNIK || handover.holderNik));
    setEmployeeOptions([]);
    setSelectedEmployee(resolvedResumeEmployee);
    setHolder({
      name: text(resumePayload.userName || handover.holderName),
      nik: text(resumePayload.userNIK || handover.holderNik),
      email: text(resumePayload.userEmail || handover.holderEmail),
      account: text(resumePayload.userAcc || handover.userAccount),
      dept: text(resumePayload.userDept || handover.holderDepartment)
    });
    setDutySite(loadedSite);
    setDutyFloor(loadedFloor);
    setNotes(text(resumePayload.notes || handover.notes));
    setUserSigType(text(resumePayload.userSigType || 'RECIPIENT') === 'ACKNOWLEDGEMENT' ? 'ACKNOWLEDGEMENT' : 'RECIPIENT');
    setRepName(text(resumePayload.repName));
    const resumedRepName = text(resumePayload.repName);
    const resumedRepEmail = text(resumePayload.repEmail);
    if (resumedRepName && resumedRepEmail) {
      const resumedRep: EmployeeOption = { fullName: resumedRepName, email: resumedRepEmail, nik: '', account: '', dept: '', employeeKey: '', title: '' };
      setSelectedRep(resumedRep);
      setRepQuery(resumedRepName);
    } else {
      setSelectedRep(null);
      setRepQuery('');
    }
    setRepOptions([]);
    setItSignerName(text(resumePayload.itSignerName || handover.signerITName));
    const inItems = normalizedItems.filter((item) => item.type === 'IN');
    const outItems = normalizedItems.filter((item) => item.type === 'OUT');
    setReturnItems(inItems);
    setIssueItems(outItems);
    // Pre-confirm all resumed items that already have a SKU
    const preConfirmed = new Set<string>(
      normalizedItems.filter((item) => item.sku.trim() !== '').map((item) => item.id)
    );
    setConfirmedSkuIds(preConfirmed);
    setUserSignature(EMPTY_SIGNATURE);
    setItSignature(EMPTY_SIGNATURE);
    setUserSignatureResetToken((value) => value + 1);
    setItSignatureResetToken((value) => value + 1);
    setExistingItSignature({
      signed: Boolean(result.signatures?.it?.signed),
      fileUrl: text(result.signatures?.it?.fileUrl),
      inlineDataUrl: text(result.signatures?.it?.inlineDataUrl),
      label: text(result.signatures?.it?.label || handover.signerITName)
    });
    setExistingUserSignature({
      signed: Boolean(result.signatures?.user?.signed),
      fileUrl: text(result.signatures?.user?.fileUrl),
      inlineDataUrl: text(result.signatures?.user?.inlineDataUrl),
      label: text(result.signatures?.user?.label || handover.signerUserLabel || handover.holderName)
    });
    setFormMessage({
      kind: 'info',
      text: 'Resume mode active. All fields are locked. Only pending signature fields can be completed.'
    });
  }

  useEffect(() => {
    if (!resumeDocNumber) return;

    let active = true;
    async function loadResumeDocument() {
      setResumeLoading(true);
      setFormMessage({
        kind: 'info',
        text: `Loading BAST document ${resumeDocNumber}...`
      });

      try {
        const result = await rpcCall<HandoverDetailResponse>('getHandoverDetail', resumeDocNumber);
        if (!active) return;
        if (!result?.success) {
          throw new Error(result?.message || 'Failed to load handover document.');
        }
        applyResumeDetail(result);
      } catch (error) {
        if (!active) return;
        setFormMessage({
          kind: 'error',
          text: error instanceof Error ? error.message : 'Failed to load handover document.'
        });
      } finally {
        if (active) setResumeLoading(false);
      }
    }

    void loadResumeDocument();
    return () => {
      active = false;
    };
  }, [resumeDocNumber, resumeNonce]);

  function handleCancelResume() {
    if (!resumeMode) return;
    setConfirmIntent('cancelResume');
  }

  function handleEnableEditMode() {
    if (!currentDocId) return;
    setConfirmIntent('enableEdit');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormMessage(null);

    if (needsModeSelection) {
      setFormMessage({ kind: 'error', text: 'Please select Handover Form Type first.' });
      return;
    }

    if (!effectiveHolder.name) {
      setFormMessage({ kind: 'error', text: 'Holder name is required.' });
      return;
    }

    if (!transType) {
      setFormMessage({ kind: 'error', text: 'Please select transaction type first.' });
      return;
    }

    if (manualEntry && !effectiveHolder.nik) {
      setFormMessage({ kind: 'error', text: 'Manual entry requires NIK.' });
      return;
    }

    if (!manualEntry && !selectedEmployee && !resumeMode) {
      setFormMessage({ kind: 'error', text: 'Please select employee from Employee Database or enable Manual entry.' });
      return;
    }

    const items = [...returnItems, ...issueItems]
      .filter((item) => item.sku.trim())
      .map((item) => ({
        type: item.type,
        tag: item.noTag ? 'NO-TAG' : normalizeAssetTag(item.tag),
        sku: item.sku.trim(),
        qty: Math.max(1, Number(item.qty) || 1),
        isBroken: item.type === 'IN' ? item.isBroken : false,
        isShared: item.type === 'OUT' ? item.isShared : false,
        sharedAccount: item.type === 'OUT' && item.isShared ? item.sharedAccount : '',
        sharedDept: item.type === 'OUT' && item.isShared ? item.sharedDept : ''
      }));

    if (!items.length) {
      setFormMessage({ kind: 'error', text: 'No asset items have been added.' });
      return;
    }

    if (items.some((item) => item.type === 'OUT') && !dutyLocationLabel) {
      setFormMessage({ kind: 'error', text: 'Please select Duty Location for asset checkout.' });
      return;
    }

    if (items.some((item) => item.isShared && (!item.sharedAccount || !item.sharedDept))) {
      setFormMessage({ kind: 'error', text: 'Shared Asset requires account and department.' });
      return;
    }

    const finalUserSigned = !userSignature.empty || (strictResumeMode && existingUserSignature.signed);
    const finalItSigned = !itSignature.empty || (strictResumeMode && existingItSignature.signed);
    const effectiveSignerName =
      itSignerName.trim()
      || (strictResumeMode ? existingItSignature.label : '')
      || text(user.fullName)
      || text(user.email);

    if (isWfhWfoRole && userSigType !== 'RECIPIENT') {
      setFormMessage({ kind: 'error', text: 'WFH/WFO users can only sign as Recipient.' });
      return;
    }

    if (userSigType === 'ACKNOWLEDGEMENT' && !selectedRep) {
      setFormMessage({ kind: 'error', text: 'Please select a representative from the Employee Database.' });
      return;
    }

    if (isWfhWfoRole && !selectedEmployee && !resumeMode) {
      setFormMessage({ kind: 'error', text: 'WFH/WFO users must be resolved from Employee Database before submitting.' });
      return;
    }

    if (isPortalUser) {
      // Portal users only sign their own section; IT Operations signs separately
      if (!finalUserSigned) {
        setFormMessage({ kind: 'error', text: 'Please complete your signature before finalizing.' });
        return;
      }
    } else {
      if (finalItSigned && !effectiveSignerName) {
        setFormMessage({ kind: 'error', text: 'Please select IT Operations signer.' });
        return;
      }

      if (!finalItSigned && !finalUserSigned) {
        setFormMessage({ kind: 'error', text: 'At least one signature is required before finalizing the handover.' });
        return;
      }
    }

    const payload = {
      docID: currentDocId || '',
      bastMode: mode ?? '',
      formMode: editMode ? 'edit' : resumeMode ? 'resume' : 'new',
      resumeEditMode: editMode,
      manualEntry,
      holderMode: manualEntry ? 'MANUAL_ENTRY' : 'EMPLOYEE_DB',
      userName: effectiveHolder.name,
      userNIK: effectiveHolder.nik,
      userEmail: effectiveHolder.email,
      userAcc: effectiveHolder.account,
      userDept: effectiveHolder.dept,
      dutyLocationSite: mode === 'WFH' ? 'WFH' : dutySite,
      dutyLocationFloor: mode === 'WFH' ? '' : dutyFloor,
      dutyLocationLabel,
      transType,
      items,
      notes,
      sigIT: itSignature.dataUrl,
      sigUser: userSignature.dataUrl,
      sigITData: itSignature.strokes,
      sigUserData: userSignature.strokes,
      userSigType,
      repName: selectedRep ? selectedRep.fullName : repName,
      repEmail: selectedRep ? (selectedRep.email || '') : '',
      itSignerName: finalItSigned ? effectiveSignerName : itSignerName.trim()
    };

    try {
      setSubmitting(true);
      const result = await rpcCall<HandoverSubmitResult>('submitHandoverTransaction', payload);
      if (!result?.success) {
        throw new Error(result?.message || 'Failed to submit handover transaction.');
      }

      setFormMessage({
        kind: 'success',
        text: result.message || `Transaction ${result.docID || '-'} saved successfully.`
      });

      if (result.pdfUrl) {
        window.open(result.pdfUrl, '_blank', 'noopener,noreferrer');
      }

      if (onSubmitted) {
        await onSubmitted(result);
      }
      resetForm();
    } catch (error) {
      setFormMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to submit handover transaction.'
      });
    } finally {
      setSubmitting(false);
    }
  }

  function renderItemRow(item: HandoverItem, index: number) {
    const departmentOptions = item.sharedAccount
      ? deps?.accountDeptMap?.[item.sharedAccount] || deps?.accountDeptMap?.[item.sharedAccount.toLowerCase()] || deps?.departments || []
      : deps?.departments || [];
    const skuDropdownOpen = activeSkuDropdown === `${item.type}-${item.id}` && getSkuOptions(item.sku).length > 0;

    // Progressive disclosure: SKU only 'done' when confirmed from dropdown, not just typed
    const skuDone = confirmedSkuIds.has(item.id);
    const tagDone = skuDone && (item.noTag || item.tag.trim() !== '');
    const qtyDone = tagDone; // qty defaults to 1 — unlocked as soon as tag step is satisfied

    const stepLabels = item.type === 'IN'
      ? ['Item / SKU', 'Asset Tag', 'Qty & Condition']
      : ['Item / SKU', 'Asset Tag', 'Quantity'];
    const stepsDone = [skuDone, tagDone, qtyDone];

    const assetTagPlaceholder = item.noTag
      ? 'NO TAG'
      : item.tagPrefix
        ? `e.g. ${item.tagPrefix}001`
        : 'Enter asset tag...';

    return (
      <div className="ho-item-card" key={item.id}>
        <div className="ho-item-flow">
          <div className="ho-item-step">
            <span className={`ho-item-step-circle ${item.type === 'OUT' ? 'tone-out' : 'tone-in'}`}>{index + 1}</span>
            <span className="ho-item-step-line" />
          </div>

          <div className={`ho-item-panel ho-item-panel-gas${skuDropdownOpen ? ' is-dropdown-open' : ''}`}>
            <div className={`ho-item-panel-head ${item.type === 'OUT' ? 'tone-out' : 'tone-in'}`}>
              <div className="ho-item-panel-title">
                <span className={`ho-direction-pill ${item.type === 'OUT' ? 'tone-out' : 'tone-in'}`}>{item.type}</span>
                <strong>Item #{index + 1}</strong>
              </div>
              {!rowLocked ? (
                <button className="ho-item-remove" onClick={() => removeItem(item.type, item.id)} type="button">
                  <span className="material-icons">delete_outline</span>
                  <span>Remove</span>
                </button>
              ) : null}
            </div>

            {/* Step progress strip */}
            <div className="ho-wizard-steps">
              {stepLabels.map((label, i) => {
                const done = stepsDone[i];
                const active = !done && (i === 0 || stepsDone[i - 1]);
                return (
                  <div key={label} className={`ho-wizard-step${done ? ' is-done' : active ? ' is-active' : ' is-locked'}`}>
                    <span className="ho-wizard-step-num">
                      {done
                        ? <span className="material-icons" style={{ fontSize: 12 }}>check</span>
                        : i + 1}
                    </span>
                    <span className="ho-wizard-step-label">{label}</span>
                  </div>
                );
              })}
            </div>

            {/* Wizard body — fields revealed sequentially */}
            <div className="ho-wizard-body">

              {/* Step 1: Item / SKU — always visible */}
              <div className="ho-wizard-field-wrap">
                <div className="ho-wizard-field-label">
                  <span className="ho-wizard-field-num">1</span>
                  <span>Item / SKU</span>
                </div>
                <div className="ho-sku-picker">
                  <input
                    disabled={rowLocked}
                    onBlur={() => window.setTimeout(() => setActiveSkuDropdown((current) => (current === `${item.type}-${item.id}` ? null : current)), 120)}
                    onChange={(event) => {
                      // Clear confirmation when user edits the field manually
                      setConfirmedSkuIds((current) => { const next = new Set(current); next.delete(item.id); return next; });
                      applySkuBehavior(item.type, item.id, event.target.value);
                    }}
                    onFocus={() => setActiveSkuDropdown(`${item.type}-${item.id}`)}
                    placeholder="Search and select an item or SKU..."
                    value={item.sku}
                  />
                  {skuDropdownOpen ? (
                    <div className="ho-sku-dropdown">
                      {getSkuOptions(item.sku).map((sku) => (
                        <button key={sku} onMouseDown={() => handleSkuSelect(item.type, item.id, sku)} type="button">
                          <strong>{sku}</strong>
                          <small>{resolveSkuMeta(deps?.skuMetaMap, sku)?.category || 'Catalog item'}</small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Step 2: Asset Tag — revealed after SKU selected */}
              {skuDone ? (
                <div className="ho-wizard-field-wrap">
                  <div className="ho-wizard-field-label">
                    <span className="ho-wizard-field-num">2</span>
                    <span>Asset Tag</span>
                  </div>
                  <div className="ho-tag-field-row">
                    <label className="ho-no-tag-toggle">
                      <input
                        disabled={rowLocked}
                        checked={item.noTag}
                        onChange={(event) =>
                          setItemValue(item.type, item.id, {
                            noTag: event.target.checked,
                            tag: '',
                            tagPrefix: event.target.checked ? '' : item.tagPrefix
                          })
                        }
                        type="checkbox"
                      />
                      <span>No Tag</span>
                    </label>
                    <input
                      disabled={item.noTag || rowLocked}
                      onChange={(event) =>
                        setItemValue(item.type, item.id, {
                          tag: normalizeTagInputWithPrefix(event.target.value, item.tagPrefix)
                        })
                      }
                      placeholder={assetTagPlaceholder}
                      value={item.tag}
                    />
                  </div>
                </div>
              ) : null}

              {/* Step 3: Qty & Condition (IN) / Qty (OUT) — unlocked after SKU confirmed.
                   Tagged assets (unique) lock qty to 1 read-only.
                   No-tag / accessory assets keep qty editable. */}
              {skuDone ? (() => {
                const isTagged = !item.noTag && item.tag.trim() !== '';
                const qtyReadOnly = isTagged && !rowLocked;
                return (
                  <div className="ho-wizard-field-wrap ho-wizard-field-wrap--qty">
                    <div className="ho-wizard-qty-row">
                      <span className="ho-wizard-field-label">
                        <span className="ho-wizard-field-num">3</span>
                        <span>{item.type === 'IN' ? 'Qty & Condition' : 'Quantity'}</span>
                      </span>

                      <div className="ho-wizard-qty-control">
                        {qtyReadOnly ? (
                          <span className="ho-wizard-qty-badge">
                            <span className="ho-wizard-qty-badge-num">1</span>
                            <span className="ho-wizard-qty-badge-note">Unique asset</span>
                          </span>
                        ) : (
                          <div className="ho-wizard-qty-stepper">
                            <button
                              className="ho-wizard-qty-btn"
                              disabled={rowLocked || item.qty <= 1}
                              onClick={() => setItemValue(item.type, item.id, { qty: Math.max(1, item.qty - 1) })}
                              type="button"
                              aria-label="Decrease quantity"
                            >−</button>
                            <input
                              className="ho-wizard-qty-num"
                              id={`qty-${item.id}`}
                              disabled={rowLocked}
                              min={1}
                              onChange={(event) => setItemValue(item.type, item.id, { qty: Math.max(1, Number(event.target.value) || 1) })}
                              type="number"
                              value={item.qty}
                            />
                            <button
                              className="ho-wizard-qty-btn"
                              disabled={rowLocked}
                              onClick={() => setItemValue(item.type, item.id, { qty: item.qty + 1 })}
                              type="button"
                              aria-label="Increase quantity"
                            >+</button>
                          </div>
                        )}
                      </div>

                      {item.type === 'IN' ? (
                        <div className="ho-wizard-condition-inline">
                          <span className="ho-wizard-condition-sep">|</span>
                          <label className="ho-condition-pill">
                            <input
                              disabled={rowLocked}
                              checked={item.isBroken}
                              onChange={(event) => setItemValue(item.type, item.id, { isBroken: event.target.checked })}
                              type="checkbox"
                            />
                            <span>Broken</span>
                          </label>
                          <small>Skip stock restore</small>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })() : null}

              {/* OUT only: Shared Asset — revealed after SKU confirmed */}
              {item.type === 'OUT' && skuDone ? (
                <div className="ho-share-card gas">
                  <label className="ho-inline-check gas-share">
                    <input
                      disabled={rowLocked}
                      checked={item.isShared}
                      onChange={(event) => setItemValue(item.type, item.id, { isShared: event.target.checked })}
                      type="checkbox"
                    />
                    <span>Shared Asset</span>
                  </label>

                  {item.isShared ? (
                    <div className="ho-share-grid">
                      <label>
                        <span>Assigned Account</span>
                        <select
                          disabled={rowLocked}
                          onChange={(event) => setItemValue(item.type, item.id, { sharedAccount: event.target.value, sharedDept: '' })}
                          value={item.sharedAccount}
                        >
                          <option value="">Select account...</option>
                          {(deps?.accounts || []).map((account) => (
                            <option key={`${item.id}-${account}`} value={account}>
                              {account}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        <span>Assigned Department</span>
                        <select
                          disabled={rowLocked}
                          onChange={(event) => setItemValue(item.type, item.id, { sharedDept: event.target.value })}
                          value={item.sharedDept}
                        >
                          <option value="">Select department...</option>
                          {departmentOptions.map((dept) => (
                            <option key={`${item.id}-${dept}`} value={dept}>
                              {dept}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}

                  <div className="ho-share-note">When checked, this asset is assigned as a shared asset instead of to an individual employee.</div>
                </div>
              ) : null}

            </div>
          </div>
        </div>
      </div>
    );
  }

  if (depsLoading) {
    return <div className="atlas-card atlas-muted-panel">Loading handover form dependencies...</div>;
  }

  if (depsError || !deps) {
    return <div className="atlas-card atlas-error-panel">{depsError || 'Failed to load handover form dependencies.'}</div>;
  }

  return (
    <>
      {submitting || resumeLoading ? (
        <div className="ho-loading-overlay">
          <div className="ho-loading-card">
            <div className="spinner-border" />
            <strong>{resumeLoading ? 'Loading Handover Document...' : 'Processing Handover...'}</strong>
            <span>{resumeLoading ? 'Restoring the saved BAST payload, signature state, and document detail.' : 'Saving the BAST transaction, generating signatures, and preparing the PDF.'}</span>
          </div>
        </div>
      ) : null}

      <form className="ho-workspace ho-gas-shell" onSubmit={handleSubmit}>

        <div className="card shadow-lg border-0 ho-shell-card">
          <div className="ho-shell-head">
            <span className="ho-shell-title">
              <span className="material-icons">history_edu</span>
              <span>
                {mode === 'WFH'
                  ? 'ASSET HANDOVER FORM WFH (BAST)'
                  : mode === 'WFO'
                    ? 'ASSET HANDOVER FORM WFO (BAST)'
                    : 'ASSET HANDOVER FORM (BAST)'}
              </span>
            </span>

            <div className="ho-shell-actions">
              <button className="ho-header-btn reset" onClick={() => setConfirmIntent('reset')} type="button">
                <span className="material-icons">restart_alt</span>
                <span>RESET / NEW FORM</span>
              </button>
              {strictResumeMode ? (
                <button className="ho-header-btn edit" onClick={handleEnableEditMode} type="button">
                  <span className="material-icons">edit</span>
                  <span>EDIT MODE</span>
                </button>
              ) : null}
              {resumeMode ? (
                <button className="ho-header-btn cancel" onClick={handleCancelResume} type="button">
                  <span className="material-icons">close</span>
                  <span>CANCEL RESUME</span>
                </button>
              ) : null}
              <span className={`ho-form-mode-badge${strictResumeMode ? ' is-resume' : editMode ? ' is-edit' : ''}`}>
                {strictResumeMode
                  ? `RESUME${currentDocId ? ` • ${currentDocId}` : ''}`
                  : editMode
                    ? `EDIT${currentDocId ? ` • ${currentDocId}` : ''}`
                    : 'NEW TRANSACTION'}
              </span>
            </div>
          </div>

          <div className="ho-shell-body">
            {needsModeSelection ? (
              <section className="ho-type-picker-card">
                <div className="ho-card-head gas-picker">
                  <div>
                    <h3>Choose Handover Form Type</h3>
                    <p>Select Standard, WFH, or WFO before filling the form.</p>
                  </div>
                  <span className="ho-mode-badge">MODE: -</span>
                </div>

                <div className="ho-mode-grid gas-picker">
                  <button className="ho-mode-button gas" disabled={modeLocked} onClick={() => selectMode('')} type="button">
                    <strong>Handover Form (BAST)</strong>
                    <span>Standard</span>
                  </button>
                  <button className="ho-mode-button gas" disabled={modeLocked} onClick={() => selectMode('WFH')} type="button">
                    <strong>Handover Form WFH (BAST)</strong>
                    <span>Work From Home</span>
                  </button>
                  <button className="ho-mode-button gas" disabled={modeLocked} onClick={() => selectMode('WFO')} type="button">
                    <strong>Handover Form WFO (BAST)</strong>
                    <span>Work From Office</span>
                  </button>
                </div>
              </section>
            ) : (
              <section className="ho-mode-selected-card">
                <div>
                  <div className="ho-mode-selected-label">Selected form type</div>
                  <div className="ho-mode-selected-value">
                    {mode === 'WFH' ? 'Handover Form WFH (BAST)' : mode === 'WFO' ? 'Handover Form WFO (BAST)' : 'Handover Form (BAST)'}
                  </div>
                </div>
                <div className="ho-mode-selected-actions">
                  <span className="ho-mode-badge">{mode ? `MODE: ${mode}` : 'MODE: STANDARD'}</span>
                  {!modeLocked ? (
                    <button className="ho-mode-change-btn" onClick={openModePicker} type="button">
                      Change
                    </button>
                  ) : null}
                </div>
              </section>
            )}

            <div className={`ho-form-main${needsModeSelection ? ' is-locked' : ''}`}>
              {needsModeSelection ? (
                <div className="ho-form-lock-overlay">
                  <div className="ho-form-lock-card">
                    <span className="material-icons">lock</span>
                    <strong>Select Handover Form Type first</strong>
                    <span>Choose Standard, WFH, or WFO before continuing the transaction.</span>
                  </div>
                </div>
              ) : null}

            <section className="ho-form-section">
              <div className="ho-section-title gas">
                <span>1. USER INFORMATION</span>
              </div>

              <div className="ho-user-grid gas-top">
                <div className={`ho-employee-search ho-name-col${manualEntry ? ' is-manual' : ''}`}>
                  <label>
                    <span>EMPLOYEE NAME</span>
                    <input
                      disabled={identityLocked || selfLocked || (!manualEntry && !!selectedEmployee)}
                      readOnly={selfLocked || (!manualEntry && !!selectedEmployee)}
                      onChange={(event) => {
                        if (manualEntry) {
                          setHolder((current) => ({ ...current, name: event.target.value }));
                          return;
                        }
                        setEmployeeQuery(event.target.value);
                        setEmployeeNikQuery('');
                        setSelectedEmployee(null);
                      }}
                      placeholder="Employee Full Name..."
                      value={manualEntry ? holder.name : employeeQuery}
                    />
                  </label>

                  {!manualEntry ? (
                    <>
                      <div className="ho-db-hint-row">
                        <span className="ho-db-pill">Employee</span>
                        <small>
                          {identityLocked && effectiveHolder.name
                            ? `Locked from saved BAST: ${effectiveHolder.name}${effectiveHolder.nik ? ` (${effectiveHolder.nik})` : ''}`
                            : selfLocked && !selectedEmployee
                            ? 'Loading your account details...'
                            : employeeLookupLoading
                            ? 'Searching employee database...'
                            : selectedEmployee
                            ? `Selected: ${selectedEmployee.fullName || selectedEmployee.employeeKey} (${selectedEmployee.nik || selectedEmployee.email || '-'})${selectedEmployee.account || selectedEmployee.dept ? ` | ${[selectedEmployee.account, selectedEmployee.dept].filter(Boolean).join(' / ')}` : ''}${identityLocked || selfLocked ? '' : ' — click "Change employee" to pick another.'}`
                            : 'Start typing a name or NIK to search.'}
                        </small>
                        {selectedEmployee && !identityLocked && !isPortalUser ? (
                          <button
                            className="ho-change-employee-btn"
                            onClick={() => {
                              setSelectedEmployee(null);
                              setEmployeeQuery('');
                              setEmployeeNikQuery('');
                              setEmployeeOptions([]);
                              setHolder({ name: '', nik: '', email: '', account: '', dept: '' });
                            }}
                            type="button"
                          >
                            <span className="material-icons">edit</span>
                            <span>Change employee</span>
                          </button>
                        ) : null}
                      </div>

                      {(identityLocked || selfLocked) && effectiveHolder.name && !needsModeSelection ? (
                        <div className="ho-employee-dropdown is-static">
                          <div className="ho-employee-locked-card">
                            <div className="ho-emp-row-top">
                              <strong className="ho-emp-name">{effectiveHolder.name}</strong>
                              <div className="ho-emp-badges">
                                {effectiveHolder.account ? <span className="ho-emp-badge">{effectiveHolder.account}</span> : null}
                                {effectiveHolder.dept ? <span className="ho-emp-badge">{effectiveHolder.dept}</span> : null}
                              </div>
                            </div>
                            <div className="ho-emp-row-sub">
                              <code className="ho-emp-nik">{effectiveHolder.nik || effectiveHolder.email || '-'}</code>
                              {effectiveHolder.email ? <span className="ho-emp-email"> • {effectiveHolder.email}</span> : null}
                            </div>
                          </div>
                        </div>
                      ) : employeeOptions.length ? (
                        <div className="ho-employee-dropdown">
                          {employeeOptions.map((option) => (
                            <button key={`${option.employeeKey}-${option.email}`} onClick={() => handleEmployeeSelect(option)} type="button">
                              <div className="ho-emp-row-top">
                                <strong className="ho-emp-name">{option.fullName || option.employeeKey}</strong>
                                <div className="ho-emp-badges">
                                  {option.account ? <span className="ho-emp-badge">{option.account}</span> : null}
                                  {option.dept ? <span className="ho-emp-badge">{option.dept}</span> : null}
                                </div>
                              </div>
                              <div className="ho-emp-row-sub">
                                <code className="ho-emp-nik">{option.nik || option.employeeKey}</code>
                                {option.email ? <span className="ho-emp-email"> • {option.email}</span> : null}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>

                <div className="ho-nik-col">
                  <label>
                    <span>NIK</span>
                    <input
                      disabled={identityLocked || selfLocked || (!manualEntry && !!selectedEmployee)}
                      readOnly={selfLocked || (!manualEntry && !!selectedEmployee)}
                      onChange={(event) => {
                        if (manualEntry) {
                          setHolder((current) => ({ ...current, nik: event.target.value }));
                          return;
                        }
                        setEmployeeNikQuery(event.target.value);
                        setEmployeeQuery('');
                        setSelectedEmployee(null);
                      }}
                      placeholder="00.00.00..."
                      value={manualEntry ? holder.nik : (selectedEmployee ? effectiveHolder.nik : employeeNikQuery)}
                    />
                  </label>

                  {!isWfhRole && !isWfoRole && !isPortalUser ? (
                    <div className="ho-manual-toggle-wrap">
                      <label className="ho-manual-toggle">
                        <input
                          disabled={identityLocked}
                          checked={manualEntry}
                          onChange={(event) => {
                            setManualEntry(event.target.checked);
                            setEmployeeQuery('');
                            setEmployeeNikQuery('');
                            setEmployeeOptions([]);
                            setSelectedEmployee(null);
                            setHolder((current) => ({
                              ...current,
                              name: event.target.checked ? current.name : '',
                              nik: event.target.checked ? current.nik : '',
                              email: '',
                              account: current.account,
                              dept: current.dept
                            }));
                          }}
                          type="checkbox"
                        />
                        <span>Manual entry</span>
                      </label>
                    </div>
                  ) : null}
                </div>
              </div>

              {manualEntry ? (
                <div className="ho-user-grid gas-manual">
                  <label className="span-6">
                    <span>ACCOUNT</span>
                    <select
                      disabled={identityLocked}
                      onChange={(event) => setHolder((current) => ({ ...current, account: event.target.value, dept: '' }))}
                      value={holder.account}
                    >
                      <option value="">Select account...</option>
                      {deps.accounts.map((account) => (
                        <option key={account} value={account}>
                          {account}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="span-6">
                    <span>DEPT</span>
                    <select
                      disabled={identityLocked}
                      onChange={(event) => setHolder((current) => ({ ...current, dept: event.target.value }))}
                      value={holder.dept}
                    >
                      <option value="">Select department...</option>
                      {(holder.account ? deps.accountDeptMap[holder.account] || deps.accountDeptMap[holder.account.toLowerCase()] || deps.departments : deps.departments).map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </section>

            <section className="ho-form-section">
              <div className="ho-section-title gas">
                <span>2. TRANSACTION TYPE</span>
              </div>

              <div className="ho-transaction-inline">
                {(['Check Out', 'Check In', 'Changes'] as const).map((value) => (
                  <label className={`ho-radio-inline${transType === value ? ' is-active' : ''}`} key={value}>
                    <input checked={transType === value} disabled={transactionLocked} onChange={() => setTransType(value)} type="radio" value={value} />
                    <span>
                      {value === 'Check Out'
                        ? 'CHECK OUT (Issue New)'
                        : value === 'Check In'
                          ? 'CHECK IN (Return)'
                          : 'CHANGES (Swap/Replace)'}
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <section className="ho-form-section">
              <div className="ho-section-title gas">
                <span>3. ASSET DETAILS</span>
              </div>

              {showReturnSection ? (
                <section className="ho-surface tone-return gas">
                  <div className="ho-surface-head gas">
                    <div>
                      <strong><span className="material-icons">arrow_back</span> RETURNING ASSETS (Back to IT)</strong>
                    </div>
                  </div>
                  <div className="ho-item-stack">
                    {returnItems.map((item, index) => renderItemRow(item, index))}
                  </div>
                  <button className="ho-outline-action danger" disabled={rowLocked} onClick={() => addItem('IN')} type="button">
                    + Add Item to Return
                  </button>
                </section>
              ) : null}

              {showIssueSection ? (
                <section className="ho-surface tone-issue gas">
                  <div className="ho-surface-head gas">
                    <div>
                      <strong><span className="material-icons">arrow_forward</span> ISSUING ASSETS (Keluar ke User)</strong>
                    </div>
                  </div>

                  <div className="ho-placement-card gas">
                    <div className="ho-placement-head gas">
                      <div className="ho-placement-title">
                        <span className="material-icons">place</span>
                        <span>Lokasi Penempatan Asset</span>
                      </div>
                      <span className="ho-duty-badge">{dutyLocationLabel || 'Belum dipilih'}</span>
                    </div>
                    <div className={`ho-placement-body gas${activePlacementDropdown ? ' is-dropdown-open' : ''}`}>
                      <div className="ho-placement-help">
                        Berlaku untuk semua asset <b>OUT</b> pada transaksi <b>Check Out</b> / item <b>OUT</b> di <b>Changes</b>. Lokasi ini akan otomatis update ke <b>List Asset</b>.
                      </div>
                      <div className={`ho-placement-grid${activePlacementDropdown ? ' is-dropdown-open' : ''}`}>
                        <label>
                          <span>Site / Location</span>
                          <div className="ho-sku-picker ho-placement-picker">
                            <button
                              className="ho-placement-trigger"
                              disabled={mode === 'WFH' || strictResumeMode}
                              onBlur={() => setTimeout(() => setActivePlacementDropdown((current) => (current === 'site' ? null : current)), 120)}
                              onClick={() => setActivePlacementDropdown((current) => (current === 'site' ? null : 'site'))}
                              type="button"
                            >
                              <span>{mode === 'WFH' ? 'WFH' : dutySite || 'Select site...'}</span>
                              <span className="material-icons">expand_more</span>
                            </button>
                            {activePlacementDropdown === 'site' && mode !== 'WFH' ? (
                              <div className="ho-sku-dropdown ho-placement-dropdown">
                                <button
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    setDutySite('');
                                    setDutyFloor('');
                                    setActivePlacementDropdown(null);
                                  }}
                                  type="button"
                                >
                                  <strong>Select site...</strong>
                                  <small>Choose dispatch location</small>
                                </button>
                                {siteOptions.map((site) => (
                                  <button
                                    key={site}
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      setDutySite(site);
                                      setDutyFloor('');
                                      setActivePlacementDropdown(null);
                                    }}
                                    type="button"
                                  >
                                    <strong>{site}</strong>
                                    <small>Available site / location</small>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </label>

                        <label>
                          <span>Floor</span>
                          <div className="ho-sku-picker ho-placement-picker">
                            <button
                              className="ho-placement-trigger"
                              disabled={mode === 'WFH' || floorOptions.length === 0 || strictResumeMode}
                              onBlur={() => setTimeout(() => setActivePlacementDropdown((current) => (current === 'floor' ? null : current)), 120)}
                              onClick={() => setActivePlacementDropdown((current) => (current === 'floor' ? null : 'floor'))}
                              type="button"
                            >
                              <span>{mode === 'WFH' ? 'WFH only' : dutyFloor || 'Select floor...'}</span>
                              <span className="material-icons">expand_more</span>
                            </button>
                            {activePlacementDropdown === 'floor' && mode !== 'WFH' && floorOptions.length > 0 ? (
                              <div className="ho-sku-dropdown ho-placement-dropdown">
                                <button
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    setDutyFloor('');
                                    setActivePlacementDropdown(null);
                                  }}
                                  type="button"
                                >
                                  <strong>Select floor...</strong>
                                  <small>Choose floor / area</small>
                                </button>
                                {floorOptions.map((floor) => (
                                  <button
                                    key={floor}
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      setDutyFloor(floor);
                                      setActivePlacementDropdown(null);
                                    }}
                                    type="button"
                                  >
                                    <strong>{floor}</strong>
                                    <small>Available floor</small>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </label>
                      </div>
                      <div className="ho-placement-help subtle">
                        Select <b>site</b> and <b>floor</b> for the asset dispatch location.
                      </div>
                    </div>
                  </div>

                  <div className="ho-item-stack">
                    {issueItems.map((item, index) => renderItemRow(item, index))}
                  </div>
                  <button className="ho-outline-action success" disabled={rowLocked} onClick={() => addItem('OUT')} type="button">
                    + Add Item to Issue
                  </button>
                </section>
              ) : null}

              <label className="ho-notes-block gas">
                <span>NOTES / REMARK</span>
                <textarea
                  disabled={strictResumeMode}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="e.g. Replacement laptop due to hardware failure..."
                  rows={2}
                  value={notes}
                />
              </label>
            </section>

            <section className="ho-form-section">
              <div className="ho-section-title gas">
                <span>4. SIGNATURE</span>
              </div>

              <div className="ho-signature-grid gas">
                <div className="sig-card">
                  <div className="sig-card-head">
                    <div className="text-start">
                      <div className="sig-title">User / Employee</div>
                    </div>

                    <div className="sig-controls">
                      <select
                        className="sig-select"
                        disabled={userSignatureLocked || isWfhWfoRole}
                        onChange={(event) => setUserSigType(event.target.value as 'RECIPIENT' | 'ACKNOWLEDGEMENT')}
                        value={isWfhWfoRole ? 'RECIPIENT' : userSigType}
                      >
                        <option value="RECIPIENT">User Signature</option>
                        <option value="ACKNOWLEDGEMENT">Acknowledgement (Representative)</option>
                      </select>

                      <button className="sig-clear-btn" disabled={userSignatureLocked} onClick={() => clearSignature('user')} type="button">
                        <span className="material-icons">restart_alt</span>
                        <span>Clear</span>
                      </button>
                    </div>
                  </div>

                  <div className="sig-note">
                    {userSigType === 'ACKNOWLEDGEMENT' ? 'Signed by the employee representative.' : 'Signed by the employee.'}
                  </div>

                  {userSigType === 'ACKNOWLEDGEMENT' ? (
                    <div className="sig-rep-search">
                      <label className="ho-inline-field sig-rep-field">
                        <span>Representative Name</span>
                        <input
                          disabled={userSignatureLocked || !!selectedRep}
                          readOnly={!!selectedRep}
                          onChange={(event) => {
                            setRepQuery(event.target.value);
                            if (selectedRep) {
                              setSelectedRep(null);
                              setRepOptions([]);
                            }
                          }}
                          placeholder="Search employee..."
                          value={selectedRep ? selectedRep.fullName : repQuery}
                        />
                      </label>
                      {!selectedRep ? (
                        <div className="ho-db-hint-row">
                          <small>
                            {repLookupLoading
                              ? 'Searching employee database...'
                              : repQuery.trim().length >= 2
                              ? repOptions.length === 0
                                ? 'No matches found.'
                                : `${repOptions.length} result${repOptions.length === 1 ? '' : 's'} found — select below.`
                              : 'Type at least 2 characters to search.'}
                          </small>
                        </div>
                      ) : (
                        <div className="ho-db-hint-row">
                          <small>
                            {`${selectedRep.fullName}${selectedRep.nik ? ` (${selectedRep.nik})` : ''}${selectedRep.email ? ` • ${selectedRep.email}` : ''}`}
                          </small>
                          {!userSignatureLocked ? (
                            <button
                              className="ho-change-employee-btn"
                              onClick={() => { setSelectedRep(null); setRepQuery(''); setRepOptions([]); }}
                              type="button"
                            >
                              <span className="material-icons">edit</span>
                              <span>Change rep</span>
                            </button>
                          ) : null}
                        </div>
                      )}
                      {!selectedRep && repOptions.length ? (
                        <div className="ho-employee-dropdown">
                          {repOptions.map((option) => (
                            <button
                              key={`${option.employeeKey}-${option.email}`}
                              onClick={() => { setSelectedRep(option); setRepQuery(option.fullName); setRepOptions([]); }}
                              type="button"
                            >
                              <div className="ho-emp-row-top">
                                <strong className="ho-emp-name">{option.fullName || option.employeeKey}</strong>
                                <div className="ho-emp-badges">
                                  {option.account ? <span className="ho-emp-badge">{option.account}</span> : null}
                                  {option.dept ? <span className="ho-emp-badge">{option.dept}</span> : null}
                                </div>
                              </div>
                              <div className="ho-emp-row-sub">
                                <code className="ho-emp-nik">{option.nik || option.employeeKey}</code>
                                {option.email ? <span className="ho-emp-email"> • {option.email}</span> : null}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {userSignatureLocked ? (
                    <SignaturePreviewCard
                      imageUrl={existingUserSignature.fileUrl || existingUserSignature.inlineDataUrl}
                      label="User / Employee"
                      note={existingUserSignature.label || (userSigType === 'ACKNOWLEDGEMENT' ? 'Signed by the employee representative.' : 'Signed by the employee.')}
                      statusLabel="Signed"
                    />
                  ) : (
                    <SignatureCanvas
                      label="User / Employee"
                      note={userSigType === 'ACKNOWLEDGEMENT' ? 'Signed by the employee representative.' : 'Signed by the employee.'}
                      onChange={setUserSignature}
                      resetToken={userSignatureResetToken}
                    />
                  )}
                </div>

                <div className="sig-card">
                  <div className="sig-card-head">
                    <div className="text-start">
                      <div className="sig-title">IT Operations</div>
                    </div>

                    {!isPortalUser ? (
                      <div className="sig-controls">
                        <select className="sig-select" disabled={itSignatureLocked} onChange={(event) => setItSignerName(event.target.value)} value={itSignerName}>
                          <option value="">Select IT Ops signer...</option>
                          {signers.map((signer) => (
                            <option key={signer} value={signer}>
                              {signer}
                            </option>
                          ))}
                        </select>

                        <button className="sig-clear-btn" disabled={itSignatureLocked} onClick={() => clearSignature('it')} type="button">
                          <span className="material-icons">restart_alt</span>
                          <span>Clear</span>
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {isPortalUser ? (
                    <div className="sig-note sig-locked-notice">
                      <span className="material-icons" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 6 }}>lock</span>
                      IT Operations signature will be completed by the IT team after submission.
                    </div>
                  ) : (
                    <>
                      <div className="sig-note">Signed by: {itSignerName || existingItSignature.label || text(user.fullName) || text(user.email) || '-'}</div>

                      {itSignatureLocked ? (
                        <SignaturePreviewCard
                          imageUrl={existingItSignature.fileUrl || existingItSignature.inlineDataUrl}
                          label="IT Operations"
                          note={`Signed by: ${existingItSignature.label || itSignerName || text(user.fullName) || text(user.email) || '-'}`}
                          statusLabel="Signed"
                        />
                      ) : (
                        <SignatureCanvas accent="it" label="IT Operations" note={`Signed by: ${itSignerName || text(user.fullName) || text(user.email) || '-'}`} onChange={setItSignature} resetToken={itSignatureResetToken} />
                      )}
                    </>
                  )}
                </div>
              </div>

              {formMessage ? (
                <div className={`ho-form-message ${formMessage.kind === 'error' ? 'is-error' : formMessage.kind === 'success' ? 'is-success' : 'is-info'}`}>
                  {formMessage.text}
                </div>
              ) : null}

              <div className="d-grid">
                <button className="ho-finalize-btn" disabled={submitting} type="submit">
                  <span className="material-icons">verified</span>
                  <span>{submitting ? 'Finalizing...' : 'FINALIZE & GENERATE PDF'}</span>
                </button>
              </div>
            </section>
            </div>
          </div>
        </div>
      </form>

      {confirmIntent ? (
        <div className="ho-confirm-backdrop">
          <div className="ho-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="ho-confirm-title">
            <div className="ho-confirm-head">
              <div className="ho-confirm-headline">
                <span className="material-icons">warning</span>
                <span>Confirmation</span>
              </div>
              <button className="ho-confirm-close" onClick={() => setConfirmIntent(null)} type="button">
                <span className="material-icons">close</span>
              </button>
            </div>

            <div className="ho-confirm-body">
              <h3 id="ho-confirm-title">
                {confirmIntent === 'enableEdit'
                  ? 'Enable Edit Mode'
                  : 'Reset / New Form'}
              </h3>
              <p>
                {confirmIntent === 'enableEdit'
                  ? 'You are about to unlock an On Hold transaction to make changes. Existing signatures will be reset and must be re-signed. Continue?'
                  : 'All unsaved data will be lost and the form will reset to initial state. Continue?'}
              </p>
            </div>

            <div className="ho-confirm-actions">
              <button className="ho-confirm-btn subtle" onClick={() => setConfirmIntent(null)} type="button">
                BATAL
              </button>
              <button className="ho-confirm-btn danger" onClick={handleConfirmAction} type="button">
                {confirmIntent === 'enableEdit' ? 'YA, LANJUTKAN' : 'YA, RESET'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
