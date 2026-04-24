import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Prisma } from '@prisma/client';
import XLSX from 'xlsx';
import { prisma } from '../db.js';
import { ensureLocalSuperAdmin } from '../auth.js';

type Row = unknown[];
type SheetMap = Map<string, Row[]>;

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function normalizeScalar(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => normalizeScalar(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, normalizeScalar(entry)])
    );
  }
  return value;
}

function asString(value: unknown) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return text.length ? text : null;
}

function cleanText(value: unknown) {
  const text = asString(value);
  if (!text) return null;
  const upper = text.toUpperCase();
  if (upper === 'N/A' || upper === '-' || upper === 'NULL' || upper === 'UNDEFINED') return null;
  return text;
}

function toInt(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const text = cleanText(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function toDecimal(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Prisma.Decimal(value);
  const text = cleanText(value);
  if (!text) return null;
  let normalized = text.replace(/[^\d,.-]/g, '');
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    const commaParts = normalized.split(',');
    normalized = commaParts.length === 2 && commaParts[1].length <= 2
      ? normalized.replace(',', '.')
      : normalized.replace(/,/g, '');
  } else if (hasDot) {
    const dotParts = normalized.split('.');
    normalized = dotParts.length === 2 && dotParts[1].length <= 2
      ? normalized
      : normalized.replace(/\./g, '');
  }

  return normalized ? new Prisma.Decimal(normalized) : null;
}

function parseDateish(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = cleanText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sanitizeHeader(header: unknown, index: number) {
  const text = asString(header);
  if (!text) return `col_${index + 1}`;
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || `col_${index + 1}`;
}

function makeHash(parts: unknown[]) {
  const source = JSON.stringify(parts.map((entry) => normalizeScalar(entry)));
  return crypto.createHash('sha1').update(source).digest('hex');
}

function titleCaseFromEmail(email: string) {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function toRoleCode(role: string) {
  return role
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function readWorkbookSheets(workbookPath: string) {
  const workbook = XLSX.readFile(workbookPath, {
    cellDates: true,
    raw: true
  });

  const sheets = new Map<string, Row[]>();
  for (const name of workbook.SheetNames) {
    const worksheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      blankrows: false,
      raw: true
    }) as Row[];
    sheets.set(name, rows);
  }

  return sheets;
}

async function createRawImport(batchId: string, sheets: SheetMap) {
  let importedRows = 0;

  for (const [sheetName, rows] of sheets.entries()) {
    const headers = rows[0] ?? [];
    const dataRows = rows.slice(1);
    const payloads = dataRows.map((row, index) => {
      const mapped: Record<string, unknown> = {};
      const maxColumns = Math.max(headers.length, row.length);

      for (let columnIndex = 0; columnIndex < maxColumns; columnIndex += 1) {
        mapped[sanitizeHeader(headers[columnIndex], columnIndex)] = normalizeScalar(row[columnIndex]);
      }

      return {
        batchId,
        sheetName,
        rowNumber: index + 2,
        payloadJson: {
          headers: headers.map((value) => normalizeScalar(value)),
          cells: row.map((value) => normalizeScalar(value)),
          mapped
        } as Prisma.InputJsonValue
      };
    });

    for (const group of chunk(payloads, 25)) {
      await prisma.workbookImportRow.createMany({
        data: group
      });
    }

    importedRows += payloads.length;
  }

  return importedRows;
}

async function importAuthorizedUsers(rows: Row[] | undefined) {
  if (!rows?.length) return 0;
  let processed = 0;

  for (const row of rows.slice(1)) {
    const email = cleanText(row[0])?.toLowerCase();
    const roleLabel = cleanText(row[1]);
    if (!email || !roleLabel) continue;

    const roleName = toRoleCode(roleLabel);
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName }
    });

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        isActive: true,
        fullName: {
          set: titleCaseFromEmail(email)
        }
      },
      create: {
        email,
        fullName: titleCaseFromEmail(email),
        isActive: true
      }
    });

    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId: role.id
        }
      },
      update: {},
      create: {
        userId: user.id,
        roleId: role.id
      }
    });

    processed += 1;
  }

  return processed;
}

async function replaceMasterReferences(rows: Row[] | undefined) {
  await prisma.masterReference.deleteMany();
  if (!rows?.length) return 0;

  const records = rows
    .slice(1)
    .map((row) => {
      const type = cleanText(row[0]);
      const value = cleanText(row[1]);
      const parentLink = cleanText(row[2]);
      if (!type || !value) return null;

      return {
        type,
        value,
        parentLink,
        key: `${type}||${value}||${parentLink || ''}`
      };
    })
    .filter(Boolean) as Array<{
      type: string;
      value: string;
      parentLink: string | null;
      key: string;
    }>;

  for (const group of chunk(records, 500)) {
    await prisma.masterReference.createMany({ data: group });
  }

  return records.length;
}

