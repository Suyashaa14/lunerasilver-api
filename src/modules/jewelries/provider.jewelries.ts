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
    price: computePrice(silverWeight, makingCharge, rate),
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

export const listJewelries = async (filters: ListFilters) => {
  const query = db("jewelries").orderBy("created_at", "desc");
  if (filters.category) query.where({ category: filters.category });
  if (filters.status) query.where({ status: filters.status });

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
