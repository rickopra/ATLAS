import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { Prisma, type Asset } from '@prisma/client';
import { env } from '../config.js';
import { prisma } from '../db.js';

type JsonRecord = Record<string, unknown>;

type ActorMeta = {
  id: string;
  email: string;
  fullName?: string | null;
  roles?: string[];
};

type EmployeeCandidate = {
  employeeKey: string;
  nik: string;
  fullName: string;
  email: string;
  account: string;
  dept: string;
  title: string;
  score: number;
  source: string;
};

type NormalizedItem = {
  type: 'IN' | 'OUT';
  tag: string;
  sku: string;
  qty: number;
  isBroken: boolean;
  isShared: boolean;
  sharedAccount: string;
  sharedDept: string;
};

type ResolvedHolderMeta = {
  employeeKey: string;
  nik: string;
  fullName: string;
  email: string;
  account: string;
  dept: string;
  title: string;
  resolved: boolean;
  mode: 'EMPLOYEE_DB' | 'MANUAL_ENTRY';
};

const PDF_FONT_REGULAR = 'Helvetica';
const PDF_FONT_BOLD = 'Helvetica-Bold';
const PDF_PAGE_MARGIN = 44;
const PDF_PAGE_BOTTOM_GAP = 44;

const HANDOVER_IT_SIGNERS_SEED = [
  'Edy Rizky',
  'Salmon Pratama Simanjuntak',
  'Franciscus Candra Wibowo',
  'Hanada Firmandri',
  'Ilcham Nugroho',
  'Noviawindar Pradita',
  'Ridzka Aldian Dzulfakar',
  'Yoga Faturahman',
  'Gilbert Wijaya Simanjuntak',
  'Ricko Prayudha',
  'Ari Setiawan'
];