async function replaceMasterLocations(rows: Row[] | undefined) {
  await prisma.masterLocation.deleteMany();
  if (!rows?.length) return 0;

  const records = rows
    .slice(1)
    .map((row) => {
      const location = cleanText(row[0]);
      const floor = cleanText(row[1]);
      if (!location || !floor) return null;
      return { location, floor };
    })
    .filter(Boolean) as Array<{ location: string; floor: string }>;

  for (const group of chunk(records, 500)) {
    await prisma.masterLocation.createMany({ data: group, skipDuplicates: true });
  }

  return records.length;
}

async function replaceSuppliers(rows: Row[] | undefined) {
  await prisma.supplier.deleteMany();
  if (!rows?.length) return 0;

  const records = rows
    .slice(1)
    .map((row) => {
      const companyName = cleanText(row[0]);
      if (!companyName) return null;
      return {
        companyName,
        address1: cleanText(row[1]),
        address2: cleanText(row[2]),
        phoneFax: cleanText(row[3])
      };
    })
    .filter(Boolean) as Array<{
      companyName: string;
      address1: string | null;
      address2: string | null;
      phoneFax: string | null;
    }>;

  for (const group of chunk(records, 500)) {
    await prisma.supplier.createMany({ data: group, skipDuplicates: true });
  }

  return records.length;
}

async function replaceCatalogItems(rows: Row[] | undefined) {
  await prisma.catalogItem.deleteMany();
  if (!rows?.length) return 0;

  const records = rows
    .slice(1)
    .map((row) => {
      const category = cleanText(row[0]);
      const sku = cleanText(row[1]);
      if (!category || !sku) return null;

      return {
        category,
        sku,
        account: cleanText(row[2]),
        specification: cleanText(row[3]),
        estimatedPrice: toDecimal(row[4])
      };
    })
    .filter(Boolean) as Array<{
      category: string;
      sku: string;
      account: string | null;
      specification: string | null;
      estimatedPrice: Prisma.Decimal | null;
    }>;

  for (const group of chunk(records, 300)) {
    await prisma.catalogItem.createMany({ data: group, skipDuplicates: true });
  }

  return records.length;
}

async function replaceAssets(rows: Row[] | undefined) {
  await prisma.asset.deleteMany();
  if (!rows?.length) return new Map<string, string>();

  const deduped = new Map<string, Prisma.AssetCreateManyInput>();

  for (const row of rows.slice(1)) {
    const assetTag = cleanText(row[0]);
    const itemModel = cleanText(row[2]);
    const category = cleanText(row[3]);
    if (!assetTag || !itemModel || !category) continue;

    deduped.set(assetTag, {
      assetTag,
      serialNumber: cleanText(row[1]),
      itemModel,
      category,
      quantity: toInt(row[4]) ?? 0,
      status: cleanText(row[5]) || 'Unknown',
      assignedToText: cleanText(row[6]),
      location: cleanText(row[7]),
      purchaseDate: parseDateish(row[8]),
      invoiceNumber: cleanText(row[9]),
      orderNumber: cleanText(row[10]),
      vendorName: cleanText(row[11]),
      purchasingYear: cleanText(row[12]),
      ramSize: cleanText(row[13]),
      ramType: cleanText(row[14]),
      storageSize: cleanText(row[15]),
      storageType: cleanText(row[16]),
      externalVga: cleanText(row[17]),
      externalVgaType: cleanText(row[18]),
      ownerAccount: cleanText(row[19]),
      ownerDepartment: cleanText(row[20]),
      assignedAccount: cleanText(row[21]),
      assignedDept: cleanText(row[22])
    });
  }

  const records = [...deduped.values()];
  for (const group of chunk(records, 250)) {
    await prisma.asset.createMany({ data: group });
  }

  const assets = await prisma.asset.findMany({
    select: {
      id: true,
      assetTag: true
    }
  });

  return new Map(assets.map((asset) => [asset.assetTag, asset.id]));
}

