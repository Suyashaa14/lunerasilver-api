import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { stampForDate } from "../../utils/fiscalYear";

const money = (n: number) => Math.round(n * 100) / 100;

export interface PurchaseLine {
  description: string;
  material?: string;
  weightGrams?: number;
  ratePerGram?: number;
  unitCost: number;
  vatAmount?: number;
  /** Book this line into stock as a sellable piece. */
  stockIn?: {
    name: string;
    category: string;
    sku?: string;
    material?: string;
    purity?: string;
    silverWeightGrams: number;
    makingCharge: number;
    stoneWeightGrams?: number | null;
    stonePrice?: number | null;
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
    notes: purchase.notes,
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

    // Unique per (supplier, bill_no) in the schema. Caught here so the message
    // explains itself rather than surfacing a constraint error.
    const duplicate = await trx("purchases")
      .where({ supplier_id: payload.supplierId, bill_no: payload.billNo })
      .first("id");
    if (duplicate) {
      throw Object.assign(
        new Error(`Bill ${payload.billNo} from ${supplier.name} is already entered`),
        { status: 409 },
      );
    }

    const { fiscalYear, bsDate } = await stampForDate(trx, payload.billDate);

    const subtotal = money(payload.items.reduce((s, i) => s + i.unitCost, 0));
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

    for (const line of payload.items) {
      const lineTotal = money(line.unitCost - 0 + (line.vatAmount ?? 0));

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
          // The landed cost. This is what every later margin is measured against.
          cost_price: money(line.unitCost),
          status: "available",
        });
        jewelryId = pieceId as number;
      }

      const [lineId] = await trx("purchase_items").insert({
        purchase_id: newId,
        jewelry_id: jewelryId,
        description: line.description,
        material: line.material ?? null,
        weight_grams: line.weightGrams ?? null,
        rate_per_gram: line.ratePerGram ?? null,
        quantity: 1,
        unit_cost: money(line.unitCost),
        taxable_amount: money(line.unitCost),
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
          cost_amount: money(line.unitCost),
          reference_type: "purchase",
          reference_id: newId,
          note: `${supplier.name} bill ${payload.billNo}`,
          created_by: actor.userId ?? null,
        });
      }
    }

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
  }));
};