function text(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function asInt(value: unknown, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.trunc(numeric);
}

function normalizeAssetTag(value: unknown) {
  const normalized = text(value).toUpperCase();
  if (!normalized) return '';
  if (normalized === 'NO TAG' || normalized === 'NOTAG' || normalized === 'NO-TAG') return 'NO-TAG';
  return normalized;
}

function cleanNik(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  const compact = raw.replace(/[\s./-]/g, '').toUpperCase();
  if (!compact) return '';
  if (['-', 'N/A', 'NA', 'NONE', 'NULL', 'UNKNOWN', 'TBD'].includes(compact)) return '';
  if (/^0+$/.test(compact)) return '';
  return raw;
}

function normalizeName(value: unknown) {
  return text(value).replace(/\s+/g, ' ').trim();
}

function makeHolderKey(meta: Pick<ResolvedHolderMeta | EmployeeCandidate, 'nik' | 'email' | 'fullName'>) {
  return lower(meta.nik || meta.email || meta.fullName);
}

function scoreEmployee(candidate: Omit<EmployeeCandidate, 'score' | 'source'>, query: string) {
  const q = lower(query);
  if (!q) return 0;
  let score = 0;
  if (lower(candidate.employeeKey) === q) score += 120;
  if (lower(candidate.nik) === q) score += 110;
  if (lower(candidate.email) === q) score += 100;
  if (lower(candidate.fullName) === q) score += 95;
  if (lower(candidate.fullName).startsWith(q)) score += 30;
  if (lower(candidate.fullName).includes(q)) score += 18;
  if (lower(candidate.email).includes(q)) score += 16;
  if (lower(candidate.account).includes(q)) score += 8;
  if (lower(candidate.dept).includes(q)) score += 8;
  return score;
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return [...new Set(values.map((entry) => text(entry)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function buildDisplayDate(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
}

function buildDisplayDateOnly(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatIsoStamp(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
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

function parseJsonArray(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function hasSignatureData(value: unknown, points?: unknown) {
  const dataUrl = text(value);
  const pointGroups = Array.isArray(points) ? points : [];
  return (dataUrl.startsWith('data:image') && dataUrl.length > 100) || pointGroups.length > 0;
}

function hasStoredSignature(payload: JsonRecord | null, who: 'IT' | 'USER') {
  if (!payload) return false;
  if (who === 'IT') {
    return (
      hasSignatureData(payload.sigIT, payload.sigITData)
      || Boolean(text(payload.sigITFileUrl))
      || Boolean(text(payload.sigITFilePath))
    );
  }

  return (
    hasSignatureData(payload.sigUser, payload.sigUserData)
    || Boolean(text(payload.sigUserFileUrl))
    || Boolean(text(payload.sigUserFilePath))
  );
}

function isBrokenItem(item: Partial<NormalizedItem> | JsonRecord | null | undefined) {
  if (!item) return false;
  if (item.isBroken === true) return true;
  const raw = lower((item as JsonRecord).condition || item.isBroken || (item as JsonRecord).broken);
  return ['1', 'true', 'yes', 'y', 'broken', 'damaged', 'rusak'].includes(raw);
}

function buildSharedDetail(item: Pick<NormalizedItem, 'isShared' | 'sharedAccount' | 'sharedDept'>) {
  if (!item.isShared) return '';
  const parts = [];
  if (text(item.sharedAccount)) parts.push(`Account: ${text(item.sharedAccount)}`);
  if (text(item.sharedDept)) parts.push(`Dept: ${text(item.sharedDept)}`);
  return parts.length ? `Sharing Asset [${parts.join(' | ')}]` : 'Sharing Asset';
}

function buildQtyDisplay(direction: string, quantity: number, broken: boolean) {
  if (direction === 'OUT') return `-${quantity}`;
  if (broken) return '0';
  return `+${quantity}`;
}

function slugify(value: string) {
  return text(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildAccessoryTag(sku: string) {
  const core = slugify(sku || 'ITEM') || 'ITEM';
  return core.startsWith('ACC-') ? core : `ACC-${core}`;
}

function fileContentType(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function storageRoot() {
  return path.resolve(env.ATLAS_STORAGE_DIR || '/atlas-data/storage');
}

function handoverStorageDir(kind: 'pdfs' | 'signatures') {
  return path.join(storageRoot(), 'handover', kind);
}

function publicFileUrl(kind: 'pdfs' | 'signatures', fileName: string) {
  return `/api/files/handover/${kind}/${encodeURIComponent(fileName)}`;
}

function resolveStoredFilePath(kind: string, fileName: string) {
  const safeKind = kind === 'pdfs' || kind === 'signatures' ? kind : '';
  const safeName = path.basename(fileName);
  if (!safeKind || !safeName) return null;
  const base = handoverStorageDir(safeKind);
  const resolved = path.resolve(base, safeName);
  if (!resolved.startsWith(path.resolve(base))) return null;
  return resolved;
}

function dataUrlToBuffer(dataUrl: string) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], 'base64')
  };
}

function saveSignatureFile(docNumber: string, who: 'SIG_IT' | 'SIG_USER', dataUrl: string) {
  const parsed = dataUrlToBuffer(dataUrl);
  if (!parsed) return null;
  ensureDir(handoverStorageDir('signatures'));
  const fileName = `${slugify(docNumber)}_${who}.png`;
  const absolutePath = path.join(handoverStorageDir('signatures'), fileName);
  fs.writeFileSync(absolutePath, parsed.buffer);
  return {
    fileName,
    absolutePath,
    publicUrl: publicFileUrl('signatures', fileName)
  };
}

function createPdfDocument(filePath: string) {
  ensureDir(path.dirname(filePath));
  const document = new PDFDocument({
    size: 'A4',
    margin: PDF_PAGE_MARGIN
  });
  const stream = fs.createWriteStream(filePath);
  document.pipe(stream);
  return { document, stream };
}

function pdfBottomLimit(doc: PDFKit.PDFDocument) {
  return doc.page.height - PDF_PAGE_BOTTOM_GAP;
}

function ensurePdfSpace(doc: PDFKit.PDFDocument, y: number, requiredHeight: number, nextPageY = PDF_PAGE_MARGIN) {
  if (y + requiredHeight <= pdfBottomLimit(doc)) return y;
  doc.addPage();
  return nextPageY;
}

function drawItemsTableHeader(
  doc: PDFKit.PDFDocument,
  columns: Array<{ label: string; width: number; align: 'center' | 'left' }>,
  tableX: number,
  tableWidth: number,
  y: number,
  headerHeight: number
) {
  doc.save();
  doc.rect(tableX, y, tableWidth, headerHeight).fillColor('#f7f7f7').fill();
  doc.restore();
  doc.rect(tableX, y, tableWidth, headerHeight).lineWidth(1).strokeColor('#111111').stroke();
  doc.font(PDF_FONT_BOLD).fontSize(10.2).fillColor('#111111');

  let x = tableX;
  for (const column of columns) {
    doc.text(column.label, x, y + 7, { width: column.width, align: column.align });
    x += column.width;
    if (x < tableX + tableWidth) {
      doc.moveTo(x, y).lineTo(x, y + headerHeight).lineWidth(1).strokeColor('#111111').stroke();
    }
  }

  return y + headerHeight;
}

function upper(value: unknown) {
  return text(value).toUpperCase();
}

function drawStatusStamp(doc: PDFKit.PDFDocument, status: string) {
  const normalized = lower(status);
  const isCompleted = normalized === 'completed';
  const isOnHold = normalized === 'on hold';
  const isCancelled = normalized === 'cancelled';
  if (!isCompleted && !isOnHold && !isCancelled) return;

  const label = isCompleted ? 'COMPLETED' : isOnHold ? 'ON HOLD' : 'CANCELLED';
  const stroke = isCompleted ? '#0f5132' : isOnHold ? '#856404' : '#991b1b';
  const width = 130;
  const height = 32;
  const x = doc.page.width - 100 - width;
  const y = 90;

  doc.save();
  doc.lineWidth(2);
  doc.roundedRect(x, y, width, height, 12).strokeColor(stroke).stroke();
  doc.restore();
  doc.font(PDF_FONT_BOLD).fontSize(12).fillColor(stroke).text(label, x, y + 8, { width, align: 'center' });
}

function drawMetaRows(doc: PDFKit.PDFDocument, rows: Array<[string, string]>, x: number, y: number) {
  let cursorY = y;
  rows.forEach(([label, value]) => {
    doc.font(PDF_FONT_BOLD).fontSize(11).fillColor('#111111').text(label, x, cursorY, { width: 140 });
    doc.font(PDF_FONT_BOLD).fontSize(11).fillColor('#111111').text(':', x + 140, cursorY, { width: 8, align: 'center' });
    doc.font(PDF_FONT_REGULAR).fontSize(11).fillColor('#111111').text(value || '-', x + 150, cursorY, { width: 290 });
    cursorY += 20;
  });
  return cursorY;
}

function drawItemsTable(doc: PDFKit.PDFDocument, items: Array<NormalizedItem & { sn?: string }>, startY: number) {
  const columns = [
    { label: 'No', width: 30, align: 'center' as const },
    { label: 'Status', width: 138, align: 'center' as const },
    { label: 'Item Name', width: 107, align: 'center' as const },
    { label: 'Qty', width: 40, align: 'center' as const },
    { label: 'Asset Tag', width: 108, align: 'center' as const },
    { label: 'S/N', width: 52, align: 'center' as const }
  ];
  const tableX = 60;
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const headerHeight = 24;
  let y = ensurePdfSpace(doc, startY, headerHeight + 32);
  y = drawItemsTableHeader(doc, columns, tableX, tableWidth, y, headerHeight);

  items.forEach((item, index) => {
    const statusLabel = item.type === 'OUT' ? 'ISSUED TO USER' : item.isBroken ? 'RETURNED TO IT - BROKEN' : 'RETURNED TO IT';
    const sharedDetail = buildSharedDetail(item);
    const fullStatusInfo = sharedDetail ? `${statusLabel}\n${sharedDetail}` : statusLabel;
    const rowHeight = sharedDetail ? 40 : 32;

    y = ensurePdfSpace(doc, y, rowHeight, PDF_PAGE_MARGIN);
    if (y === PDF_PAGE_MARGIN) {
      y = drawItemsTableHeader(doc, columns, tableX, tableWidth, y, headerHeight);
    }

    doc.rect(tableX, y, tableWidth, rowHeight).lineWidth(1).strokeColor('#111111').stroke();

    const cells = [
      { value: String(index + 1), width: columns[0].width, align: 'center' as const },
      { value: fullStatusInfo, width: columns[1].width, align: 'left' as const },
      { value: item.sku || '-', width: columns[2].width, align: 'left' as const },
      { value: String(item.qty), width: columns[3].width, align: 'center' as const },
      { value: item.tag || '-', width: columns[4].width, align: 'center' as const },
      { value: text(item.sn) || '-', width: columns[5].width, align: 'center' as const }
    ];

    let x = tableX;
    cells.forEach((cell, cellIndex) => {
      const topOffset = cellIndex === 1 && sharedDetail ? 5 : 8;
      const isSharedStatusCell = cellIndex === 1 && sharedDetail;
      doc
        .font(isSharedStatusCell ? PDF_FONT_BOLD : PDF_FONT_REGULAR)
        .fontSize(isSharedStatusCell ? 8 : 10.2)
        .fillColor('#111111');
      doc.text(cell.value, x + 4, y + topOffset, { width: cell.width - 8, align: cell.align });
      x += cell.width;
      if (x < tableX + tableWidth) {
        doc.moveTo(x, y).lineTo(x, y + rowHeight).lineWidth(1).strokeColor('#111111').stroke();
      }
    });

    y += rowHeight;
  });

  return y;
}

function writeSignatureBox(
  doc: PDFKit.PDFDocument,
  title: string,
  primaryCaption: string,
  secondaryCaption: string | null,
  imagePath: string | null,
  x: number,
  y: number,
  width: number
) {
  doc.font(PDF_FONT_BOLD).fontSize(9.5).fillColor('#111111').text(title, x, y, { width, align: 'center' });

  if (imagePath && fs.existsSync(imagePath)) {
    try {
      doc.image(imagePath, x + 4, y + 20, { fit: [width - 8, 105], align: 'center', valign: 'center' });
    } catch {}
  }

  doc.moveTo(x, y + 128).lineTo(x + width, y + 128).lineWidth(1.2).strokeColor('#111111').stroke();
  doc.font(PDF_FONT_BOLD).fontSize(9).fillColor('#111111').text(primaryCaption || '-', x, y + 135, { width, align: 'center' });
  if (secondaryCaption) {
    doc.font(PDF_FONT_BOLD).fontSize(9).fillColor('#111111').text(secondaryCaption, x, y + 149, { width, align: 'center' });
  }
}

function buildPdfFile(
  docNumber: string,
  payload: JsonRecord,
  items: NormalizedItem[],
  status: string,
  userSignaturePath: string | null,
  itSignaturePath: string | null,
  cancelInfo?: { by?: string; ts?: string; reason?: string } | null
) {
  ensureDir(handoverStorageDir('pdfs'));
  const fileName = `${slugify(docNumber)}.pdf`;
  const absolutePath = path.join(handoverStorageDir('pdfs'), fileName);
  const { document, stream } = createPdfDocument(absolutePath);
  const contentX = 60;
  const contentWidth = 475;
  const signatureBlockHeight = 170;

  const userSigType = upper(text(payload.userSigType || 'RECIPIENT'));
  const repName = text(payload.repName);
  const holderName = text(payload.userName);
  const holderNik = text(payload.userNIK);
  const holderAccount = text(payload.userAcc);
  const holderDept = text(payload.userDept);
  const now = new Date();
  const dutyLocationLabel = text(payload.dutyLocationLabel) || (text(payload.transType) === 'Check In' ? 'IT Room' : '-');
  const bastMode = upper(text(payload.bastMode));
  const transactionBase = (() => {
    const t = lower(payload.transType);
    if (t.includes('check out')) return 'CHECK OUT';
    if (t.includes('check in')) return 'CHECK IN';
    if (t.includes('changes')) return 'CHANGES';
    return text(payload.transType) || '-';
  })();
  const transactionLabel = bastMode === 'WFH' || bastMode === 'WFO' ? `${transactionBase} ${bastMode}` : transactionBase;
  const fallbackPdfItem: NormalizedItem & { sn?: string } = {
    type: 'OUT',
    tag: '-',
    sku: '-',
    qty: 1,
    isBroken: false,
    isShared: false,
    sharedAccount: '',
    sharedDept: '',
    sn: '-'
  };
  const preparedItems = (items.length ? items : [fallbackPdfItem]).map((item) => ({
    ...item,
    sn: text((item as unknown as JsonRecord).sn) || '-'
  }));
  const sharedDetails = preparedItems
    .map((item, index) => {
      const detail = buildSharedDetail(item);
      if (!detail) return null;
      return `${index + 1}. ${item.sku || '-'} (${item.tag || '-'}) - ${detail}`;
    })
    .filter(Boolean) as string[];

  const metaRows: Array<[string, string]> = [
    ['Date', buildDisplayDateOnly(now)],
    ['User Name', holderName || '-'],
    ['NIK', holderNik || '-'],
    ['Account', holderAccount || '-'],
    ['Department', holderDept || '-'],
    ['Deployment Location', dutyLocationLabel || '-'],
    ['Transaction Type', transactionLabel || '-']
  ];

  document.font(PDF_FONT_BOLD).fontSize(14).fillColor('#1e2f5d').text('ATI BUSINESS GROUP', 0, 44, { align: 'center' });
  document.font(PDF_FONT_BOLD).fontSize(13).fillColor('#111111').text('ASSET HANDOVER REPORT (BAST)', 0, 61, { align: 'center' });
  document.font(PDF_FONT_REGULAR).fontSize(8.8).fillColor('#111111').text(`Doc No: ${docNumber}`, 0, 77, { align: 'center' });
  drawStatusStamp(document, status);

  let cursorY = drawMetaRows(document, metaRows, 105, 115) + 8;
  cursorY = drawItemsTable(document, preparedItems, cursorY + 2);

  const remarksText = text(payload.notes) || '-';
  document.font(PDF_FONT_REGULAR).fontSize(9.5).fillColor('#111111');
  const remarksTextHeight = document.heightOfString(remarksText, {
    width: contentWidth - 12,
    lineGap: 1
  });
  const remarksHeight = Math.max(34, Math.ceil(remarksTextHeight) + 14);
  cursorY = ensurePdfSpace(document, cursorY + 8, remarksHeight + 28);

  document.font(PDF_FONT_BOLD).fontSize(8.5).fillColor('#111111').text('Notes / Remarks:', contentX, cursorY + 8);
  document.rect(contentX, cursorY + 20, contentWidth, remarksHeight).lineWidth(1).strokeColor('#111111').stroke();
  document.font(PDF_FONT_REGULAR).fontSize(9.5).fillColor('#111111').text(remarksText, contentX + 6, cursorY + 28, {
    width: contentWidth - 12,
    lineGap: 1
  });
  cursorY += remarksHeight + 28;

  if (sharedDetails.length) {
    const sharedHeight = Math.max(30, 16 + sharedDetails.length * 14);
    cursorY = ensurePdfSpace(document, cursorY + 4, sharedHeight + 24);
    document.font(PDF_FONT_BOLD).fontSize(8.5).fillColor('#111111').text('Shared Asset Details:', contentX, cursorY + 4);
    document.rect(contentX, cursorY + 16, contentWidth, sharedHeight).lineWidth(1).strokeColor('#111111').stroke();
    document.font(PDF_FONT_REGULAR).fontSize(8.5).fillColor('#111111').text(sharedDetails.join('\n'), contentX + 8, cursorY + 24, {
      width: contentWidth - 16,
      lineGap: 1
    });
    cursorY += sharedHeight + 24;
  }

  const disclaimer = [
    'In the event of damage or loss to the borrowed item, the borrower will be responsible for all associated costs.',
    '',
    'If the asset is damaged, IT will provide a replacement under the following conditions:',
    '- The asset was received within the past 7 days.',
    '- The damage is due to manufacturing defects.',
    '- The asset is returned in the same physical condition as it was received.',
    '',
    "Any damage caused by user negligence, including but not limited to exposure to liquids, damage from unauthorized disassembly",
    "or repair, tampering with warranty seals, physical damage, or alterations to the asset's physical condition, will be the responsibility",
    'of the borrower, and all associated costs will be charged according to the applicable Standard Operating Procedure (SOP).'
  ].join('\n');
  document.font(PDF_FONT_REGULAR).fontSize(8.5).fillColor('#111111');
  const disclaimerTextHeight = document.heightOfString(disclaimer, {
    width: contentWidth - 16,
    lineGap: 1
  });
  const disclaimerHeight = Math.max(104, Math.ceil(disclaimerTextHeight) + 18);
  cursorY = ensurePdfSpace(document, cursorY + 4, disclaimerHeight + 28);

  document.font(PDF_FONT_BOLD).fontSize(8.5).fillColor('#111111').text('Disclaimer:', contentX, cursorY + 4);
  document.rect(contentX, cursorY + 16, contentWidth, disclaimerHeight).lineWidth(1).strokeColor('#111111').stroke();
  document.font(PDF_FONT_REGULAR).fontSize(8.5).fillColor('#111111').text(disclaimer, contentX + 8, cursorY + 24, {
    width: contentWidth - 16,
    lineGap: 1
  });
  cursorY += disclaimerHeight + 28;

  // CANCELLATION NOTICE
  if (cancelInfo) {
    const cancelBy = text(cancelInfo.by) || '-';
    const cancelTs = cancelInfo.ts ? (() => {
      try { return new Date(cancelInfo.ts!).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
      catch { return cancelInfo.ts ?? '-'; }
    })() : '-';
    const cancelReason = text(cancelInfo.reason) || 'No reason provided.';
    const cancelBodyText = `Cancelled by: ${cancelBy}   |   Date: ${cancelTs}\nReason: ${cancelReason}`;
    document.font(PDF_FONT_REGULAR).fontSize(9).fillColor('#991b1b');
    const cancelBodyHeight = document.heightOfString(cancelBodyText, { width: contentWidth - 16, lineGap: 2 });
    const cancelBoxHeight = Math.max(44, Math.ceil(cancelBodyHeight) + 20);
    cursorY = ensurePdfSpace(document, cursorY, cancelBoxHeight + 20);

    document.save();
    document.rect(contentX, cursorY, contentWidth, cancelBoxHeight).fillColor('#fff1f2').fill();
    document.restore();
    document.rect(contentX, cursorY, contentWidth, cancelBoxHeight).lineWidth(1.5).strokeColor('#f87171').stroke();
    document.font(PDF_FONT_BOLD).fontSize(9.5).fillColor('#991b1b').text('CANCELLATION NOTICE', contentX + 8, cursorY + 7, { width: contentWidth - 16 });
    document.font(PDF_FONT_REGULAR).fontSize(9).fillColor('#991b1b').text(cancelBodyText, contentX + 8, cursorY + 21, { width: contentWidth - 16, lineGap: 2 });
    cursorY += cancelBoxHeight + 12;
  }

  // SIGNATURES
  const userCaption = userSigType === 'ACKNOWLEDGEMENT'
      ? `a.n ${holderName || '-'}${repName ? ` (${repName})` : ''}`
      : (holderName || '-');

  const signatureWidth = 185;
  const signatureGap = 70;
  const signatureLeftX = Math.round((document.page.width - (signatureWidth * 2 + signatureGap)) / 2);
  const signatureRightX = signatureLeftX + signatureWidth + signatureGap;
  cursorY = ensurePdfSpace(document, cursorY + 4, signatureBlockHeight, PDF_PAGE_MARGIN + 12);

  writeSignatureBox(
    document,
    'Handled By (IT Ops)',
    'IT OPERATIONS',
    text(payload.itSignerName) || '-',
    itSignaturePath,
    signatureLeftX,
    cursorY + 4,
    signatureWidth
  );
  writeSignatureBox(
    document,
    userSigType === 'ACKNOWLEDGEMENT' ? 'Received/Handed Over By (Representative)' : 'Received/Handed Over By (User)',
    userCaption,
    null,
    userSignaturePath,
    signatureRightX,
    cursorY + 2,
    signatureWidth
  );

  document.end();

  return new Promise<{ fileName: string; absolutePath: string; publicUrl: string }>((resolve, reject) => {
    stream.on('finish', () => resolve({ fileName, absolutePath, publicUrl: `${publicFileUrl('pdfs', fileName)}?v=${Date.now()}` }));
    stream.on('error', reject);
  });
}

async function searchEmployeeCandidatesInternal(query: string, limit: number) {
  const normalizedQuery = text(query);
  const take = Math.min(Math.max(limit || 10, 1), 25);
  if (normalizedQuery.length < 2) return [];

  const employeeRows = await prisma.employee.findMany({
    where: {
      isActive: true,
      OR: [
        { employeeCode: { contains: normalizedQuery, mode: 'insensitive' } },
        { fullName: { contains: normalizedQuery, mode: 'insensitive' } },
        { email: { contains: normalizedQuery.toLowerCase(), mode: 'insensitive' } },
        { account: { contains: normalizedQuery, mode: 'insensitive' } },
        { department: { contains: normalizedQuery, mode: 'insensitive' } }
      ]
    },
    select: {
      employeeCode: true,
      email: true,
      fullName: true,
      title: true,
      account: true,
      department: true,
      isActive: true
    },
    orderBy: [{ fullName: 'asc' }],
    take: 80
  });

  return employeeRows
    .map((row: any) => ({
      employeeKey: text(row.employeeCode || row.email || row.fullName),
      nik: text(row.employeeCode),
      fullName: normalizeName(row.fullName),
      email: lower(row.email),
      account: text(row.account),
      dept: text(row.department),
      title: text(row.title),
      score: scoreEmployee(
        {
          employeeKey: text(row.employeeCode || row.email || row.fullName),
          nik: text(row.employeeCode),
          fullName: normalizeName(row.fullName),
          email: lower(row.email),
          account: text(row.account),
          dept: text(row.department),
          title: text(row.title)
        },
        normalizedQuery
      ),
      source: 'employee-directory'
    }))
    .sort((left: EmployeeCandidate, right: EmployeeCandidate) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.fullName.localeCompare(right.fullName);
    })
    .slice(0, take);
}

async function resolveHolderMeta(formData: JsonRecord) {
  const manualEntry = Boolean(formData.manualEntry);
  const holderMode = upper(formData.holderMode || (manualEntry ? 'MANUAL_ENTRY' : 'EMPLOYEE_DB'));
  const payload = {
    fullName: normalizeName(formData.userName),
    nik: cleanNik(formData.userNIK),
    email: lower(formData.userEmail),
    account: text(formData.userAcc),
    dept: text(formData.userDept),
    title: ''
  };

  if (holderMode === 'EMPLOYEE_DB') {
    const queryCandidates = uniqueSorted([payload.nik, payload.email, payload.fullName]);
    for (const query of queryCandidates) {
      const matches = await searchEmployeeCandidatesInternal(query, 10);
      const exact = matches.find((entry: EmployeeCandidate) => {
        if (payload.nik && lower(entry.nik) === lower(payload.nik)) return true;
        if (payload.email && lower(entry.email) === lower(payload.email)) return true;
        return payload.fullName && lower(entry.fullName) === lower(payload.fullName);
      });
      if (exact) {
        return {
          employeeKey: exact.employeeKey,
          nik: exact.nik || payload.nik,
          fullName: exact.fullName || payload.fullName,
          email: exact.email || payload.email,
          account: exact.account || payload.account,
          dept: exact.dept || payload.dept,
          title: exact.title,
          resolved: true,
          mode: 'EMPLOYEE_DB'
        } satisfies ResolvedHolderMeta;
      }
    }
  }

  return {
    employeeKey: text(payload.email || payload.nik || payload.fullName),
    nik: payload.nik,
    fullName: payload.fullName,
    email: payload.email,
    account: payload.account,
    dept: payload.dept,
    title: '',
    resolved: false,
    mode: manualEntry ? 'MANUAL_ENTRY' : 'EMPLOYEE_DB'
  } satisfies ResolvedHolderMeta;
}

function normalizeItem(input: unknown) {
  const source = (input && typeof input === 'object' ? input : {}) as JsonRecord;
  const typeRaw = upper(source.type);
  const type = typeRaw.startsWith('IN') ? 'IN' : 'OUT';
  const sku = text(source.sku || source.itemSku || source.itemName || source.name);
  const qty = Math.max(1, asInt(source.qty, 1));
  const tag = normalizeAssetTag(source.tag);
  const isShared = type === 'OUT' && Boolean(source.isShared === true || lower(source.isShared) === 'true');
  const isBroken = type === 'IN' && isBrokenItem(source);

  return {
    type,
    tag: tag || (lower(source.noTag) === 'true' ? 'NO-TAG' : ''),
    sku,
    qty,
    isBroken,
    isShared,
    sharedAccount: isShared ? text(source.sharedAccount || source.assignedAccount) : '',
    sharedDept: isShared ? text(source.sharedDept || source.assignedDept) : ''
  } satisfies NormalizedItem;
}

function buildItemsSummary(items: NormalizedItem[]) {
  return items
    .map((item) => {
      const qtyText = item.qty > 1 ? `(${item.qty} pcs)` : '(1 pc)';
      const brokenText = item.isBroken ? ' [BROKEN RETURN]' : '';
      const sharedText = buildSharedDetail(item);
      return `[${item.type}] ${item.tag || 'NO-TAG'} ${qtyText} - ${item.sku}${brokenText}${sharedText ? ` {${sharedText}}` : ''}`;
    })
    .join(', ');
}

function buildNoTagMovementMap(items: NormalizedItem[]) {
  const map: Record<string, number> = {};
  for (const item of items) {
    const tag = normalizeAssetTag(item.tag);
    if (tag && tag !== 'NO-TAG' && !tag.startsWith('ACC-')) continue;
    const sku = lower(item.sku);
    if (!sku) continue;
    const signed = item.type === 'IN' ? (item.isBroken ? 0 : item.qty) : -item.qty;
    if (!signed) continue;
    map[sku] = (map[sku] || 0) + signed;
  }
  return map;
}

async function ensureAccessoryAsset(tx: Prisma.TransactionClient, sku: string) {
  const normalizedSku = text(sku);
  let asset = await tx.asset.findFirst({
    where: {
      OR: [
        { itemModel: { equals: normalizedSku, mode: 'insensitive' } },
        { assetTag: { equals: buildAccessoryTag(normalizedSku), mode: 'insensitive' } }
      ]
    }
  });
  if (asset) return asset;

  const catalog = await tx.catalogItem.findFirst({
    where: {
      sku: {
        equals: normalizedSku,
        mode: 'insensitive'
      }
    }
  });

  asset = await tx.asset.create({
    data: {
      assetTag: buildAccessoryTag(normalizedSku),
      serialNumber: '-',
      itemModel: normalizedSku,
      category: text(catalog?.category || 'Accessories'),
      quantity: 0,
      status: 'Out of Stock',
      assignedToText: '-',
      location: '',
      ownerAccount: text(catalog?.account)
    }
  });

  return asset;
}

function buildHolderDisplay(holder: ResolvedHolderMeta | { fullName?: string; nik?: string }, isShared: boolean) {
  if (isShared) return 'Shared Asset';
  const fullName = normalizeName(holder.fullName);
  const nik = cleanNik(holder.nik);
  if (!fullName) return nik || '-';
  return nik ? `${fullName} (${nik})` : fullName;
}

function appendRevisionHistory(existing: unknown, entry: JsonRecord) {
  const history = parseJsonArray(existing);
  history.push(entry);
  return history;
}

async function rebuildCurrentSnapshots(tx: Prisma.TransactionClient) {
  // Normalize legacy placeholder values: assignedToText = '-' is treated as unassigned.
  // Runs outside the transaction snapshot so the asset read below sees clean data.
  await prisma.asset.updateMany({
    where: { assignedToText: '-' },
    data: { assignedToText: null }
  });

  const [completedDocs, assets] = await Promise.all([
    tx.handoverDocument.findMany({
      where: {
        status: {
          equals: 'Completed',
          mode: 'insensitive'
        }
      },
      include: {
        items: true
      },
      orderBy: [{ transactionTimestamp: 'asc' }, { createdAt: 'asc' }]
    }),
    tx.asset.findMany()
  ]);

  const assetMap = new Map<string, Asset>();
  assets.forEach((asset) => assetMap.set(normalizeAssetTag(asset.assetTag), asset));

  const holdingMap = new Map<
    string,
    {
      holder: ResolvedHolderMeta;
      assetRef: string;
      itemModel: string;
      category: string;
      quantity: number;
      location: string;
      status: string;
      updatedAt: Date;
      sourceDoc: string;
    }
  >();

  // taggedAssetOwnerKey: maps normalizedTag → holdingMap key of the current owner.
  // Used to ensure unique tagged assets are never double-counted across multiple BASTs.
  const taggedAssetOwnerKey = new Map<string, string>();

  for (const doc of completedDocs) {
    const payload = parseJsonRecord(doc.payloadJson) || {};
    const holder: ResolvedHolderMeta = {
      employeeKey: text(doc.holderEmail || doc.holderNik || doc.holderName),
      nik: cleanNik(doc.holderNik),
      fullName: normalizeName(doc.holderName),
      email: lower(doc.holderEmail),
      account: text(doc.userAccount || payload.userAcc),
      dept: text(doc.holderDepartment || payload.userDept),
      title: '',
      resolved: Boolean(payload.holderResolved),
      mode: upper(payload.holderMode) === 'EMPLOYEE_DB' ? 'EMPLOYEE_DB' : 'MANUAL_ENTRY'
    };

    for (const item of doc.items) {
      if (item.isShared) continue;
      const direction = upper(item.direction).startsWith('IN') ? 'IN' : 'OUT';
      const quantity = Math.max(1, asInt(item.quantity, 1));
      const assetTag = normalizeAssetTag(item.assetTag);
      const assetRef = assetTag && assetTag !== 'NO-TAG' ? assetTag : text(item.itemSku || item.itemName);
      if (!assetRef) continue;
      const sourceKey = `${makeHolderKey(holder)}|${lower(assetRef)}`;
      const current = holdingMap.get(sourceKey) || {
        holder,
        assetRef,
        itemModel: text(item.itemSku || item.itemName),
        category: '',
        quantity: 0,
        location: text(item.dutyLocation),
        status: 'Assigned',
        updatedAt: doc.transactionTimestamp || doc.updatedAt,
        sourceDoc: text(doc.docNumber)
      };
      const asset = assetMap.get(assetTag);
      if (direction === 'OUT') {
        const isTaggedUnique = Boolean(assetTag && assetTag !== 'NO-TAG');
        if (isTaggedUnique) {
          // For unique tagged assets: each OUT is a SET (not accumulate).
          // If a previous holder had this tag, clear their claim first so the
          // asset can't appear in two people's holdings simultaneously.
          const prevOwnerKey = taggedAssetOwnerKey.get(assetTag);
          if (prevOwnerKey && prevOwnerKey !== sourceKey) {
            const prevEntry = holdingMap.get(prevOwnerKey);
            if (prevEntry) prevEntry.quantity = 0;
          }
          current.quantity = quantity; // SET, not +=
          taggedAssetOwnerKey.set(assetTag, sourceKey);
        } else {
          current.quantity += quantity; // accumulate for no-tag / accessory items
        }
        current.updatedAt = doc.transactionTimestamp || doc.updatedAt;
        current.sourceDoc = text(doc.docNumber);
        current.location = text(item.dutyLocation || asset?.location || current.location);
        current.itemModel = text(item.itemSku || item.itemName || asset?.itemModel || current.itemModel);
        current.category = text(asset?.category || current.category);
        current.status = text(asset?.status || 'In Use');
      } else {
        current.quantity = Math.max(0, current.quantity - quantity);
        current.updatedAt = doc.transactionTimestamp || doc.updatedAt;
        current.location = text(asset?.location || current.location || 'IT Room');
        current.status = current.quantity > 0 ? text(asset?.status || 'In Use') : 'Returned';
      }
      holdingMap.set(sourceKey, current);
    }
  }

  const currentHoldings = [...holdingMap.values()].filter((entry) => entry.quantity > 0);

  // Build a map: assetTag → latest BAST timestamp for that tag.
  // Used to distinguish stale Asset.assignedToText (set before or by BAST) from
  // a legitimate manual re-assignment that happened AFTER the last BAST.
  const latestBastTsByTag = new Map<string, number>();
  for (const doc of completedDocs) {
    const ts = doc.transactionTimestamp || doc.updatedAt;
    const tsMs = ts ? ts.getTime() : 0;
    for (const item of doc.items) {
      const tag = normalizeAssetTag(item.assetTag);
      if (!tag || tag === 'NO-TAG') continue;
      const existing = latestBastTsByTag.get(tag) ?? 0;
      if (tsMs > existing) latestBastTsByTag.set(tag, tsMs);
    }
  }

  // Also include assets directly assigned via assignedToText (not via BAST).
  // These cover IT ops direct assignments that have no BAST document, OR manual
  // re-assignments that happened AFTER the last completed BAST for that asset.
  // Rule: if an asset was ever processed by BAST, only trust assignedToText if
  // Asset.updatedAt is strictly NEWER than the latest BAST timestamp — meaning
  // IT updated the assignment manually after the BAST closed.
  const bastCoveredTags = new Set(currentHoldings.map((entry) => normalizeAssetTag(entry.assetRef)));
  const isRealAssignment = (v: unknown) => { const s = text(v); return Boolean(s) && s !== '-'; };
  const directAssignedAssets = assets.filter((asset) => {
    if (!isRealAssignment(asset.assignedToText)) return false;
    const tag = normalizeAssetTag(asset.assetTag);
    if (bastCoveredTags.has(tag)) return false; // already handled by BAST replay above
    const lastBastMs = latestBastTsByTag.get(tag);
    if (lastBastMs) {
      // Asset has BAST history — only use manual assignedToText if it was edited AFTER last BAST
      const assetUpdatedMs = asset.updatedAt ? asset.updatedAt.getTime() : 0;
      return assetUpdatedMs > lastBastMs;
    }
    return true; // no BAST history — direct assignment is the only source, always trust it
  });

  for (const asset of directAssignedAssets) {
    // Parse "Name (NIK)" format used by imported/direct-assigned assets
    const rawAssigned = text(asset.assignedToText);
    const nikMatch = rawAssigned.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    const parsedName = normalizeName(nikMatch ? nikMatch[1] : rawAssigned);
    const parsedNik = nikMatch ? text(nikMatch[2]) : '';
    // Skip shared asset placeholders like "Shared Asset [Account: X]"
    if (lower(parsedName).startsWith('shared asset')) continue;
    const directHolder: ResolvedHolderMeta = {
      employeeKey: parsedNik || lower(parsedName),
      nik: parsedNik,
      fullName: parsedName,
      email: '',
      account: text(asset.assignedAccount),
      dept: text(asset.assignedDept),
      title: '',
      resolved: false,
      mode: 'MANUAL_ENTRY'
    };
    currentHoldings.push({
      holder: directHolder,
      assetRef: normalizeAssetTag(asset.assetTag),
      itemModel: text(asset.itemModel),
      category: text(asset.category),
      quantity: Math.max(1, asInt(asset.quantity, 1)),
      location: text(asset.location),
      status: text(asset.status) || 'In Use',
      updatedAt: asset.updatedAt,
      sourceDoc: ''
    });
  }

  // Reconcile BAST-derived holdings against the current Asset master state.
  // If a tagged asset has been manually unassigned (status = Available, no assignedToText)
  // after a BAST Check-Out with no matching Check-In, remove it from the holdings so the
  // snapshot reflects reality rather than stale BAST replay.
  const reconciledHoldings = currentHoldings.filter((entry) => {
    const tag = normalizeAssetTag(entry.assetRef);
    if (!tag || tag === 'NO-TAG') return true; // no-tag / accessory: keep BAST-derived holding
    const asset = assetMap.get(tag);
    if (!asset) return true; // not in asset master — keep as-is
    const currentlyAvailable =
      lower(asset.status) === 'available' && !isRealAssignment(asset.assignedToText);
    return !currentlyAvailable; // drop if manually freed
  });

  const holdingRows: Prisma.EmployeeAssetHoldingCreateManyInput[] = reconciledHoldings.map((entry) => ({
    sourceHash: createHash('sha1').update(`${makeHolderKey(entry.holder)}|${lower(entry.assetRef)}`).digest('hex'),
    employeeKey: text(entry.holder.employeeKey || entry.holder.email || entry.holder.fullName),
    nik: entry.holder.nik || null,
    fullName: entry.holder.fullName || null,
    email: entry.holder.email || null,
    account: entry.holder.account || null,
    department: entry.holder.dept || null,
    title: entry.holder.title || null,
    assetKind: normalizeAssetTag(entry.assetRef) && normalizeAssetTag(entry.assetRef) !== 'NO-TAG' ? 'TAGGED' : 'NO-TAG',
    assetRef: entry.assetRef,
    itemModel: entry.itemModel || null,
    category: entry.category || null,
    quantity: entry.quantity,
    location: entry.location || null,
    status: entry.status || 'In Use',
    source: 'BAST',
    updatedAt: entry.updatedAt
  }));

  const ledgerRows: Prisma.AssetAssignmentLedgerEntryCreateManyInput[] = reconciledHoldings.map((entry) => ({
    sourceHash: createHash('sha1').update(`ledger|${makeHolderKey(entry.holder)}|${lower(entry.assetRef)}`).digest('hex'),
    assetTag: normalizeAssetTag(entry.assetRef) || null,
    holderKey: text(entry.holder.employeeKey || entry.holder.email || entry.holder.fullName),
    nik: entry.holder.nik || null,
    fullName: entry.holder.fullName || null,
    email: entry.holder.email || null,
    account: entry.holder.account || null,
    department: entry.holder.dept || null,
    docNumber: entry.sourceDoc || null,
    transactionTimestamp: entry.updatedAt,
    assetLocation: entry.location || null,
    resolvedToMaster: Boolean(assetMap.get(normalizeAssetTag(entry.assetRef))),
    masterRow: null,
    source: 'BAST',
    itemModel: entry.itemModel || null,
    category: entry.category || null,
    updatedAt: entry.updatedAt
  }));

  await tx.employeeAssetHolding.deleteMany();
  await tx.assetAssignmentLedgerEntry.deleteMany();
  if (holdingRows.length) await tx.employeeAssetHolding.createMany({ data: holdingRows });
  if (ledgerRows.length) await tx.assetAssignmentLedgerEntry.createMany({ data: ledgerRows });
}

/**
 * Public entry point for on-demand snapshot rebuild triggered by manual asset edits.
 * Runs rebuildCurrentSnapshots inside its own transaction with a 60s timeout.
 */
export async function triggerSnapshotRebuild(): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await rebuildCurrentSnapshots(tx);
    },
    { timeout: 60_000 }
  );
}

function inferModeFromDocNumber(docNumber: string) {
  const normalized = upper(docNumber);
  if (normalized.endsWith('-WFH')) return 'WFH';
  if (normalized.endsWith('-WFO')) return 'WFO';
  return '';
}

function buildDocPrefix(transType: string) {
  const normalized = lower(transType);
  if (normalized === 'check in') return 'CI';
  if (normalized === 'check out') return 'CO';
  if (normalized === 'changes') return 'CH';
  return 'BAST';
}

function buildDutyLocationLabel(formData: JsonRecord, items: NormalizedItem[]) {
  const mode = upper(formData.bastMode);
  if (mode === 'WFH') return 'WFH';
  const explicit = text(formData.dutyLocationLabel);
  if (explicit) return explicit;
  const site = text(formData.dutyLocationSite);
  const floor = text(formData.dutyLocationFloor);
  if (site && floor) return `${site} - ${floor}`;
  if (site) return site;
  return items.some((entry) => entry.type === 'OUT') ? '' : 'IT Room';
}

export async function searchParityHandoverEmployees(query: string, limit = 8) {
  const matches = await searchEmployeeCandidatesInternal(query, limit);
  return {
    success: true,
    items: matches.map((entry: EmployeeCandidate) => ({
      employeeKey: entry.employeeKey,
      nik: entry.nik,
      fullName: entry.fullName,
      email: entry.email,
      account: entry.account,
      dept: entry.dept,
      title: entry.title,
      source: entry.source
    }))
  };
}

export async function getParityHandoverSigners() {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      userRoles: { some: { role: { name: 'IT_OPS' } } }
    },
    select: { fullName: true, email: true },
    orderBy: { fullName: 'asc' }
  });

  // Fallback: if no IT_OPS-role users exist yet (migration window), return seed list
  if (users.length === 0) {
    return { success: true, items: HANDOVER_IT_SIGNERS_SEED.slice() };
  }

  return {
    success: true,
    items: users.map((u) => u.fullName || u.email || '').filter(Boolean)
  };
}

export function getStoredHandoverFilePath(kind: string, fileName: string) {
  return resolveStoredFilePath(kind, fileName);
}

export function getStoredHandoverFileContentType(fileName: string) {
  return fileContentType(fileName);
}

export async function rebuildHandoverPdfAsCancelled(docData: {
  docNumber: string;
  payloadJson: unknown;
  revisionHistoryJson?: unknown;
}): Promise<string> {
  const payload = parseJsonRecord(docData.payloadJson) ?? {};
  const rawItems = Array.isArray(payload.items) ? (payload.items as unknown[]) : [];
  const items: NormalizedItem[] = rawItems.map(normalizeItem);
  const userSigPath = text(payload.sigUserFilePath) || null;
  const itSigPath = text(payload.sigITFilePath) || null;

  // Extract the most recent CANCEL entry for the notice box
  const revHistory = Array.isArray(docData.revisionHistoryJson) ? docData.revisionHistoryJson as JsonRecord[] : [];
  const cancelEntry = revHistory.slice().reverse().find(
    (e): e is JsonRecord => Boolean(e && typeof e === 'object' && (
      String((e as JsonRecord).action || '').toUpperCase() === 'CANCEL' ||
      String((e as JsonRecord).event || '').toUpperCase() === 'CANCELLED'
    ))
  );
  const cancelInfo = cancelEntry
    ? { by: text(cancelEntry.by), ts: text(cancelEntry.ts), reason: text(cancelEntry.reason) }
    : null;

  const pdfFile = await buildPdfFile(
    docData.docNumber,
    payload,
    items,
    'Cancelled',
    userSigPath && fs.existsSync(userSigPath) ? userSigPath : null,
    itSigPath && fs.existsSync(itSigPath) ? itSigPath : null,
    cancelInfo
  );
  return pdfFile.publicUrl;
}

export async function submitParityHandoverTransaction(formDataInput: unknown, actor: ActorMeta) {
  const formData = (formDataInput && typeof formDataInput === 'object' ? { ...(formDataInput as JsonRecord) } : {}) as JsonRecord;
  const actorEmail = lower(actor.email);
  const actorLabel = text(actor.fullName || actor.email);
  const transType = text(formData.transType);
  const manualEntry = Boolean(formData.manualEntry);
  const holderMode = upper(formData.holderMode || (manualEntry ? 'MANUAL_ENTRY' : 'EMPLOYEE_DB'));
  const bastMode = upper(formData.bastMode);
  const resumeEditMode =
    formData.resumeEditMode === true
    || lower(formData.resumeEditMode) === 'true'
    || lower(formData.formMode) === 'edit';

  const items = (Array.isArray(formData.items) ? formData.items : []).map(normalizeItem).filter((item) => item.sku);
  if (!transType || !items.length) {
    return {
      success: false,
      message: 'REJECTED: User info, transaction type, and items are required.'
    };
  }

  const resolvedHolder = await resolveHolderMeta(formData);
  if (!resolvedHolder.fullName) {
    return {
      success: false,
      message: 'REJECTED: Holder name is required.'
    };
  }
  if (manualEntry && !resolvedHolder.nik) {
    return {
      success: false,
      message: 'REJECTED: Manual entry requires NIK.'
    };
  }
  if (holderMode === 'EMPLOYEE_DB' && !manualEntry && !resolvedHolder.resolved && !resolvedHolder.email && !resolvedHolder.nik) {
    return {
      success: false,
      message: 'REJECTED: Please select employee from Employee Database or enable Manual entry.'
    };
  }

  const isUserSigned = hasSignatureData(formData.sigUser, formData.sigUserData);
  const isItSigned = hasSignatureData(formData.sigIT, formData.sigITData);
  const userSigType = upper(formData.userSigType || 'RECIPIENT');
  const repName = text(formData.repName);
  const repEmail = text(formData.repEmail).toLowerCase();
  const itSignerName = text(formData.itSignerName || formData.signerITName);

  const dutyLocationLabel = buildDutyLocationLabel(formData, items);
  if (items.some((item) => item.type === 'OUT') && !dutyLocationLabel) {
    return {
      success: false,
      message: 'REJECTED: Please select Duty Location for asset checkout.'
    };
  }

  for (const item of items) {
    if (item.isShared && (!item.sharedAccount || !item.sharedDept)) {
      return {
        success: false,
        message: 'REJECTED: Shared Asset requires account and department.'
      };
    }
  }

  // Block if a tagged OUT asset is currently assigned to a different person
  const outTaggedTags = items
    .filter((item) => item.type === 'OUT')
    .map((item) => normalizeAssetTag(item.tag))
    .filter((tag): tag is string => Boolean(tag) && tag !== 'NO-TAG');
  if (outTaggedTags.length > 0) {
    const occupiedAssets = await prisma.asset.findMany({
      where: { assetTag: { in: outTaggedTags }, assignedToText: { not: null } },
      select: { assetTag: true, assignedToText: true }
    });
    const holderNameLower = lower(resolvedHolder.fullName);
    for (const asset of occupiedAssets) {
      const assigneeLower = lower(asset.assignedToText || '');
      if (assigneeLower && !assigneeLower.includes(holderNameLower)) {
        return {
          success: false,
          message: `REJECTED: Asset ${asset.assetTag} is currently assigned to ${asset.assignedToText}. Check In the asset first before issuing it to another user.`
        };
      }
    }
  }

  let docNumber = text(formData.docID);
  const now = new Date();
  const dateStamp = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
  if (!docNumber) {
    const prefix = buildDocPrefix(transType);
    const existingToday = await prisma.handoverDocument.count({
      where: {
        docNumber: {
          startsWith: `${prefix}-${dateStamp}-`,
          mode: 'insensitive'
        }
      }
    });
    docNumber = `${prefix}-${dateStamp}-${String(existingToday + 1).padStart(4, '0')}`;
    if (bastMode === 'WFH' || bastMode === 'WFO') {
      docNumber = `${docNumber}-${bastMode}`;
    }
  }

  const existingSnapshot = docNumber
    ? await prisma.handoverDocument.findUnique({
        where: {
          docNumber
        },
        include: {
          items: true
        }
      })
    : null;
  const previousPayload = parseJsonRecord(existingSnapshot?.payloadJson) || {};
  const previousItSigned = hasStoredSignature(previousPayload, 'IT');
  const previousUserSigned = hasStoredSignature(previousPayload, 'USER');
  const preserveItSignature = Boolean(existingSnapshot && !resumeEditMode && !isItSigned && previousItSigned);
  const preserveUserSignature = Boolean(existingSnapshot && !resumeEditMode && !isUserSigned && previousUserSigned);
  const finalItSigned = isItSigned || preserveItSignature;
  const finalUserSigned = isUserSigned || preserveUserSignature;

  const inferredMode = bastMode || inferModeFromDocNumber(docNumber);
  const status = finalItSigned && finalUserSigned ? 'Completed' : 'On Hold';
  const signatureIt = text(formData.sigIT);
  const signatureUser = text(formData.sigUser);
  const itSignatureFile = signatureIt ? saveSignatureFile(docNumber, 'SIG_IT', signatureIt) : null;
  const userSignatureFile = signatureUser ? saveSignatureFile(docNumber, 'SIG_USER', signatureUser) : null;
  const effectiveItSignatureUrl = itSignatureFile?.publicUrl || (preserveItSignature ? text(previousPayload.sigITFileUrl) : '');
  const effectiveUserSignatureUrl = userSignatureFile?.publicUrl || (preserveUserSignature ? text(previousPayload.sigUserFileUrl) : '');
  const effectiveItSignaturePath = itSignatureFile?.absolutePath || (preserveItSignature ? text(previousPayload.sigITFilePath) : '');
  const effectiveUserSignaturePath = userSignatureFile?.absolutePath || (preserveUserSignature ? text(previousPayload.sigUserFilePath) : '');
  const effectiveItSignerName =
    itSignerName
    || (preserveItSignature ? text(previousPayload.signerITName) : '')
    || (isItSigned ? actorLabel : '');
  const effectiveUserSigType = userSigType || upper(previousPayload.userSigType || 'RECIPIENT');
  const effectiveRepName = repName || (preserveUserSignature ? text(previousPayload.repName) : '');
  const effectiveRepEmail = repEmail || (preserveUserSignature ? text(previousPayload.repEmail).toLowerCase() : '');
  const effectiveUserLabel =
    effectiveUserSigType === 'ACKNOWLEDGEMENT'
      ? `a.n ${resolvedHolder.fullName}${effectiveRepName ? ` (${effectiveRepName})` : ''}`
      : resolvedHolder.fullName;

  if (effectiveUserSigType === 'ACKNOWLEDGEMENT' && !effectiveRepName) {
    return {
      success: false,
      message: 'REJECTED: Representative name is required.'
    };
  }

  if (finalItSigned && !effectiveItSignerName) {
    return {
      success: false,
      message: 'REJECTED: Please select IT Operations signer.'
    };
  }

  const storedPayload: JsonRecord = {
    ...formData,
    bastMode: inferredMode,
    docID: docNumber,
    docStatus: status,
    resumeEditMode,
    manualEntry,
    holderMode: resolvedHolder.mode,
    holderResolved: resolvedHolder.resolved,
    userName: resolvedHolder.fullName,
    userNIK: resolvedHolder.nik,
    userEmail: resolvedHolder.email,
    userAcc: resolvedHolder.account,
    userDept: resolvedHolder.dept,
    holderName: resolvedHolder.fullName,
    holderNIK: resolvedHolder.nik,
    holderEmail: resolvedHolder.email,
    holderAccount: resolvedHolder.account,
    holderDept: resolvedHolder.dept,
    signerITEmail: isItSigned ? actorEmail : text(formData.signerITEmail || previousPayload.signerITEmail),
    signerITName: effectiveItSignerName,
    userSigType: effectiveUserSigType,
    repName: effectiveRepName,
    repEmail: effectiveRepEmail,
    signerUserLabel: effectiveUserLabel,
    sigIT: '',
    sigUser: '',
    sigITFileUrl: effectiveItSignatureUrl,
    sigUserFileUrl: effectiveUserSignatureUrl,
    sigITFilePath: effectiveItSignaturePath,
    sigUserFilePath: effectiveUserSignaturePath,
    items
  };

  const pdfFile = await buildPdfFile(
    docNumber,
    storedPayload,
    items.map((item) => ({
      ...item,
      tag: item.tag || 'NO-TAG'
    })),
    status,
    effectiveUserSignaturePath || null,
    effectiveItSignaturePath || null
  );

  const itemsSummary = buildItemsSummary(items);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.handoverDocument.findUnique({
      where: {
        docNumber
      },
      include: {
        items: true
      }
    });
    const previousPayload = parseJsonRecord(existing?.payloadJson) || {};
    const previousItems = (Array.isArray(previousPayload.items) ? previousPayload.items : []).map(normalizeItem);
    const previousHistory = Array.isArray(existing?.revisionHistoryJson) ? existing?.revisionHistoryJson : [];
    const revisionEntry = {
      ts: formatIsoStamp(now),
      by: actorEmail || '-',
      action: existing ? 'UPDATE' : 'CREATE',
      docID: docNumber,
      statusFrom: text(existing?.status),
      statusTo: status,
      itSigned: finalItSigned,
      userSigned: finalUserSigned,
      event: existing ? (resumeEditMode ? 'EDIT_RESUBMIT' : 'UPDATED') : 'CREATED'
    } satisfies JsonRecord;
    const revisionHistory = appendRevisionHistory(previousHistory, revisionEntry);

    const handover = existing
      ? await tx.handoverDocument.update({
          where: { id: existing.id },
          data: {
            mode: inferredMode || 'STANDARD',
            transactionType: transType,
            status,
            holderName: resolvedHolder.fullName || null,
            holderNik: resolvedHolder.nik || null,
            holderEmail: resolvedHolder.email || null,
            holderDepartment: resolvedHolder.dept || null,
            userAccount: resolvedHolder.account || null,
            notes: text(formData.notes) || null,
            rawItemsText: itemsSummary || null,
            pdfUrl: pdfFile.publicUrl,
            payloadJson: storedPayload as Prisma.InputJsonValue,
            revisionHistoryJson: revisionHistory as Prisma.InputJsonValue,
            transactionTimestamp: now
          }
        })
      : await tx.handoverDocument.create({
          data: {
            docNumber,
            mode: inferredMode || 'STANDARD',
            transactionType: transType,
            status,
            holderName: resolvedHolder.fullName || null,
            holderNik: resolvedHolder.nik || null,
            holderEmail: resolvedHolder.email || null,
            holderDepartment: resolvedHolder.dept || null,
            userAccount: resolvedHolder.account || null,
            notes: text(formData.notes) || null,
            rawItemsText: itemsSummary || null,
            pdfUrl: pdfFile.publicUrl,
            payloadJson: storedPayload as Prisma.InputJsonValue,
            revisionHistoryJson: revisionHistory as Prisma.InputJsonValue,
            transactionTimestamp: now
          }
        });

    await tx.handoverItem.deleteMany({
      where: {
        handoverId: handover.id
      }
    });

    if (items.length) {
      const assetLinks = new Map<string, string>();
      const taggedAssets = await tx.asset.findMany({
        where: {
          assetTag: {
            in: items.map((item) => normalizeAssetTag(item.tag)).filter((item) => item && item !== 'NO-TAG')
          }
        },
        select: {
          id: true,
          assetTag: true
        }
      });
      taggedAssets.forEach((asset) => assetLinks.set(normalizeAssetTag(asset.assetTag), asset.id));

      await tx.handoverItem.createMany({
        data: items.map((item) => ({
          handoverId: handover.id,
          assetId: normalizeAssetTag(item.tag) && normalizeAssetTag(item.tag) !== 'NO-TAG' ? assetLinks.get(normalizeAssetTag(item.tag)) || null : null,
          assetTag: item.tag || null,
          itemName: item.sku,
          itemSku: item.sku,
          quantity: item.qty,
          direction: item.type,
          isShared: item.isShared,
          isBroken: item.isBroken,
          sharedAccount: item.isShared ? item.sharedAccount || null : null,
          sharedDept: item.isShared ? item.sharedDept || null : null,
          dutyLocation: item.type === 'OUT' ? dutyLocationLabel || null : 'IT Room'
        }))
      });
    }

    const previousMap = buildNoTagMovementMap(previousItems);
    const nextMap = buildNoTagMovementMap(items);

    // Only mutate Asset table and rebuild snapshots when BAST is fully Completed (both signatures).
    // On Hold = save the document but leave Asset records and holdings snapshot untouched.
    if (status === 'Completed') {
    for (const item of items) {
      const tag = normalizeAssetTag(item.tag);
      if (tag && tag !== 'NO-TAG') {
        const shared = item.isShared;
        const asset = await tx.asset.findFirst({
          where: {
            assetTag: {
              equals: tag,
              mode: 'insensitive'
            }
          }
        });
        if (!asset) continue;

        const nextAssignedText = item.type === 'OUT' ? buildHolderDisplay(resolvedHolder, shared) : null;
        const nextStatus = item.type === 'OUT' ? 'In Use' : (item.isBroken ? 'Broken' : 'Available');
        const nextLocation = item.type === 'OUT' ? dutyLocationLabel : 'IT Room';
        const nextAssignedAccount = shared ? item.sharedAccount : '';
        const nextAssignedDept = shared ? item.sharedDept : '';

        await tx.asset.update({
          where: { id: asset.id },
          data: {
            status: nextStatus,
            assignedToText: nextAssignedText,
            location: nextLocation,
            assignedAccount: nextAssignedAccount || null,
            assignedDept: nextAssignedDept || null
          }
        });

        await tx.assetRevision.create({
          data: {
            assetId: asset.id,
            assetTag: tag,
            itemModel: asset.itemModel,
            action: item.type === 'OUT' ? 'ASSIGN' : 'RETURN',
            qtyBefore: asset.quantity,
            qtyChange: item.type === 'OUT' ? -item.qty : (item.isBroken ? 0 : item.qty),
            qtyAfter: asset.quantity,
            remark: item.type === 'OUT'
              ? `BAST Check Out${shared ? ' (Shared Asset)' : ''}`
              : (item.isBroken ? 'BAST Check In - Broken Return' : 'BAST Check In'),
            source: 'BAST',
            actorEmail,
            referenceId: docNumber,
            rawJson: {
              holder: resolvedHolder,
              item,
              dutyLocationLabel
            }
          }
        });
        continue;
      }

      const skuKey = lower(item.sku);
      if (!skuKey) continue;
      const delta = Number((nextMap[skuKey] || 0) - (previousMap[skuKey] || 0));
      if (!delta) continue;

      const accessory = await ensureAccessoryAsset(tx, item.sku);
      const qtyBefore = Math.max(0, asInt(accessory.quantity, 0));
      const qtyAfter = Math.max(0, qtyBefore + delta);

      await tx.asset.update({
        where: { id: accessory.id },
        data: {
          quantity: qtyAfter,
          status: qtyAfter > 0 ? 'Available' : 'Out of Stock',
          assignedToText: '-',
          location: ''
        }
      });

      await tx.assetRevision.create({
        data: {
          assetId: accessory.id,
          assetTag: normalizeAssetTag(accessory.assetTag),
          itemModel: accessory.itemModel,
          action: 'QTY_ADJUST',
          qtyBefore,
          qtyChange: delta,
          qtyAfter,
          remark: `${delta > 0 ? 'BAST Check In' : 'BAST Check Out'} qty sync`,
          source: 'BAST',
          actorEmail,
          referenceId: docNumber,
          rawJson: {
            item,
            previousSigned: previousMap[skuKey] || 0,
            nextSigned: nextMap[skuKey] || 0
          }
        }
      });
    }

    await rebuildCurrentSnapshots(tx);
    } // end if (status === 'Completed')

    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        actorEmail,
        module: 'HANDOVER_BAST',
        action: existing ? 'UPDATE' : 'CREATE',
        entityType: 'HandoverDocument',
        entityId: handover.id,
        payloadJson: {
          docNumber,
          status,
          transType,
          mode: inferredMode || 'STANDARD',
          holder: resolvedHolder,
          itemCount: items.length
        }
      }
    });

    // Link handover to representative's audit log so they can see it in their Handover List
    if (effectiveUserSigType === 'ACKNOWLEDGEMENT' && effectiveRepEmail) {
      const repUser = await tx.user.findFirst({
        where: { email: { equals: effectiveRepEmail, mode: 'insensitive' } },
        select: { id: true, email: true }
      });
      if (repUser) {
        await tx.auditLog.create({
          data: {
            actorId: repUser.id,
            actorEmail: repUser.email,
            module: 'HANDOVER_BAST',
            action: 'REPRESENTATIVE_LINKED',
            entityType: 'HandoverDocument',
            entityId: handover.id,
            payloadJson: {
              docNumber,
              status,
              holder: resolvedHolder.fullName,
              repName: effectiveRepName
            }
          }
        });
      }
    }

    return {
      handoverId: handover.id
    };
  });

  return {
    success: true,
    message: `Transaction ${docNumber} saved. Status: ${status}.`,
    pdfUrl: pdfFile.publicUrl,
    docID: docNumber,
    status,
    handoverId: result.handoverId
  };
}
