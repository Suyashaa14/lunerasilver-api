import db from "../../utils/db";
import { computePrice, backSolveMakingCharge } from "../../utils/pricing";
import { uploadImageBuffer, deleteImage } from "../../utils/cloudinary";
import { getCurrentSilverRatePerGram } from "../settings/provider.settings";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { CreateJewelryPayload, UpdateJewelryPayload, JewelryDTO } from "./interface/interface.jewelries";

export const getCurrentSilverRate = async (): Promise<number> => {
  return getCurrentSilverRatePerGram();
};

const toDTO = (row: any, rate: number): JewelryDTO => {
  const stoneWeightGrams = row.stone_weight_grams === null || row.stone_weight_grams === undefined ? null : Number(row.stone_weight_grams);
  const stonePrice = row.stone_price === null || row.stone_price === undefined ? null : Number(row.stone_price);
  const silverWeight = Number(row.silver_weight_grams);
  const makingCharge = Number(row.making_charge);

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    imageUrl: row.image_url,
    silverWeightGrams: silverWeight,
    makingCharge,
    status: row.status,
    price: computePrice(silverWeight, makingCharge, rate, stonePrice ?? 0),
    stoneWeightGrams,
    stonePrice,
    estimatedCost: silverWeight * rate + (stonePrice ?? 0) + makingCharge,
    createdAt: row.created_at,
  };
};

interface ListFilters {
  category?: string;
  status?: string;
  page: number;
  pageSize: number;
}

/** Statuses a shopper may see. Everything else has left the shelf. */
const PUBLICLY_VISIBLE = ["available", "reserved"];

export const listJewelries = async (filters: ListFilters) => {
  const query = db("jewelries").orderBy("created_at", "desc");
  if (filters.category) query.where({ category: filters.category });

  if (filters.status) {
    query.where({ status: filters.status });
  } else {
    // This endpoint is public. Without this, a piece that was sold, broke, was
    // lost, or was entered by mistake stayed on the storefront and could be
    // added to a cart -- the checkout would then refuse it, having already
    // shown a customer something that was never for sale.
    query.whereIn("status", PUBLICLY_VISIBLE);
  }

  const [rows, rate] = await Promise.all([query, getCurrentSilverRate()]);
  const all = rows.map((r) => toDTO(r, rate));
  const start = (filters.page - 1) * filters.pageSize;

  return {
    data: all.slice(start, start + filters.pageSize),
    total: all.length,
    page: filters.page,
    pageSize: filters.pageSize,
  };
};

export const getJewelry = async (id: number) => {
  const row = await db("jewelries").where({ id }).first();
  if (!row) return null;
  const rate = await getCurrentSilverRate();
  return toDTO(row, rate);
};

const resolveMakingCharge = (
  data: CreateJewelryPayload | UpdateJewelryPayload,
  weight: number,
  rate: number,
  fallback: number,
): number => {
  if (data.pricingMode === "totalCost" && data.totalCost !== undefined) {
    return backSolveMakingCharge(weight, data.totalCost, rate);
  }
  if (data.pricingMode === "makingCharge" && data.makingCharge !== undefined) {
    return data.makingCharge;
  }
  return fallback;
};

export const createJewelry = async (
  data: CreateJewelryPayload,
  file?: Express.Multer.File,
) => {
  const rate = await getCurrentSilverRate();
  const makingCharge = resolveMakingCharge(data, data.silverWeightGrams, rate, 0);

  if (makingCharge < 0) {
    throw Object.assign(
      new Error("Total cost is lower than the silver cost alone — making charge would be negative"),
      { status: 400 },
    );
  }

  let image_url: string | null = null;
  let image_public_id: string | null = null;
  if (file) {
    const uploaded = await uploadImageBuffer(file.buffer);
    image_url = uploaded.url;
    image_public_id = uploaded.publicId;
  }

  const [id] = await db("jewelries").insert({
    name: data.name,
    category: data.category,
    silver_weight_grams: data.silverWeightGrams,
    making_charge: makingCharge,
    stone_weight_grams: data.stoneWeightGrams ?? null,
    stone_price: data.stonePrice ?? null,
    image_url,
    image_public_id,
  });

  return getJewelry(id);
};