async function replaceAssetRevisions(rows: Row[] | undefined, assetMap: Map<string, string>) {
  await prisma.assetRevision.deleteMany();
  if (!rows?.length) return 0;

  const records = rows
    .slice(1)
    .map((row) => {
      const assetTag = cleanText(row[1]);
      if (!assetTag) return null;

      return {
        assetId: assetMap.get(assetTag) || null,
        assetTag,
        itemModel: cleanText(row[2]),
        action: cleanText(row[3]) || 'UNKNOWN',
        qtyBefore: toInt(row[4]),
        qtyChange: toInt(row[5]),
        qtyAfter: toInt(row[6]),
        remark: cleanText(row[7]),
        actorEmail: cleanText(row[8])?.toLowerCase() || null,
        source: cleanText(row[9]),
        referenceId: cleanText(row[10]),
        rawJson: parseJsonValue(row[11]),
        createdAt: parseDateish(row[0]) || new Date()
      };
    })
    .filter(Boolean) as Prisma.AssetRevisionCreateManyInput[];

  for (const group of chunk(records, 250)) {
    await prisma.assetRevision.createMany({ data: group });
  }

  return records.length;
}

function parseJsonValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return normalizeScalar(value) as Prisma.InputJsonValue;

  try {
    return JSON.parse(value) as Prisma.InputJsonValue;
  } catch {
    return value as Prisma.InputJsonValue;
  }
}

function deriveMode(docId: string | null, payload: Record<string, unknown> | null) {
  const payloadMode = cleanText(payload?.formMode);
  if (payloadMode) return payloadMode;
  if (!docId) return 'STANDARD';
  if (docId.startsWith('CI-')) return 'CHECK_IN';
  if (docId.startsWith('CO-')) return 'CHECK_OUT';
  if (docId.startsWith('CH-')) return 'CHANGES';
  return 'STANDARD';
}

