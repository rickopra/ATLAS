import { Prisma } from '@prisma/client';

import { prisma } from '../db.js';

const CATALOG_CATEGORY_TYPE = 'CatalogCategory';

type CatalogActor = {
  id?: string | null;
  email?: string | null;
  fullName?: string | null;
};

type CatalogItemPayload = {
  category: string;
  sku: string;
  account?: string;
  specification?: string;
  estimatedPrice?: string | number | null;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function categoryRefKey(name: string) {
  return `${CATALOG_CATEGORY_TYPE}||${lower(name)}||`;
}

function auditActor(actor: CatalogActor) {
  return text(actor.email || actor.fullName || 'system');
}

function pageMeta(total: number) {
  return {
    page: 1,
    pageSize: Math.max(1, total || 1),
    total,
    pageCount: 1
  };
}

function buildCatalogWhere(search: string) {
  const q = text(search);
  if (!q) return undefined;

  return {
    OR: [
      { category: { contains: q, mode: 'insensitive' as const } },
      { sku: { contains: q, mode: 'insensitive' as const } },
      { account: { contains: q, mode: 'insensitive' as const } },
      { specification: { contains: q, mode: 'insensitive' as const } }
    ]
  };
}

function parseEstimatedPrice(value: unknown) {
  const raw = text(value);
  if (!raw || raw === '-') return null;
  const numeric = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(numeric)) {
    return { error: 'Estimated price must be a valid number.' as const };
  }
  return new Prisma.Decimal(numeric);
}

async function writeCatalogAuditLog(input: {
  actor: CatalogActor;
  action: string;
  entityType: string;
  entityId: string;
  payloadJson?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actor.id || null,
      actorEmail: auditActor(input.actor),
      module: 'CATALOG_MANAGEMENT',
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      payloadJson: input.payloadJson
    }
  });
}

async function getCatalogCategoryNames() {
  const [refs, items] = await Promise.all([
    prisma.masterReference.findMany({
      where: { type: CATALOG_CATEGORY_TYPE },
      select: { value: true },
      orderBy: { value: 'asc' }
    }),
    prisma.catalogItem.findMany({
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' }
    })
  ]);

  return [...new Set([
    ...refs.map((entry) => text(entry.value)).filter(Boolean),
    ...items.map((entry) => text(entry.category)).filter(Boolean)
  ])].sort((left, right) => left.localeCompare(right));
}

async function getCatalogAccountOptions() {
  const [refs, items] = await Promise.all([
    prisma.masterReference.findMany({
      where: { type: 'Account' },
      select: { value: true },
      orderBy: { value: 'asc' }
    }),
    prisma.catalogItem.findMany({
      where: {
        NOT: {
          account: null
        }
      },
      distinct: ['account'],
      select: { account: true },
      orderBy: { account: 'asc' }
    })
  ]);

  return [...new Set([
    ...refs.map((entry) => text(entry.value)).filter(Boolean),
    ...items.map((entry) => text(entry.account)).filter(Boolean)
  ])].sort((left, right) => left.localeCompare(right));
}

async function ensureCatalogCategory(category: string, tx: typeof prisma | Prisma.TransactionClient = prisma) {
  const clean = text(category);
  if (!clean) return;

  const existing = await tx.masterReference.findFirst({
    where: {
      type: CATALOG_CATEGORY_TYPE,
      value: {
        equals: clean,
        mode: 'insensitive'
      }
    },
    select: { id: true }
  });

  if (existing) return;

  await tx.masterReference.create({
    data: {
      type: CATALOG_CATEGORY_TYPE,
      value: clean,
      parentLink: null,
      key: categoryRefKey(clean)
    }
  });
}