export const updateJewelry = async (
  id: number,
  data: UpdateJewelryPayload,
  file?: Express.Multer.File,
) => {
  const existing = await db("jewelries").where({ id }).first();
  if (!existing) return null;

  const rate = await getCurrentSilverRate();
  const weight = data.silverWeightGrams ?? Number(existing.silver_weight_grams);
  const makingCharge = resolveMakingCharge(data, weight, rate, Number(existing.making_charge));

  if (makingCharge < 0) {
    throw Object.assign(
      new Error("Total cost is lower than the silver cost alone — making charge would be negative"),
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {
    name: data.name ?? existing.name,
    category: data.category ?? existing.category,
    silver_weight_grams: weight,
    making_charge: makingCharge,
    stone_weight_grams: data.stoneWeightGrams ?? existing.stone_weight_grams,
    stone_price: data.stonePrice ?? existing.stone_price,
  };

  if (file) {
    const uploaded = await uploadImageBuffer(file.buffer);
    update.image_url = uploaded.url;
    update.image_public_id = uploaded.publicId;
    if (existing.image_public_id) await deleteImage(existing.image_public_id);
  }

  await db("jewelries").where({ id }).update(update);
  return getJewelry(id);
};

/** Reasons a piece leaves the shelf without being sold. */
export type RetireStatus = "damaged" | "lost" | "voided";

const RETIRE_LEDGER_TYPE: Record<RetireStatus, string> = {
  damaged: "damage",
  lost: "lost",
  // A mis-entry never existed, so it is an inventory correction rather than a
  // loss. Recording it as damage would claim a loss that never happened.
  voided: "adjustment",
};

/**
 * Takes a piece off the shelf without removing it.
 *
 * The row stays, because invoice lines and stock rows point at it and the
 * history has to keep reading correctly. One outbound ledger row is written so
 * the stock count still adds up, plus an audit row -- all in one transaction.
 *
 * The photo is deliberately left on Cloudinary: an invoice issued earlier may
 * still be showing it.
 */
export const retireJewelry = async (
  id: number,
  status: RetireStatus,
  reason: string,
  actor: AuditActor,
) => {
  const existing = await db("jewelries").where({ id }).first();
  if (!existing) return null;

  if (existing.status === "sold") {
    throw Object.assign(
      new Error("This piece is sold. Reverse it with a credit note, not a status change."),
      { status: 409 },
    );
  }
  if (existing.status === status) {
    throw Object.assign(new Error(`This piece is already marked ${status}`), { status: 409 });
  }

  await db.transaction(async (trx) => {
    await trx("jewelries").where({ id }).update({ status });

    await trx("inventory_transactions").insert({
      jewelry_id: id,
      type: RETIRE_LEDGER_TYPE[status],
      direction: "out",
      quantity: 1,
      cost_amount: existing.cost_price ?? null,
      reference_type: "manual",
      reference_id: null,
      note: reason,
      created_by: actor.userId ?? null,
    });

    await writeAuditLog(trx, {
      ...actor,
      action: "void",
      entityType: "jewelries",
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status, reason },
    });
  });

  return getJewelry(id);
};

const STALE_DAYS = 60;

export interface CatalogueFilters {
  search?: string;
  category?: string;
  status?: string;
  staleOnly?: boolean;
  missingCostOnly?: boolean;
  page: number;
  pageSize: number;
}

/**
 * The jewellery book: every piece, what it is worth today, and how long it has
 * been sitting. Totals are for the whole filtered set, not just the page shown.
 */
export const listCatalogue = async (filters: CatalogueFilters) => {
  const base = db("jewelries");

  if (filters.search) {
    const term = `%${filters.search.trim()}%`;
    base.where((q) => q.where("name", "like", term).orWhere("sku", "like", term));
  }
  if (filters.category) base.where({ category: filters.category });
  if (filters.status) base.where({ status: filters.status });
  if (filters.missingCostOnly) base.whereNull("cost_price");
  if (filters.staleOnly) {
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
    base.where("created_at", "<=", cutoff).whereIn("status", ["available", "reserved"]);
  }

  const [rate, totals, countRow, rows, categories] = await Promise.all([
    getCurrentSilverRate(),
    base.clone().sum({ silver: "silver_weight_grams" }).sum({ cost: "cost_price" }).first(),
    base.clone().count({ c: "*" }).first(),
    base.clone().orderBy("created_at", "desc").limit(filters.pageSize).offset((filters.page - 1) * filters.pageSize),
    db("jewelries").distinct("category").orderBy("category"),
  ]);

  // The date a piece left the shelf, read from the stock ledger rather than
  // guessed from the piece row.
  const ids = rows.map((r: any) => r.id);
  const soldRows = ids.length
    ? await db("inventory_transactions")
        .whereIn("jewelry_id", ids)
        .where({ direction: "out" })
        .orderBy("id", "desc")
        .select("jewelry_id", "created_at")
    : [];
  const soldAt = new Map<number, string>();
  for (const r of soldRows as any[]) if (!soldAt.has(Number(r.jewelry_id))) soldAt.set(Number(r.jewelry_id), r.created_at);

  const onShelf = ["available", "reserved"];
  const now = Date.now();

  return {
    data: rows.map((r: any) => {
      const dto = toDTO(r, rate);
      const days = Math.floor((now - new Date(r.created_at).getTime()) / 86400000);
      return {
        ...dto,
        sku: r.sku,
        material: r.material,
        purity: r.purity,
        costPrice: r.cost_price === null ? null : Number(r.cost_price),
        // Sold and retired pieces have no live price; showing one would imply
        // they are still for sale.
        priceToday: onShelf.includes(r.status) ? dto.price : null,
        daysInStock: onShelf.includes(r.status) ? days : null,
        isStale: onShelf.includes(r.status) && days >= STALE_DAYS,
        soldAt: soldAt.get(Number(r.id)) ?? null,
      };
    }),
    totals: {
      pieces: Number((countRow as any).c),
      silverGrams: Number((totals as any)?.silver ?? 0),
      costTotal: Number((totals as any)?.cost ?? 0),
    },
    categories: (categories as any[]).map((c) => c.category),
    silverRatePerGram: rate,
    staleDays: STALE_DAYS,
    page: filters.page,
    pageSize: filters.pageSize,
  };
};

/** One piece, with where it came from, everywhere it appears, and its whole ledger. */
export const getJewelryDetail = async (id: number) => {
  const row = await db("jewelries").where({ id }).first();
  if (!row) return null;

  const rate = await getCurrentSilverRate();
  const dto = toDTO(row, rate);

  const [source, movements, inCarts, openOrders, invoiced, rateRow] = await Promise.all([
    row.purchase_item_id
      ? db("purchase_items as pi")
          .join("purchases as p", "p.id", "pi.purchase_id")
          .join("suppliers as s", "s.id", "p.supplier_id")
          .where("pi.id", row.purchase_item_id)
          .first("s.name as supplier_name", "p.bill_no", "p.bill_date", "p.bill_date_bs", "pi.unit_cost")
      : null,
    db("inventory_transactions").where({ jewelry_id: id }).orderBy("id", "asc"),
    db("cart_items").where({ jewelry_id: id }).count({ c: "*" }).first(),
    db("order_items as oi").join("orders as o", "o.id", "oi.order_id")
      .where("oi.jewelry_id", id).whereIn("o.status", ["pending", "confirmed"]).count({ c: "*" }).first(),
    db("invoice_items as ii").join("invoices as i", "i.id", "ii.invoice_id")
      .where("ii.jewelry_id", id).where("i.is_void", false).count({ c: "*" }).first(),
    db("silver_rates").whereNull("effective_to").first("rate_per_gram", "effective_from"),
  ]);

  const onShelf = ["available", "reserved"].includes(row.status);
  const cost = row.cost_price === null ? null : Number(row.cost_price);
  const price = dto.price;

  return {
    ...dto,
    sku: row.sku,
    material: row.material,
    purity: row.purity,
    costPrice: cost,
    priceToday: onShelf ? price : null,
    margin: cost === null || !onShelf ? null : Math.round((price - cost) * 100) / 100,
    marginPercent: cost === null || !onShelf || price === 0 ? null : Math.round(((price - cost) / price) * 1000) / 10,
    daysInStock: onShelf ? Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86400000) : null,
    staleDays: STALE_DAYS,
    silverRate: { perGram: rate, effectiveFrom: (rateRow as any)?.effective_from ?? null },
    source: source
      ? {
          supplierName: (source as any).supplier_name,
          billNo: (source as any).bill_no,
          billDate: (source as any).bill_date,
          billDateBs: (source as any).bill_date_bs,
          landedCost: Number((source as any).unit_cost),
        }
      : null,
    whereItAppears: {
      storefront: row.status === "available",
      inCarts: Number((inCarts as any).c),
      openOrders: Number((openOrders as any).c),
      invoiced: Number((invoiced as any).c),
    },
    // A piece with ledger rows or invoice lines is kept for audit; it can only
    // be retired with a status change.
    canBeDeleted: false,
    movements: (movements as any[]).map((m) => ({
      id: m.id,
      type: m.type,
      direction: m.direction,
      referenceType: m.reference_type,
      referenceId: m.reference_id === null ? null : Number(m.reference_id),
      costAmount: m.cost_amount === null ? null : Number(m.cost_amount),
      note: m.note,
      createdAt: m.created_at,
    })),
  };
};