function parseItemsFromText(itemsText: string | null) {
  if (!itemsText) return [];
  return itemsText
    .split(/\s*,\s*(?=\[)/)
    .map((entry) => {
      const match = entry.match(/\[(IN|OUT)\]\s+(.+?)\s+\((\d+)\s*(?:pc|pcs|unit|units)\)\s*-\s*(.+)/i);
      if (!match) return null;
      return {
        type: match[1].toUpperCase(),
        tag: match[2].trim(),
        qty: Number(match[3]),
        sku: match[4].trim()
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
}

async function replaceHandoverData(rows: Row[] | undefined, assetMap: Map<string, string>) {
  await prisma.handoverItem.deleteMany();
  await prisma.handoverDocument.deleteMany();
  if (!rows?.length) return { documents: 0, items: 0 };

  const docRecords: Prisma.HandoverDocumentCreateManyInput[] = [];
  const itemBuffer: Array<{
    docNumber: string;
    assetTag: string | null;
    itemName: string;
    quantity: number;
    direction: string;
    itemSku: string | null;
    isShared: boolean;
    isBroken: boolean;
    sharedAccount: string | null;
    sharedDept: string | null;
    dutyLocation: string | null;
  }> = [];

  for (const row of rows.slice(1)) {
    const docNumber = cleanText(row[1]);
    const transactionType = cleanText(row[2]);
    if (!docNumber || !transactionType) continue;

    const payload = parseJsonValue(row[10]);
    const payloadObject = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
    const revisionHistory = parseJsonValue(row[11]);
    const rawItemsText = cleanText(row[6]);
    const parsedItems = Array.isArray(payloadObject?.items)
      ? payloadObject.items as Array<Record<string, unknown>>
      : parseItemsFromText(rawItemsText);

    docRecords.push({
      docNumber,
      mode: deriveMode(docNumber, payloadObject),
      transactionType,
      status: cleanText(row[8]) || 'Unknown',
      holderName: cleanText(row[3]),
      holderNik: cleanText(row[4]),
      holderEmail: cleanText(payloadObject?.userEmail)?.toLowerCase() || null,
      holderDepartment: cleanText(row[5]),
      userAccount: cleanText(payloadObject?.userAcc),
      notes: cleanText(row[7]),
      rawItemsText,
      pdfUrl: cleanText(row[9]),
      ...(payload !== null ? { payloadJson: payload as Prisma.InputJsonValue } : {}),
      ...(revisionHistory !== null ? { revisionHistoryJson: revisionHistory as Prisma.InputJsonValue } : {}),
      transactionTimestamp: parseDateish(row[0]),
      createdAt: parseDateish(row[0]) || new Date()
    });

    for (const item of parsedItems) {
      const itemName = cleanText(item.sku) || cleanText(item.itemName);
      if (!itemName) continue;
      itemBuffer.push({
        docNumber,
        assetTag: cleanText(item.tag),
        itemName,
        quantity: toInt(item.qty) ?? 1,
        direction: cleanText(item.type) || 'UNKNOWN',
        itemSku: cleanText(item.sku),
        isShared: Boolean(item.isShared),
        isBroken: Boolean(item.isBroken || item.broken),
        sharedAccount: cleanText(item.sharedAccount),
        sharedDept: cleanText(item.sharedDept),
        dutyLocation: cleanText(item.dutyLocation)
      });
    }
  }

  for (const group of chunk(docRecords, 100)) {
    await prisma.handoverDocument.createMany({ data: group });
  }

  const docMap = new Map(
    (await prisma.handoverDocument.findMany({
      select: {
        id: true,
        docNumber: true
      }
    })).map((doc) => [doc.docNumber, doc.id])
  );

  const itemRecords = itemBuffer
    .map((item) => {
      const handoverId = docMap.get(item.docNumber);
      if (!handoverId) return null;
      const normalizedTag = item.assetTag;
      return {
        handoverId,
        assetId: normalizedTag ? assetMap.get(normalizedTag) || null : null,
        assetTag: normalizedTag,
        itemName: item.itemName,
        itemSku: item.itemSku,
        quantity: item.quantity,
        direction: item.direction,
        isShared: item.isShared,
        isBroken: item.isBroken,
        sharedAccount: item.sharedAccount,
        sharedDept: item.sharedDept,
        dutyLocation: item.dutyLocation
      };
    })
    .filter(Boolean) as Prisma.HandoverItemCreateManyInput[];

  for (const group of chunk(itemRecords, 200)) {
    await prisma.handoverItem.createMany({ data: group });
  }

  return {
    documents: docRecords.length,
    items: itemRecords.length
  };
}

async function replaceProcurementRequests(liveRows: Row[] | undefined, archiveRows: Row[] | undefined) {
  await prisma.procurementRequest.deleteMany();

  const merged = new Map<string, Prisma.ProcurementRequestCreateManyInput>();

  function ingest(rows: Row[] | undefined, sourceSheet: 'database_request' | 'Archive') {
    if (!rows?.length) return;
    for (const row of rows.slice(1)) {
      const requestNumber = cleanText(row[1]);
      if (!requestNumber) continue;

      merged.set(requestNumber, {
        requestNumber,
        requestSource: cleanText(row[2]),
        sourceReference: cleanText(row[3]),
        processorEmail: cleanText(row[4])?.toLowerCase() || null,
        requestorName: cleanText(row[7]),
        itemSummary: cleanText(row[5]) || 'Unknown item',
        quantity: toInt(row[6]) ?? 1,
        fulfillment: cleanText(row[8]) || 'TBD',
        referenceNo: cleanText(row[9]),
        status: cleanText(row[10]) || 'Unknown',
        notes: cleanText(row[11]),
        logText: cleanText(row[12]),
        statusRemark: cleanText(row[13]),
        sourceSheet,
        requestTimestamp: parseDateish(row[0]),
        isArchived: sourceSheet === 'Archive',
        createdAt: parseDateish(row[0]) || new Date()
      });
    }
  }

  ingest(liveRows, 'database_request');
  ingest(archiveRows, 'Archive');

  const records = [...merged.values()];
  for (const group of chunk(records, 250)) {
    await prisma.procurementRequest.createMany({ data: group });
  }

  return records.length;
}

async function replaceAssetAssignmentLedger(rows: Row[] | undefined) {
  await prisma.assetAssignmentLedgerEntry.deleteMany();
  if (!rows?.length) return 0;

  const records = rows
    .slice(1)
    .map((row, index) => {
      const holderKey = cleanText(row[1]);
      if (!holderKey) return null;

      return {
        sourceHash: makeHash(['ledger', index + 2, ...row]),
        assetTag: cleanText(row[0]),
        holderKey,
        nik: cleanText(row[2]),
        fullName: cleanText(row[3]),
        email: cleanText(row[4])?.toLowerCase() || null,
        account: cleanText(row[5]),
        department: cleanText(row[6]),
        docNumber: cleanText(row[7]),
        transactionTimestamp: parseDateish(row[8]),
        assetLocation: cleanText(row[9]),
        resolvedToMaster: cleanText(row[10])?.toUpperCase() === 'YES',
        masterRow: cleanText(row[11]),
        source: cleanText(row[12]),
        itemModel: cleanText(row[13]),
        category: cleanText(row[14]),
        updatedAt: parseDateish(row[15])
      };
    })
    .filter(Boolean) as Prisma.AssetAssignmentLedgerEntryCreateManyInput[];

  for (const group of chunk(records, 250)) {
    await prisma.assetAssignmentLedgerEntry.createMany({ data: group });
  }

  return records.length;
}

async function replaceEmployeeAssetHoldings(rows: Row[] | undefined) {
  await prisma.employeeAssetHolding.deleteMany();
  if (!rows?.length) return 0;

  const records = rows
    .slice(1)
    .map((row, index) => {
      const employeeKey = cleanText(row[0]);
      if (!employeeKey) return null;

      return {
        sourceHash: makeHash(['holding', index + 2, ...row]),
        employeeKey,
        nik: cleanText(row[1]),
        fullName: cleanText(row[2]),
        email: cleanText(row[3])?.toLowerCase() || null,
        account: cleanText(row[4]),
        department: cleanText(row[5]),
        title: cleanText(row[6]),
        assetKind: cleanText(row[7]),
        assetRef: cleanText(row[8]),
        itemModel: cleanText(row[9]),
        category: cleanText(row[10]),
        quantity: toInt(row[11]),
        location: cleanText(row[12]),
        status: cleanText(row[13]),
        source: cleanText(row[14]),
        updatedAt: parseDateish(row[15])
      };
    })
    .filter(Boolean) as Prisma.EmployeeAssetHoldingCreateManyInput[];

  for (const group of chunk(records, 250)) {
    await prisma.employeeAssetHolding.createMany({ data: group });
  }

  return records.length;
}

async function main() {
  const workbookPath = process.argv[2];
  if (!workbookPath) {
    throw new Error('Workbook path is required. Example: npm run import:workbook -- /imports/atlas.xlsx');
  }

  const resolvedPath = path.resolve(workbookPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Workbook file not found: ${resolvedPath}`);
  }

  const stats = fs.statSync(resolvedPath);
  const sheets = readWorkbookSheets(resolvedPath);

  const batch = await prisma.workbookImportBatch.create({
    data: {
      sourceFile: path.basename(resolvedPath),
      sourceSize: Number(stats.size),
      status: 'RUNNING'
    }
  });
  latestBatchId = batch.id;

  const rawImportedRows = await createRawImport(batch.id, sheets);
  const authorizedUsers = await importAuthorizedUsers(sheets.get('Authorized_Users'));
  const references = await replaceMasterReferences(sheets.get('Master_Reference'));
  const locations = await replaceMasterLocations(sheets.get('Master_Location'));
  const suppliers = await replaceSuppliers(sheets.get('Master_Supplier'));
  const catalogItems = await replaceCatalogItems(sheets.get('Master_Katalog'));
  const assetMap = await replaceAssets(sheets.get('Master_Asset'));
  const assetRevisions = await replaceAssetRevisions(sheets.get('Asset_Revision_Log'), assetMap);
  const handover = await replaceHandoverData(sheets.get('Asset_Handover_Log'), assetMap);
  const procurementRequests = await replaceProcurementRequests(
    sheets.get('database_request'),
    sheets.get('Archive')
  );
  const assignmentLedger = await replaceAssetAssignmentLedger(sheets.get('Asset_Assignment_Ledger_DB'));
  const employeeHoldings = await replaceEmployeeAssetHoldings(sheets.get('Employee_Asset_Holdings_DB'));

  await ensureLocalSuperAdmin();

  await prisma.workbookImportBatch.update({
    where: { id: batch.id },
    data: {
      status: 'COMPLETED',
      importedRows: rawImportedRows,
      completedAt: new Date(),
      notes: JSON.stringify({
        authorizedUsers,
        references,
        locations,
        suppliers,
        catalogItems,
        assets: assetMap.size,
        assetRevisions,
        handoverDocuments: handover.documents,
        handoverItems: handover.items,
        procurementRequests,
        assignmentLedger,
        employeeHoldings
      })
    }
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        batchId: batch.id,
        workbook: path.basename(resolvedPath),
        rawImportedRows,
        authorizedUsers,
        references,
        locations,
        suppliers,
        catalogItems,
        assets: assetMap.size,
        assetRevisions,
        handoverDocuments: handover.documents,
        handoverItems: handover.items,
        procurementRequests,
        assignmentLedger,
        employeeHoldings
      },
      null,
      2
    )
  );
}

let latestBatchId: string | null = null;

main()
  .catch(async (error) => {
    if (latestBatchId) {
      await prisma.workbookImportBatch.update({
        where: { id: latestBatchId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          notes: error instanceof Error ? error.message : String(error)
        }
      });
    }
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
