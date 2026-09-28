import type { Knex } from "knex";
import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { stampForDate } from "../../utils/fiscalYear";
import { postPurchase, postReversal } from "../ledger/provider.posting";
import { computeCost } from "../../utils/pricing";

const money = (n: number) => Math.round(n * 100) / 100;

/** YYYY-MM-DD in the shop's own time zone. The driver hands DATE columns back
    as local-midnight Date objects, and toISOString would shift them a day back. */
const localDate = (value: Date | string = new Date()): string => {
  if (typeof value === "string") return value.slice(0, 10);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

/**
 * What one line of the bill costs.
 *
 * A line that books a piece and states the silver rate paid has its cost worked
 * out from the parts -- silver, making charge, stone -- so the bill and the
 * piece can never tell two different stories about the same purchase. A typed
 * total that disagrees with its own parts is refused rather than quietly
 * preferred, because either figure could be the wrong one.
 */
const costOfLine = (line: PurchaseLine): number => {
  const rate = line.stockIn?.ratePerGram ?? (line.stockIn ? line.ratePerGram : undefined);
  if (line.stockIn && rate !== undefined && rate !== null) {
    const parts = computeCost(
      line.stockIn.silverWeightGrams,
      line.stockIn.makingCharge,
      rate,
      line.stockIn.stonePrice ?? 0,
    );
    if (line.unitCost !== undefined && Math.abs(money(line.unitCost) - parts) > 0.01) {
      throw Object.assign(
        new Error(
          `${line.description}: the cost typed (${money(line.unitCost)}) does not match ` +
            `silver + making + stone (${parts}).`,
        ),
        { status: 400 },
      );
    }
    return parts;
  }

  if (line.unitCost === undefined) {
    throw Object.assign(
      new Error(`${line.description}: a line needs a cost, or the silver rate paid so one can be worked out`),
      { status: 400 },
    );
  }
  return money(line.unitCost);
};

export interface PurchaseLine {
  description: string;
  material?: string;
  weightGrams?: number;
  ratePerGram?: number;
  /** Optional when the line books a piece and gives the rate paid: the cost is
      then worked out from the parts, so the bill and the piece cannot disagree. */
  unitCost?: number;
  vatAmount?: number;
  /** Book this line into stock as a sellable piece. */
  stockIn?: {
    name: string;
    category: string;
    sku?: string;
    material?: string;
    purity?: string;
    silverWeightGrams: number;
    /** The silver rate paid to this supplier, on this bill. Not today's. */
    ratePerGram?: number;
    makingCharge: number;
    stoneWeightGrams?: number | null;
    stonePrice?: number | null;
    /** What the shop adds on top when it sells. */
    profitAmount?: number;
  };
}

export interface CreatePurchasePayload {
  supplierId: number;
  billNo: string;
  billDate: string;
  discount?: number;
  tdsAmount?: number;
  paymentMethod?: string | null;
  paymentStatus?: "unpaid" | "partial" | "paid";
  notes?: string | null;
  items: PurchaseLine[];
  /** When this bill number is already entered for the supplier, add these
      lines to it instead of refusing. Used when old bills are typed in piece
      by piece at the till. */
  addToExisting?: boolean;
}

export const getPurchase = async (id: number) => {
  const purchase = await db("purchases").where({ id }).first();
  if (!purchase) return null;
  const items = await db("purchase_items").where({ purchase_id: id }).orderBy("id");
  const supplier = await db("suppliers").where({ id: purchase.supplier_id }).first("name", "pan");

  return {
    id: purchase.id,
    supplierId: Number(purchase.supplier_id),
    supplierName: supplier?.name ?? null,
    billNo: purchase.bill_no,
    billDate: purchase.bill_date,
    billDateBs: purchase.bill_date_bs,
    fiscalYear: purchase.fiscal_year,
    subtotal: Number(purchase.subtotal),
    discount: Number(purchase.discount),
    taxableAmount: Number(purchase.taxable_amount),
    vatAmount: Number(purchase.vat_amount),
    tdsAmount: Number(purchase.tds_amount),
    totalAmount: Number(purchase.total_amount),
    paymentStatus: purchase.payment_status,
    paymentMethod: purchase.payment_method,
    notes: purchase.notes,
    isVoid: Boolean(purchase.is_void),
    voidReason: purchase.void_reason,
    voidedAt: purchase.voided_at,
    items: items.map((i: any) => ({
      id: i.id,
      jewelryId: i.jewelry_id === null ? null : Number(i.jewelry_id),
      description: i.description,
      material: i.material,
      weightGrams: i.weight_grams === null ? null : Number(i.weight_grams),
      ratePerGram: i.rate_per_gram === null ? null : Number(i.rate_per_gram),
      quantity: Number(i.quantity),
      unitCost: Number(i.unit_cost),
      vatAmount: Number(i.vat_amount),
      lineTotal: Number(i.line_total),
    })),
  };
};

/**
 * Records a supplier bill, and books its lines into stock.
 *
 * This is where cost price comes from. Until a piece arrives through a bill it
 * has no landed cost, and every margin the shop reports about it is a guess.
 *
 * One transaction: the bill, its lines, the pieces it created, and one inbound
 * stock row each. A bill that half-saved would leave pieces on the shelf that
 * nobody bought.
 */
export const createPurchase = async (payload: CreatePurchasePayload, actor: AuditActor) => {
  if (!payload.items || payload.items.length === 0) {
    throw Object.assign(new Error("A bill needs at least one line"), { status: 400 });
  }

  const purchaseId = await db.transaction(async (trx) => {
    const supplier = await trx("suppliers").where({ id: payload.supplierId }).first();
    if (!supplier) throw Object.assign(new Error("Supplier not found"), { status: 404 });

    // A voided bill no longer stands, so its number is free for the corrected one.
    const duplicate = await trx("purchases")
      .where({ supplier_id: payload.supplierId, bill_no: payload.billNo, is_void: false })
      .forUpdate()
      .first();
    if (duplicate && payload.addToExisting) {
      return appendLines(trx, duplicate, supplier, payload.items, actor);
    }
    if (duplicate) {
      throw Object.assign(
        new Error(`Bill ${payload.billNo} from ${supplier.name} is already entered`),
        { status: 409 },
      );
    }

    const { fiscalYear, bsDate } = await stampForDate(trx, payload.billDate);

    const subtotal = money(payload.items.reduce((s, i) => s + costOfLine(i), 0));
    const discount = money(payload.discount ?? 0);
    const taxable = money(subtotal - discount);
    const vatAmount = money(payload.items.reduce((s, i) => s + (i.vatAmount ?? 0), 0));
    const tds = money(payload.tdsAmount ?? 0);

    const [newId] = await trx("purchases").insert({
      supplier_id: payload.supplierId,
      bill_no: payload.billNo,
      bill_date: payload.billDate,
      bill_date_bs: bsDate,
      fiscal_year: fiscalYear,
      subtotal,
      discount,
      taxable_amount: taxable,
      vat_amount: vatAmount,
      tds_amount: tds,
      total_amount: money(taxable + vatAmount - tds),
      payment_method: payload.paymentMethod ?? null,
      payment_status: payload.paymentStatus ?? "unpaid",
      notes: payload.notes ?? null,
      created_by: actor.userId ?? null,
    });

    await insertLines(trx, newId as number, supplier.name, payload.billNo, payload.items, actor);

    await postPurchase(trx, {
      id: newId, bill_no: payload.billNo, bill_date: payload.billDate,
      taxable_amount: taxable, vat_amount: vatAmount, tds_amount: tds,
      total_amount: money(taxable + vatAmount - tds),
    }, actor);

    await writeAuditLog(trx, {
      ...actor,
      action: "create",
      entityType: "purchases",
      entityId: newId,
      newValues: { bill_no: payload.billNo, supplier_id: payload.supplierId, total_amount: money(taxable + vatAmount - tds) },
    });

    return newId;
  });

  return getPurchase(purchaseId);
};

/**
 * Writes a bill's lines, and books each stock line in as a piece with its
 * landed cost and one inbound stock row.
 */
const insertLines = async (
  trx: Knex.Transaction,
  purchaseId: number,
  supplierName: string,
  billNo: string,
  items: PurchaseLine[],
  actor: AuditActor,
) => {
  // PAN only means VAT on a bill is never coming back, so it is part of what
  // the piece cost. Registered, it is reclaimable and stays out of the cost.
  const business = await trx("business_profile").first("is_vat_registered");
  const vatReclaimable = Boolean(business?.is_vat_registered);

  for (const line of items) {
    const unitCost = costOfLine(line);
    const lineVat = line.vatAmount ?? 0;
    const lineTotal = money(unitCost + lineVat);
    // The landed cost every margin is measured against.
    const landedCost = money(vatReclaimable ? unitCost : unitCost + lineVat);

    let jewelryId: number | null = null;
    if (line.stockIn) {
      const sku = line.stockIn.sku ?? `${line.stockIn.category.slice(0, 3).toUpperCase()}-${Date.now()}${Math.floor(Math.random() * 100)}`;
      const [pieceId] = await trx("jewelries").insert({
        sku,
        name: line.stockIn.name,
        category: line.stockIn.category,
        material: line.stockIn.material ?? "silver",
        purity: line.stockIn.purity ?? null,
        silver_weight_grams: line.stockIn.silverWeightGrams,
        making_charge: line.stockIn.makingCharge,
        stone_weight_grams: line.stockIn.stoneWeightGrams ?? null,
        stone_price: line.stockIn.stonePrice ?? null,
        cost_price: landedCost,
        // The rate actually paid. Keeping it is what lets the piece explain
        // its own cost later, instead of asking anyone to trust the total.
        cost_rate_per_gram: line.stockIn.ratePerGram ?? line.ratePerGram ?? null,
        profit_amount: line.stockIn.profitAmount ?? 0,
        status: "available",
      });
      jewelryId = pieceId as number;
    }

    const [lineId] = await trx("purchase_items").insert({
      purchase_id: purchaseId,
      jewelry_id: jewelryId,
      description: line.description,
      material: line.material ?? null,
      weight_grams: line.weightGrams ?? line.stockIn?.silverWeightGrams ?? null,
      rate_per_gram: line.ratePerGram ?? line.stockIn?.ratePerGram ?? null,
      quantity: 1,
      unit_cost: money(unitCost),
      taxable_amount: money(unitCost),
      vat_amount: money(line.vatAmount ?? 0),
      line_total: lineTotal,
    });

    if (jewelryId) {
      // Close the loop back to the bill line, so the piece can always show
      // where it came from and what it cost.
      await trx("jewelries").where({ id: jewelryId }).update({ purchase_item_id: lineId });

      await trx("inventory_transactions").insert({
        jewelry_id: jewelryId,
        type: "purchase",
        direction: "in",
        quantity: 1,
        cost_amount: landedCost,
        reference_type: "purchase",
        reference_id: purchaseId,
        note: `${supplierName} bill ${billNo}`,
        created_by: actor.userId ?? null,
      });
    }
  }
};

/**
 * Adds lines to a bill already entered.
 *
 * Old paper bills get typed in piece by piece, as each piece is sold -- so the
 * second piece off bill 117 has to land on bill 117, not be refused as a
 * duplicate. The added lines post their own ledger entry against the same bill,
 * so voiding the bill still reverses everything it ever posted.
 */
const appendLines = async (
  trx: Knex.Transaction,
  bill: any,
  supplier: any,
  items: PurchaseLine[],
  actor: AuditActor,
) => {
  const addedGoods = money(items.reduce((s, i) => s + costOfLine(i), 0));
  const addedVat = money(items.reduce((s, i) => s + (i.vatAmount ?? 0), 0));
  const added = money(addedGoods + addedVat);

  await insertLines(trx, bill.id, supplier.name, bill.bill_no, items, actor);

  await trx("purchases").where({ id: bill.id }).update({
    subtotal: money(Number(bill.subtotal) + addedGoods),
    taxable_amount: money(Number(bill.taxable_amount) + addedGoods),
    vat_amount: money(Number(bill.vat_amount) + addedVat),
    total_amount: money(Number(bill.total_amount) + added),
  });

  await postPurchase(trx, {
    id: bill.id, bill_no: bill.bill_no, bill_date: localDate(bill.bill_date),
    taxable_amount: addedGoods, vat_amount: addedVat, tds_amount: 0, total_amount: added,
  }, actor);

  await writeAuditLog(trx, {
    ...actor,
    action: "update",
    entityType: "purchases",
    entityId: bill.id,
    oldValues: { total_amount: Number(bill.total_amount) },
    newValues: { total_amount: money(Number(bill.total_amount) + added), lines_added: items.length },
  });

  return bill.id as number;
};

export const listPurchases = async (filters: { supplierId?: number; from?: string; to?: string }) => {
  const query = db("purchases as p")
    .join("suppliers as s", "s.id", "p.supplier_id")
    .orderBy("p.bill_date", "desc")
    .orderBy("p.id", "desc")
    .select("p.*", "s.name as supplier_name");

  if (filters.supplierId) query.where("p.supplier_id", filters.supplierId);
  if (filters.from) query.where("p.bill_date", ">=", filters.from);
  if (filters.to) query.where("p.bill_date", "<=", filters.to);

  return (await query).map((r: any) => ({
    id: r.id,
    supplierName: r.supplier_name,
    billNo: r.bill_no,
    billDate: r.bill_date,
    billDateBs: r.bill_date_bs,
    totalAmount: Number(r.total_amount),
    paymentStatus: r.payment_status,
    isVoid: Boolean(r.is_void),
  }));
};

export interface UpdatePurchaseDetailsPayload {
  notes?: string | null;
  paymentStatus?: "unpaid" | "partial" | "paid";
  paymentMethod?: string | null;
}

/**
 * Changes the parts of a bill that carry no money: the note, and whether and
 * how the supplier has been paid. Anything that moves a figure -- a weight, a
 * rate, the bill number -- is corrected by voiding and entering it again, so
 * the stock, the piece costs and the books can never drift apart.
 */
export const updatePurchaseDetails = async (id: number, payload: UpdatePurchaseDetailsPayload, actor: AuditActor) => {
  const existing = await db("purchases").where({ id }).first();
  if (!existing) return null;
  if (existing.is_void) {
    throw Object.assign(new Error("This bill is voided and can no longer be changed"), { status: 409 });
  }

  const update: Record<string, unknown> = {};
  if (payload.notes !== undefined) update.notes = payload.notes?.trim() || null;
  if (payload.paymentStatus !== undefined) update.payment_status = payload.paymentStatus;
  if (payload.paymentMethod !== undefined) update.payment_method = payload.paymentMethod || null;
  if (Object.keys(update).length === 0) return getPurchase(id);

  await db.transaction(async (trx) => {
    await trx("purchases").where({ id }).update(update);
    await writeAuditLog(trx, {
      ...actor,
      action: "update",
      entityType: "purchases",
      entityId: id,
      oldValues: Object.fromEntries(Object.keys(update).map((k) => [k, existing[k]])),
      newValues: update,
    });
  });

  return getPurchase(id);
};

/**
 * Cancels a bill that was entered wrong, without removing it.
 *
 * In one transaction: the bill is marked void with its reason, every ledger
 * entry it posted is reversed, and each piece it put on the shelf is taken off
 * as a mis-entry with a matching outbound stock row.
 *
 * Refused if any of its pieces has moved on -- sold, reserved, damaged or lost
 * -- because that later event rests on this bill and has to be undone first.
 */
export const voidPurchase = async (id: number, reason: string, actor: AuditActor) => {
  const existing = await db("purchases").where({ id }).first();
  if (!existing) return null;
  if (existing.is_void) {
    throw Object.assign(new Error("This bill is already voided"), { status: 409 });
  }

  const pieces = await db("purchase_items as pi")
    .join("jewelries as j", "j.id", "pi.jewelry_id")
    .where("pi.purchase_id", id)
    .select("j.id", "j.name", "j.status", "j.cost_price");

  const blocked = (pieces as any[]).filter((p) => p.status !== "available" && p.status !== "voided");
  if (blocked.length > 0) {
    const list = blocked.map((p) => `${p.name} (${p.status})`).join(", ");
    throw Object.assign(
      new Error(
        `This bill can't be voided: ${list}. Undo that first -- a sold piece needs a credit note, ` +
          `a reserved one needs its order cancelled.`,
      ),
      { status: 409 },
    );
  }

  await db.transaction(async (trx) => {
    await trx("purchases").where({ id }).update({
      is_void: true,
      void_reason: reason,
      voided_by: actor.userId ?? null,
      voided_at: trx.fn.now(),
    });

    // Dated today, not on the bill date: the books record when the mistake was
    // put right, and the bill's own period may since have been closed.
    const today = localDate();
    await postReversal(
      trx,
      { referenceType: "purchase", referenceId: id },
      today,
      `Void of purchase bill ${existing.bill_no}`,
      actor,
    );

    for (const piece of pieces as any[]) {
      // Already taken off as a mis-entry on its own: its outbound row exists.
      if (piece.status === "voided") continue;
      await trx("jewelries").where({ id: piece.id }).update({ status: "voided" });
      await trx("inventory_transactions").insert({
        jewelry_id: piece.id,
        type: "adjustment",
        direction: "out",
        quantity: 1,
        cost_amount: piece.cost_price ?? null,
        reference_type: "purchase",
        reference_id: id,
        note: `Bill ${existing.bill_no} voided: ${reason}`,
        created_by: actor.userId ?? null,
      });
    }

    await writeAuditLog(trx, {
      ...actor,
      action: "void",
      entityType: "purchases",
      entityId: id,
      oldValues: { is_void: false },
      newValues: { is_void: true, void_reason: reason, pieces_removed: (pieces as any[]).map((p) => p.id) },
    });
  });

  return getPurchase(id);
};