export async function listCatalog(search: string) {
  const where = buildCatalogWhere(search);
  const [items, allCategories, accountOptions] = await Promise.all([
    prisma.catalogItem.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sku: 'asc' }]
    }),
    getCatalogCategoryNames(),
    getCatalogAccountOptions()
  ]);

  return {
    ok: true,
    items,
    meta: pageMeta(items.length),
    catalog: {
      categories: allCategories.map((name) => ({
        name,
        itemCount: items.filter((entry) => lower(entry.category) === lower(name)).length
      })),
      accountOptions,
      totalItems: items.length,
      totalCategories: allCategories.length
    }
  };
}

export async function addCatalogCategory(name: string, actor: CatalogActor) {
  const category = text(name);
  if (!category) return { success: false, message: 'REJECTED: Category name cannot be empty!' };

  const [existingRef, existingItem] = await Promise.all([
    prisma.masterReference.findFirst({
      where: {
        type: CATALOG_CATEGORY_TYPE,
        value: {
          equals: category,
          mode: 'insensitive'
        }
      },
      select: { id: true }
    }),
    prisma.catalogItem.findFirst({
      where: {
        category: {
          equals: category,
          mode: 'insensitive'
        }
      },
      select: { id: true }
    })
  ]);

  if (existingRef || existingItem) {
    return { success: false, message: `REJECTED: Category '${category}' sudah ada!` };
  }

  const created = await prisma.masterReference.create({
    data: {
      type: CATALOG_CATEGORY_TYPE,
      value: category,
      parentLink: null,
      key: categoryRefKey(category)
    }
  });

  await writeCatalogAuditLog({
    actor,
    action: 'ADD_CATEGORY',
    entityType: 'CatalogCategory',
    entityId: created.id,
    payloadJson: { category }
  });

  return {
    success: true,
    message: `SUCCESS: Category '${category}' berhasil dibuat.`
  };
}

export async function addCatalogItem(payload: CatalogItemPayload, actor: CatalogActor) {
  const category = text(payload.category);
  const sku = text(payload.sku);
  if (!sku) return { success: false, message: 'REJECTED: Nama SKU/Item Wajib Diisi!' };
  if (!category) return { success: false, message: 'REJECTED: Kategori Wajib Diisi!' };

  const duplicate = await prisma.catalogItem.findFirst({
    where: {
      sku: {
        equals: sku,
        mode: 'insensitive'
      }
    },
    select: { id: true }
  });
  if (duplicate) return { success: false, message: 'REJECTED: Nama Item/SKU sudah ada!' };

  const parsedPrice = parseEstimatedPrice(payload.estimatedPrice);
  if (parsedPrice && typeof parsedPrice === 'object' && 'error' in parsedPrice) {
    return { success: false, message: parsedPrice.error };
  }

  const account = text(payload.account);
  const specification = text(payload.specification);
  const item = await prisma.$transaction(async (tx) => {
    await ensureCatalogCategory(category, tx);
    return tx.catalogItem.create({
      data: {
        category,
        sku,
        account: account || null,
        specification: specification || null,
        estimatedPrice: parsedPrice || null
      }
    });
  });

  await writeCatalogAuditLog({
    actor,
    action: 'ADD_SKU',
    entityType: 'CatalogItem',
    entityId: item.id,
    payloadJson: {
      category,
      sku,
      account: account || '',
      specification: specification || '',
      estimatedPrice: parsedPrice ? parsedPrice.toString() : ''
    }
  });

  return {
    success: true,
    message: `SUCCESS: ${sku} ditambahkan.`,
    item
  };
}

