import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db.js';
import { env } from '../config.js';

type ActorMeta = {
  id: string;
  email: string;
  fullName?: string | null;
  roles?: string[];
};

type SubmitProcurementPayload = {
  requestorName?: unknown;
  requestSource?: unknown;
  sourceReference?: unknown;
  rawData?: unknown;
};

type ProcurementEvidencePayload = {
  name?: unknown;
  mimeType?: unknown;
  dataUrl?: unknown;
};

type UpdateProcurementPayload = {
  requestNumber?: unknown;
  status?: unknown;
  fulfillment?: unknown;
  referenceNo?: unknown;
  itemSummary?: unknown;
  statusRemark?: unknown;
  evidence?: unknown;
};

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

const REFERENCE_REQUIRED_STATUSES = new Set(['On Purchased', 'Delivered', 'Ready to Deploy', 'Deployed', 'Completed']);
const ARCHIVE_STATUSES = new Set(['Completed', 'Rejected']);
const EVIDENCE_MAX_FILES = 3;
const EVIDENCE_MAX_BYTES = 2 * 1024 * 1024;

const TOKEN_MAP: Record<string, string> = {
  usb: 'USB',
  lan: 'LAN',
  pc: 'PC',
  cpu: 'CPU',
  gpu: 'GPU',
  ram: 'RAM',
  ssd: 'SSD',
  hdd: 'HDD',
  ups: 'UPS',
  hdmi: 'HDMI',
  vga: 'VGA',
  wifi: 'WiFi',
  'wi-fi': 'WiFi',
  it: 'IT',
  po: 'PO',
  prq: 'PRQ'
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function upper(value: unknown) {
  return text(value).toUpperCase();
}

function normalizeRole(role: unknown) {
  return text(role).replace(/[^A-Z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase();
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

function buildDateStamp(value: Date) {
  const dd = String(value.getDate()).padStart(2, '0');
  const mm = String(value.getMonth() + 1).padStart(2, '0');
  const yyyy = String(value.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

function actorShortLabel(value: unknown) {
  const raw = text(value).toLowerCase();
  if (!raw) return 'unknown';
  return raw.includes('@') ? raw.split('@')[0] || 'unknown' : raw;
}

function actorRoleFlags(actor: ActorMeta) {
  const roles = (actor.roles || []).map(normalizeRole);
  return {
    isSuperAdmin: roles.some((role) => role.includes('SUPER') || role === 'ADMIN'),
    isProcurement: roles.includes('PROCUREMENT'),
    isITOps: roles.includes('IT_OPS'),
    isFinance: roles.includes('FINANCE'),
    roles
  };
}

function normalizeProcurementSource(source: unknown) {
  const raw = text(source);
  if (!raw) return 'WhatsApp';
  if (lower(raw) === 'itop') return 'iTop';
  if (lower(raw) === 'email') return 'Email';
  return 'WhatsApp';
}

function normalizeFulfillmentMode(value: unknown) {
  const normalized = text(value);
  if (normalized === 'Purchase - E-Commerce') return { base: 'Purchase' as const, mode: 'E-Commerce' as const };
  if (normalized === 'Purchase - PO' || normalized === 'Purchase') return { base: 'Purchase' as const, mode: 'PO' as const };
  return { base: 'Stock' as const, mode: 'PO' as const };
}

function buildFulfillmentValue(base: 'Stock' | 'Purchase', mode: 'PO' | 'E-Commerce') {
  if (base !== 'Purchase') return 'Stock';
  return mode === 'E-Commerce' ? 'Purchase - E-Commerce' : 'Purchase - PO';
}

function normalizeReferenceNo(value: string, fulfillmentBase: 'Stock' | 'Purchase') {
  if (fulfillmentBase !== 'Purchase') return 'N/A (Stock)';
  return value || '-';
}

function sanitizeFileName(name: string) {
  return text(name || 'evidence.png')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'evidence.png';
}

function slugify(value: string) {
  return text(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function storageRoot() {
  return path.resolve(env.ATLAS_STORAGE_DIR || '/atlas-data/storage');
}

function procurementEvidenceDir() {
  return path.join(storageRoot(), 'procurement', 'evidence');
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function dataUrlToBuffer(dataUrl: string) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], 'base64')
  };
}

function extensionFromMime(mimeType: string) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.bin';
}

function fileContentType(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

function publicEvidenceUrl(fileName: string) {
  return `/api/files/procurement/evidence/${encodeURIComponent(fileName)}`;
}

export function getStoredProcurementEvidencePath(fileName: string) {
  const safeName = path.basename(fileName);
  if (!safeName) return null;
  const base = procurementEvidenceDir();
  const resolved = path.resolve(base, safeName);
  if (!resolved.startsWith(path.resolve(base))) return null;
  return resolved;
}

export function getStoredProcurementEvidenceContentType(fileName: string) {
  return fileContentType(fileName);
}

function smartTitleCase(value: string) {
  return text(value)
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      const normalized = token.replace(/[.,;:!?]+$/g, '');
      const punctuation = token.slice(normalized.length);
      const mapped = TOKEN_MAP[normalized.toLowerCase()];
      if (mapped) return `${mapped}${punctuation}`;
      if (/^\d/.test(normalized)) return `${normalized}${punctuation}`;
      if (normalized.length <= 1) return `${normalized.toUpperCase()}${punctuation}`;
      return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1).toLowerCase()}${punctuation}`;
    })
    .join(' ');
}

type CatalogAiEntry = {
  category: string;
  sku: string;
  account: string;
  normalizedSku: string;
};

async function getCatalogListForAi() {
  const rows = await prisma.catalogItem.findMany({
    orderBy: [{ category: 'asc' }, { sku: 'asc' }],
    select: {
      category: true,
      sku: true,
      account: true
    }
  });

  return rows
    .filter((row) => text(row.sku))
    .map((row) => `${text(row.category)} -> ${text(row.sku)} [Account: ${text(row.account) || 'General'}]`)
    .join('\n');
}

function catalogAiEntries(catalogList: string) {
  return catalogList
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?)\s*->\s*(.*?)\s*\[Account:\s*(.*?)\]$/);
      const category = text(match?.[1] || '');
      const sku = text(match?.[2] || '');
      const account = text(match?.[3] || 'General');
      return {
        category,
        sku,
        account,
        normalizedSku: lower(sku)
      } satisfies CatalogAiEntry;
    })
    .filter((entry) => entry.sku);
}

function normalizeWordNumbersForPrq(input: string) {
  let output = String(input || '');
  const multi: Array<[RegExp, string]> = [
    [/\bdua\s+belas\b/gi, '12'],
    [/\btiga\s+belas\b/gi, '13'],
    [/\bempat\s+belas\b/gi, '14'],
    [/\blima\s+belas\b/gi, '15'],
    [/\benam\s+belas\b/gi, '16'],
    [/\btujuh\s+belas\b/gi, '17'],
    [/\bdelapan\s+belas\b/gi, '18'],
    [/\bsembilan\s+belas\b/gi, '19'],
    [/\bdua\s+puluh\b/gi, '20']
  ];
  multi.forEach(([pattern, replacement]) => {
    output = output.replace(pattern, replacement);
  });

  const single: Record<string, string> = {
    nol: '0',
    kosong: '0',
    zero: '0',
    satu: '1',
    sebuah: '1',
    one: '1',
    first: '1',
    dua: '2',
    two: '2',
    tiga: '3',
    three: '3',
    empat: '4',
    four: '4',
    lima: '5',
    five: '5',
    enam: '6',
    six: '6',
    tujuh: '7',
    seven: '7',
    delapan: '8',
    eight: '8',
    sembilan: '9',
    nine: '9',
    sepuluh: '10',
    ten: '10',
    sebelas: '11',
    eleven: '11'
  };

  Object.entries(single).forEach(([word, replacement]) => {
    output = output.replace(new RegExp(`\\b${word}\\b`, 'gi'), replacement);
  });

  return output;
}

function stripCodeFence(value: string) {
  return text(value)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function callGeminiExtraction(rawData: string, catalogList: string) {
  const geminiKey = text(env.GEMINI_API_KEY);
  if (!geminiKey) {
    return { error: true as const, msg: 'AI key is not configured (GEMINI_API_KEY).' };
  }

  const geminiModel = text(env.GEMINI_MODEL) || 'gemini-2.5-flash';
  let cleanData = rawData.replace(/\d{2,}\.\d{2,}[\.\d]*/g, '[ID]');
  cleanData = cleanData.replace(/(Name|Mr\.|Ms\.|Mrs\.)\s*[:.]?\s*[A-Za-z\s]+/gi, '[NAME]');

  const prompt = `
You are an Intelligent IT Procurement System for Your Company.

YOUR GOAL: Extract item name and quantity from the Request, matching it to the Catalog.

CATALOG DATA (Format: Category -> Item SKU [Account: Owner]):
${catalogList}

CRITICAL INSTRUCTIONS:
1. ACCOUNT MATCHING (PRIORITY):
   - Look for account keywords in the Request: "Maverick", "Traveloka" (or "TVLK"), "FCTG", "Internal".
   - If a keyword implies a specific account, YOU MUST select the Item SKU that has [Account: X] matching that context.
   - Example: User asks "Laptop for Maverick". Catalog has "Laptop Gen" [General] and "Laptop V14" [Maverick]. You MUST choose "Laptop V14".

2. OUTPUT FORMAT:
   - Strictly JSON array: [{"qty": 1, "item": "Exact Child SKU Name"}]
   - "item" must be the exact string from the Catalog SKU (excluding the [Account:...] part).

3. BUNDLING RULES:
   - "Laptop Set" = 1 Laptop, 1 Monitor 22", 1 Mouse, 1 Keyboard, 1 USB Adapter.
   - "PC set" = 1 PC, 1 Monitor 19", 1 Monitor 22", 1 Mouse, 1 Keyboard.

4. GENERAL RULES:
   - Treat "a", "an", "sebuah" as 1.
   - Ignore greeting text.

USER REQUEST: "${cleanData}"
`.trim();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      })
    }
  );

  const rawResponse = await response.text();
  if (!response.ok) {
    return {
      error: true as const,
      msg: `AI Error ${response.status}: ${rawResponse}`
    };
  }

  let json: any;
  try {
    json = JSON.parse(rawResponse);
  } catch (error) {
    return {
      error: true as const,
      msg: error instanceof Error ? error.message : 'AI response is not valid JSON.'
    };
  }

  const modelText = text(
    json?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: unknown }) => text(part?.text))
      .join('\n')
  );
  if (!modelText) {
    return { error: true as const, msg: text(json?.error?.message) || 'AI Empty Response' };
  }

  try {
    const parsed = JSON.parse(stripCodeFence(modelText));
    if (!Array.isArray(parsed) || !parsed.length) {
      return { error: true as const, msg: 'AI Empty Response' };
    }
    return parsed as Array<{ qty?: unknown; item?: unknown }>;
  } catch (error) {
    return {
      error: true as const,
      msg: error instanceof Error ? error.message : 'Failed to parse AI response.'
    };
  }
}

function manualExtractionFallback(rawData: string, catalogList: string) {
  let cleanText = normalizeWordNumbersForPrq(rawData).toLowerCase();
  cleanText = cleanText.replace(/\d+[./]\d+[./]\d+[./]?\d*/g, ' ');
  cleanText = cleanText.replace(/nik\s*[:]\s*\d+/g, ' ');
  cleanText = cleanText.replace(/\b(a|an)\b/g, ' 1 ');
  cleanText = cleanText.replace(/\s+(dan|and|plus|\+|&|with)\s+/g, ' , ');
  cleanText = cleanText.replace(/(^|[\s\n])\d+[.)-]\s+/g, ' , ');
  cleanText = cleanText.replace(/(^|[\s\n])[a-z][.)-]\s+/g, ' , ');
  cleanText = cleanText.replace(/[:;\n]/g, ' , ');
  cleanText = cleanText.replace(/22\s*(?:inches|inchi|inch|inc|in|'|")?/g, ' sz_dua_dua ');
  cleanText = cleanText.replace(/19\s*(?:inches|inchi|inch|inc|in|'|")?/g, ' sz_satu_sembilan ');
  cleanText = cleanText.replace(/\s+/g, ' ');

  const textChunks = cleanText
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  function extractQtyAndConsume(chunks: string[], keywords: string[]) {
    let total = 0;

    chunks.forEach((chunk, index) => {
      const matchedKey = keywords.find((keyword) => chunk.includes(keyword));
      if (!matchedKey) return;

      const safeKey = matchedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matchFront = chunk.match(new RegExp(`(\\d+)[\\s\\w]*${safeKey}`));
      const matchBack = chunk.match(new RegExp(`${safeKey}[\\s\\w]*(\\d+)`));

      if (matchFront) total += Math.max(1, Number(matchFront[1]) || 1);
      else if (matchBack) total += Math.max(1, Number(matchBack[1]) || 1);
      else total += 1;

      chunks[index] = chunk.replace(matchedKey, ' ');
    });

    return total;
  }

  const qtyLaptopSet = extractQtyAndConsume(textChunks, ['laptop set', 'set laptop']);
  const qtyPcSet = extractQtyAndConsume(textChunks, ['pc set', 'set pc']);
  const catalogEntries = catalogAiEntries(catalogList).sort((left, right) => right.normalizedSku.length - left.normalizedSku.length);
  const dynamicResults = new Map<string, number>();
  const strictBlocked = ['monitor', 'set', 'laptop', 'pc', 'cpu', 'printer', 'ups'];

  catalogEntries.forEach((entry) => {
    if (strictBlocked.some((keyword) => entry.normalizedSku === keyword)) return;
    const qty = extractQtyAndConsume(textChunks, [entry.normalizedSku]);
    if (qty > 0) dynamicResults.set(entry.sku, qty);
  });

  const qtyLaptop = extractQtyAndConsume(textChunks, ['laptop']);
  const qtyPc = extractQtyAndConsume(textChunks, ['pc', 'cpu']);
  const qtyMon22 = extractQtyAndConsume(textChunks, ['monitor sz_dua_dua']);
  const qtyMon19 = extractQtyAndConsume(textChunks, ['monitor sz_satu_sembilan']);

  const items: string[] = [];
  const totalLaptop = qtyLaptop + qtyLaptopSet;
  const totalPc = qtyPc + qtyPcSet;
  const totalMon22 = qtyMon22 + qtyLaptopSet + qtyPcSet;
  const totalMon19 = qtyMon19 + qtyPcSet;
  let setMouse = qtyLaptopSet + qtyPcSet;
  let setKeyboard = qtyLaptopSet + qtyPcSet;
  let setUsb = qtyLaptopSet;

  if (totalLaptop > 0) items.push(`${totalLaptop} Unit Laptop`);
  if (totalPc > 0) items.push(`${totalPc} Unit PC`);
  if (totalMon22 > 0) items.push(`${totalMon22} Unit Monitor 22"`);
  if (totalMon19 > 0) items.push(`${totalMon19} Unit Monitor 19"`);

  dynamicResults.forEach((qty, sku) => {
    let finalQty = qty;
    const normalizedSku = lower(sku);
    if (normalizedSku.includes('mouse')) {
      finalQty += setMouse;
      setMouse = 0;
    } else if (normalizedSku.includes('keyboard')) {
      finalQty += setKeyboard;
      setKeyboard = 0;
    } else if (normalizedSku.includes('usb adapter')) {
      finalQty += setUsb;
      setUsb = 0;
    }

    if (finalQty > 0) items.push(`${finalQty} Unit ${sku}`);
  });

  if (setMouse > 0) items.push(`${setMouse} Unit Mouse`);
  if (setKeyboard > 0) items.push(`${setKeyboard} Unit Keyboard`);
  if (setUsb > 0) items.push(`${setUsb} Unit USB Adapter`);

  return items.join(', ');
}

async function parseProcurementItemSummary(rawData: string) {
  const catalogList = await getCatalogListForAi();
  let finalItemString = '';
  let logMessage = '';
  let aiErrorMsg = '';

  try {
    const parsedItems = await callGeminiExtraction(rawData, catalogList);
    if (!('error' in parsedItems) && Array.isArray(parsedItems) && parsedItems.length) {
      const itemStrings = parsedItems
        .map((entry) => {
          const parsedItem = text(entry?.item);
          const qty = Math.max(1, Number(entry?.qty) || 1);
          if (!parsedItem) return '';
          return `${qty} Unit ${parsedItem}`;
        })
        .filter(Boolean);

      if (itemStrings.length) {
        finalItemString = itemStrings.join(', ');
        logMessage = 'Processed by AI (Gemini 2.5 Flash)';
      } else {
        aiErrorMsg = 'AI returned no valid items.';
      }
    } else {
      aiErrorMsg = text((parsedItems as { msg?: unknown })?.msg) || 'Unknown AI Error';
    }
  } catch (error) {
    aiErrorMsg = error instanceof Error ? error.message : 'Unknown AI Error';
  }

  if (!text(finalItemString)) {
    finalItemString = manualExtractionFallback(rawData, catalogList);
    logMessage = `Processed by Manual Fallback. AI failed: ${aiErrorMsg || 'Unknown AI Error'}`;
  }

  if (!text(finalItemString)) {
    finalItemString = '⚠️ Uncategorized (Check Raw Data)';
  }

  return {
    itemSummary: finalItemString,
    quantity: inferQuantityFromSummary(finalItemString, 1),
    logMessage
  };
}

function inferQuantityFromSummary(summary: string, fallback = 1) {
  const matches = [...summary.matchAll(/(\d+)\s+Unit/gi)];
  if (!matches.length) return Math.max(1, fallback);
  return matches.reduce((total, match) => total + Math.max(1, Number(match[1]) || 1), 0);
}

function prependMultilineEntry(existing: string, nextEntry: string) {
  const current = text(existing);
  return current ? `${nextEntry}\n${current}` : nextEntry;
}

function buildLogEntry(date: Date, actor: string, status: string, message: string) {
  return `[${buildDisplayDate(date)} by ${actor}] [${status}]: ${message}`;
}

async function getNextRequestNumber(now: Date) {
  const rows = await prisma.procurementRequest.findMany({
    select: {
      requestNumber: true
    }
  });

  let maxSeq = 0;
  rows.forEach((row) => {
    const match = text(row.requestNumber).match(/^PRQ-(\d{4,})(\d{8})$/);
    if (!match) return;
    maxSeq = Math.max(maxSeq, Number(match[1]) || 0);
  });

  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  return `PRQ-${nextSeq}${buildDateStamp(now)}`;
}

async function saveEvidenceFiles(requestNumber: string, files: ProcurementEvidencePayload[]) {
  if (!files.length) return [];

  ensureDir(procurementEvidenceDir());
  const stamp = Date.now();

  return files.map((file, index) => {
    const name = sanitizeFileName(text(file.name) || `evidence_${index + 1}.png`);
    const parsed = dataUrlToBuffer(text(file.dataUrl));
    if (!parsed) {
      throw new Error(`Evidence ${name} is not a valid image payload.`);
    }
    if (parsed.buffer.byteLength > EVIDENCE_MAX_BYTES) {
      throw new Error(`Evidence ${name} exceeds the 2MB limit.`);
    }

    const ext = path.extname(name) || extensionFromMime(text(file.mimeType) || parsed.contentType);
    const storedName = `${slugify(requestNumber)}_${stamp}_${index + 1}${ext}`;
    const absolutePath = path.join(procurementEvidenceDir(), storedName);
    fs.writeFileSync(absolutePath, parsed.buffer);

    return {
      name,
      storedName,
      publicUrl: publicEvidenceUrl(storedName)
    };
  });
}

function toProcurementRecordOutput(record: {
  requestTimestamp: Date | null;
  requestNumber: string;
  requestSource: string | null;
  sourceReference: string | null;
  processorEmail: string | null;
  itemSummary: string;
  quantity: number;
  requestorName: string | null;
  fulfillment: string;
  referenceNo: string | null;
  status: string;
  notes: string | null;
  logText: string | null;
  statusRemark: string | null;
}) {
  return {
    timestamp: record.requestTimestamp,
    requestNumber: record.requestNumber,
    requestSource: text(record.requestSource),
    sourceReference: text(record.sourceReference),
    processorEmail: text(record.processorEmail),
    itemSummary: text(record.itemSummary),
    quantity: Number(record.quantity || 0),
    requestorName: text(record.requestorName),
    fulfillment: text(record.fulfillment),
    referenceNo: text(record.referenceNo),
    status: text(record.status),
    notes: text(record.notes),
    logText: text(record.logText),
    statusRemark: text(record.statusRemark)
  };
}

export async function submitParityProcurementRequest(payload: SubmitProcurementPayload, actor: ActorMeta) {
  const requestorName = text(payload.requestorName);
  const requestSource = normalizeProcurementSource(payload.requestSource);
  const sourceReference = text(payload.sourceReference);
  const rawData = text(payload.rawData);

  if (!requestorName || !sourceReference || !rawData) {
    return {
      success: false,
      message: 'Requestor name, source detail, and raw request data are required.'
    };
  }

  if (requestSource === 'iTop' && !/^[RI]-\d+$/i.test(sourceReference)) {
    return {
      success: false,
      message: 'Invalid iTop format. Use R-xxxxxx or I-xxxxxx (numbers only).'
    };
  }

  const now = new Date();
  const parsed = await parseProcurementItemSummary(rawData);
  const requestNumber = await getNextRequestNumber(now);

  const record = await prisma.procurementRequest.create({
    data: {
      requestNumber,
      requestSource,
      sourceReference,
      processorEmail: text(actor.email),
      requestorName,
      itemSummary: parsed.itemSummary,
      quantity: 1,
      fulfillment: 'TBD',
      referenceNo: '-',
      status: 'Requested',
      notes: rawData,
      logText: parsed.logMessage,
      statusRemark: '',
      sourceSheet: 'Monitoring',
      requestTimestamp: now,
      isArchived: false
    }
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      actorEmail: actor.email,
      module: 'PROCUREMENT',
      action: 'CREATE_REQUEST',
      entityType: 'ProcurementRequest',
      entityId: record.id,
      payloadJson: {
        requestNumber,
        requestSource,
        sourceReference,
        requestorName,
        itemSummary: parsed.itemSummary
      }
    }
  });

  return {
    success: true,
      message: `Success! ID: ${requestNumber}`,
      requestNumber
  };
}

export async function updateParityProcurementRequest(payload: UpdateProcurementPayload, actor: ActorMeta) {
  const requestNumber = text(payload.requestNumber);
  const nextStatus = text(payload.status);
  const itemSummary = text(payload.itemSummary);
  const statusRemark = text(payload.statusRemark);
  const fulfillmentMeta = normalizeFulfillmentMode(payload.fulfillment);
  const purchaseReference = text(payload.referenceNo);
  const evidence = Array.isArray(payload.evidence) ? (payload.evidence as ProcurementEvidencePayload[]) : [];

  if (!requestNumber) {
    return { success: false, message: 'Request number is required.' };
  }

  const current = await prisma.procurementRequest.findUnique({
    where: {
      requestNumber
    }
  });

  if (!current) {
    return { success: false, message: `Request ${requestNumber} was not found.` };
  }

  if (current.isArchived) {
    return { success: false, message: 'Archived requests are read-only.' };
  }

  const roleFlags = actorRoleFlags(actor);
  const canEditData =
    roleFlags.isSuperAdmin ||
    roleFlags.isProcurement ||
    (roleFlags.isITOps && ['Requested', 'Pending', 'Approved'].includes(text(current.status)));
  const canEditPO = roleFlags.isSuperAdmin || roleFlags.isProcurement;
  const canUpdateStatus = roleFlags.isSuperAdmin || roleFlags.isProcurement || roleFlags.isITOps;

  if (!canUpdateStatus || roleFlags.isFinance) {
    return { success: false, message: 'Your role does not have permission to update this request.' };
  }

  if (!itemSummary) {
    return { success: false, message: 'Revised item category is required.' };
  }

  if (!statusRemark) {
    return { success: false, message: 'A status remark is required for every status update.' };
  }

  if (!PROCUREMENT_STATUS_FLOW.includes(nextStatus)) {
    return { success: false, message: `Status ${nextStatus || '(empty)'} is not valid.` };
  }

  if (!canEditData) {
    const existingFulfillment = normalizeFulfillmentMode(current.fulfillment);
    const existingReference = text(current.referenceNo);
    const normalizedExistingReference =
      existingFulfillment.base === 'Purchase'
        ? existingReference
        : '';
    if (
      text(current.itemSummary) !== itemSummary ||
      existingFulfillment.base !== fulfillmentMeta.base ||
      existingFulfillment.mode !== fulfillmentMeta.mode ||
      normalizedExistingReference !== purchaseReference
    ) {
      return { success: false, message: 'Your role cannot edit request metadata at the current status.' };
    }
  }

  if (!canEditPO && fulfillmentMeta.base === 'Purchase' && purchaseReference && purchaseReference !== text(current.referenceNo)) {
    return { success: false, message: 'PO / invoice reference can only be edited by Procurement or Super Admin.' };
  }

  if (REFERENCE_REQUIRED_STATUSES.has(nextStatus) && fulfillmentMeta.base === 'Purchase' && !purchaseReference) {
    const refLabel = fulfillmentMeta.mode === 'E-Commerce' ? 'Invoice Number' : 'PO Number';
    return {
      success: false,
      message: `Purchase via ${fulfillmentMeta.mode} requires ${refLabel} before moving to status ${nextStatus}.`
    };
  }

  if (roleFlags.isITOps) {
    if (nextStatus === 'PO Cancelled') {
      return { success: false, message: `Status '${nextStatus}' can only be processed by Procurement.` };
    }
    if (nextStatus === 'PO issued') {
      return { success: false, message: `Status '${nextStatus}' can only be updated by Procurement (Enter PO Number).` };
    }
    if (text(current.status) !== 'Requested' && nextStatus === 'Requested') {
      return { success: false, message: 'Request status cannot return to Requested. This status is locked.' };
    }
    const currentIdx = PROCUREMENT_STATUS_FLOW.indexOf(text(current.status));
    const nextIdx = PROCUREMENT_STATUS_FLOW.indexOf(nextStatus);
    if (nextIdx < currentIdx && nextStatus !== 'Pending' && nextStatus !== 'Rejected') {
      return { success: false, message: 'Status rollback is not allowed (one-way flow).' };
    }
  }

  if (nextStatus === 'PO issued' && (fulfillmentMeta.base !== 'Purchase' || fulfillmentMeta.mode !== 'PO' || !purchaseReference)) {
    return {
      success: false,
      message: `'PO Issued' requires 'Purchase via PO' with a valid PO Number.`
    };
  }

  if (evidence.length > EVIDENCE_MAX_FILES) {
    return { success: false, message: `Maximum ${EVIDENCE_MAX_FILES} evidence images are allowed per update.` };
  }

  const now = new Date();
  const savedEvidence = await saveEvidenceFiles(requestNumber, evidence);
  const evidenceTokens = savedEvidence.map((file) => ` [[IMG ${file.name}|${file.storedName}]]`).join('');
  const remarkEntry = buildLogEntry(now, actorShortLabel(actor.email), nextStatus, `${statusRemark}${evidenceTokens}`.trim());
  const normalizedReferenceNo = normalizeReferenceNo(purchaseReference, fulfillmentMeta.base);
  const nextQuantity = inferQuantityFromSummary(itemSummary, current.quantity || 1);
  const shouldArchiveNow = !current.isArchived && ARCHIVE_STATUSES.has(nextStatus);
  const nextArchived = current.isArchived || shouldArchiveNow;

  const updated = await prisma.procurementRequest.update({
    where: {
      requestNumber
    },
    data: {
      itemSummary,
      quantity: nextQuantity,
      fulfillment: buildFulfillmentValue(fulfillmentMeta.base, fulfillmentMeta.mode),
      referenceNo: normalizedReferenceNo,
      status: nextStatus,
      statusRemark: prependMultilineEntry(text(current.statusRemark), remarkEntry),
      isArchived: nextArchived,
      sourceSheet: nextArchived ? 'Archive' : 'Monitoring',
      requestTimestamp: shouldArchiveNow ? now : current.requestTimestamp
    }
  });

  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      actorEmail: actor.email,
      module: 'PROCUREMENT',
      action: 'UPDATE_REQUEST',
      entityType: 'ProcurementRequest',
      entityId: updated.id,
      payloadJson: {
        requestNumber,
        previousStatus: current.status,
        nextStatus,
        fulfillment: updated.fulfillment,
        referenceNo: updated.referenceNo,
        evidenceCount: savedEvidence.length
      }
    }
  });

  return {
    success: true,
    message: shouldArchiveNow ? `Request ${nextStatus} & Archived!` : 'Update Berhasil & Logs Tercatat!',
    item: toProcurementRecordOutput(updated)
  };
}