export async function editCatalogItem(originalSku: string, payload: CatalogItemPayload, actor: CatalogActor) {
  const original = text(originalSku);
  const category = text(payload.category);
  const sku = text(payload.sku);
  if (!sku) return { success: false, message: 'REJECTED: Nama SKU/Item Wajib Diisi!' };
  if (!category) return { success: false, message: 'REJECTED: Kategori Wajib Diisi!' };

  const existing = await prisma.catalogItem.findFirst({
    where: {
      sku: {
        equals: original,
        mode: 'insensitive'
      }
    }
  });
  if (!existing) return { success: false, message: 'Error: Item tidak ditemukan untuk diedit.' };

  const duplicate = await prisma.catalogItem.findFirst({
    where: {
      id: {
        not: existing.id
      },
      sku: {
        equals: sku,
        mode: 'insensitive'
      }
    },
    select: { id: true }
  });
  if (duplicate) return { success: false, message: 'REJECTED: Nama Item/SKU sudah ada!' };

  const parsedPrice = parseEstimatedPrice(payload.estimatedPrice);
  if (parsedPrice && typeof parsedPrice === 'object' && 'error' in parsedPrice) {
    return { success: false, message: parsedPrice.error };
  }

  const account = text(payload.account);
  const specification = text(payload.specification);
  const updated = await prisma.$transaction(async (tx) => {
    await ensureCatalogCategory(category, tx);
    return tx.catalogItem.update({
      where: { id: existing.id },
      data: {
        category,
        sku,
        account: account || null,
        specification: specification || null,
        estimatedPrice: parsedPrice || null
      }
    });
  });

  await writeCatalogAuditLog({
    actor,
    action: 'EDIT_SKU',
    entityType: 'CatalogItem',
    entityId: updated.id,
    payloadJson: {
      before: {
        category: existing.category,
        sku: existing.sku,
        account: existing.account,
        specification: existing.specification,
        estimatedPrice: existing.estimatedPrice?.toString() || ''
      },
      after: {
        category: updated.category,
        sku: updated.sku,
        account: updated.account,
        specification: updated.specification,
        estimatedPrice: updated.estimatedPrice?.toString() || ''
      }
    }
  });

  return {
    success: true,
    message: 'SUCCESS: Item berhasil diperbarui.',
    item: updated
  };
}

export async function deleteCatalogItem(name: string, actor: CatalogActor) {
  const sku = text(name);
  if (!sku) return { success: false, message: 'Item name is required.' };

  const item = await prisma.catalogItem.findFirst({
    where: {
      sku: {
        equals: sku,
        mode: 'insensitive'
      }
    }
  });
  if (!item) return { success: false, message: 'Error: Item tidak ditemukan.' };

  await prisma.catalogItem.delete({
    where: { id: item.id }
  });

  await writeCatalogAuditLog({
    actor,
    action: 'DELETE_SKU',
    entityType: 'CatalogItem',
    entityId: item.id,
    payloadJson: {
      category: item.category,
      sku: item.sku
    }
  });

  return {
    success: true,
    message: 'SUCCESS: Item dihapus dari katalog.'
  };
}

export async function deleteCatalogCategory(name: string, actor: CatalogActor) {
  const category = text(name);
  if (!category) return { success: false, message: 'Category name is required.' };

  const deleted = await prisma.$transaction(async (tx) => {
    const deletedItems = await tx.catalogItem.deleteMany({
      where: {
        category: {
          equals: category,
          mode: 'insensitive'
        }
      }
    });

    const deletedRefs = await tx.masterReference.deleteMany({
      where: {
        type: CATALOG_CATEGORY_TYPE,
        value: {
          equals: category,
          mode: 'insensitive'
        }
      }
    });

    return {
      deletedItems: deletedItems.count,
      deletedRefs: deletedRefs.count
    };
  });

  if (!deleted.deletedItems && !deleted.deletedRefs) {
    return { success: false, message: 'Error: Category tidak ditemukan atau sudah kosong.' };
  }

  await writeCatalogAuditLog({
    actor,
    action: 'DELETE_CATEGORY',
    entityType: 'CatalogCategory',
    entityId: category,
    payloadJson: {
      category,
      deletedItems: deleted.deletedItems
    }
  });

  return {
    success: true,
    message: `SUCCESS: Category '${category}' dihapus. Total ${deleted.deletedItems} Item SKU ikut terhapus.`
  };
}
