import type { Knex } from "knex";
import db, { unguardedDb } from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { assertFiscalYearOpen } from "../../utils/fiscalYear";
import { postReversal } from "../ledger/provider.posting";
import { getInvoice, insertInvoice } from "./provider.issue";
import { deleteOldSale } from "./provider.oldSale";
import { IssueInvoicePayload, InvoiceDTO } from "./interface/interface.invoices";

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * What a counter sale looked like when it was entered, in the shape the sale
 * form takes, so the form can be opened on it to put a mistake right.
 */
export const getSaleForEdit = async (id: number) => {
  const inv = await db("invoices").where({ id, is_old_bill: false }).first();
  if (!inv) return null;
  const items = await db("invoice_items as ii")
    .leftJoin("jewelries as j", "j.id", "ii.jewelry_id")
    .where("ii.invoice_id", id)
    .orderBy("ii.id")
    .select("ii.*", "j.category as piece_category");
  const customer = await db("customers").where({ id: inv.customer_id }).first("name", "phone", "address_line", "city");
  const paid = await db("payments").where({ invoice_id: id, status: "verified" }).sum({ s: "amount" }).first();
  return {
    id: Number(inv.id),
    invoiceNo: inv.invoice_no as string,
    date: String(inv.issued_at instanceof Date ? inv.issued_at.toISOString() : inv.issued_at).slice(0, 10),
    buyerName: (customer?.name as string) ?? inv.buyer_name,
    buyerPhone: (customer?.phone as string | null) ?? "",
    buyerAddress: [customer?.address_line, customer?.city].filter(Boolean).join(", "),
    paymentMethod: inv.payment_method as string,
    discount: Number(inv.discount),
    paid: money(Number(paid?.s ?? 0)),
    isVoid: Boolean(inv.is_void),
    items: items.map((i: any) => ({
      jewelryId: i.jewelry_id === null ? null : Number(i.jewelry_id),
      name: i.name_snapshot as string,
      category: (i.category_snapshot ?? i.piece_category ?? "other") as string,
      silverWeightGrams: Number(i.silver_weight_snapshot ?? 0),
      // The price charged, before the bill's discount -- never re-priced.
      unitPrice: Number(i.unit_price),
    })),
  };
};

/**
 * Takes a counter sale out of the books and puts its pieces back on the shelf.
 *
 * What it posted to the ledger is reversed rather than erased, and an audit row
 * keeps a full copy. Payments go with it (`keepPayments` false) or stay to be
 * attached to the corrected sale (an edit).
 *
 * Refused for a sale that came from an online order, one with a credit note, and
 * one in a closed fiscal year.
 */
const removeSale = async (trx: Knex.Transaction, id: number, actor: AuditActor, why: string, keepPayments: boolean) => {
  const inv = await trx("invoices").where({ id }).first();
  if (!inv) throw Object.assign(new Error("Invoice not found"), { status: 404 });
  if (inv.is_old_bill) throw Object.assign(new Error("This is a logged old bill"), { status: 409 });
  if (inv.order_id) {
    throw Object.assign(new Error("This sale settles an online order. Void it and issue a credit note instead."), { status: 409 });
  }
  if (keepPayments && inv.is_void) {
    throw Object.assign(new Error("This sale is void. Delete it instead of editing it."), { status: 409 });
  }
  await assertFiscalYearOpen(trx, inv.fiscal_year);

  const notes = await trx("credit_notes").where({ invoice_id: id }).first("id");
  if (notes) throw Object.assign(new Error("A credit note was issued against this sale, so it cannot be changed."), { status: 409 });

  const items = await trx("invoice_items").where({ invoice_id: id });
  const payments = await trx("payments").where({ invoice_id: id });
  const today = new Date().toISOString().slice(0, 10);
  const narration = `${why} sale ${inv.invoice_no}`;

  if (!keepPayments) {
    for (const p of payments as any[]) {
      await postReversal(trx, { referenceType: "payment", referenceId: Number(p.id) }, today, narration, actor);
    }
  }
  // A void already reversed the sale and put the pieces back.
  if (!inv.is_void) {
    await postReversal(trx, { referenceType: "invoice", referenceId: id }, today, narration, actor);
  }

  const pieceIds = items.map((i: any) => i.jewelry_id).filter((v: number | null) => v !== null);
  if (pieceIds.length > 0 && !inv.is_void) {
    // Only those still marked sold: one already resold elsewhere is left alone.
    await trx("jewelries").whereIn("id", pieceIds).where({ status: "sold" }).update({ status: "available" });
  }
  await trx("inventory_transactions").where({ reference_type: "invoice", reference_id: id }).del();
  await trx("invoice_items").where({ invoice_id: id }).del();
  if (keepPayments) {
    // A payment must always belong to an invoice, so the old row stays, under a
    // number nobody will meet, until the corrected sale takes the payments over.
    await trx("invoices").where({ id }).update({ invoice_no: `~replaced-${id}` });
  } else {
    await trx("payments").where({ invoice_id: id }).del();
    await trx("invoices").where({ id }).del();
  }

  await writeAuditLog(trx, {
    ...actor,
    action: "void",
    entityType: "invoices",
    entityId: id,
    oldValues: { removed_sale: true, invoice: inv, items, payments },
    newValues: { reason: why },
  });

  return { inv, payments };
};

/** Deletes a counter sale. An old bill is handed to its own routine. */
export const deleteInvoice = async (id: number, actor: AuditActor): Promise<boolean> => {
  const row = await db("invoices").where({ id }).first("id", "is_old_bill");
  if (!row) return false;
  if (row.is_old_bill) return deleteOldSale(id, actor);
  await unguardedDb.transaction((trx) => removeSale(trx, id, actor, "Deleted", false));
  return true;
};

/**
 * Corrects a counter sale: the old version is taken out and the corrected one
 * put in, in one transaction. It keeps its invoice number, and the money
 * already taken stays against it -- refused if that is more than the new total.
 */
export const updateInvoice = async (
  id: number,
  payload: IssueInvoicePayload,
  actor: AuditActor,
): Promise<InvoiceDTO | null> => {
  const row = await db("invoices").where({ id }).first("id", "is_old_bill");
  if (!row) return null;
  if (row.is_old_bill) throw Object.assign(new Error("Edit a logged old bill from its own form"), { status: 409 });

  const newId = await unguardedDb.transaction(async (trx) => {
    const { inv, payments } = await removeSale(trx, id, actor, "Replaced", true);
    const created = await insertInvoice(trx, { ...payload, orderId: null }, actor, {
      invoiceNo: inv.invoice_no,
      fiscalYear: inv.fiscal_year,
    });

    if (payments.length > 0) {
      const taken = money((payments as any[]).reduce((s, p) => s + Number(p.amount), 0));
      const fresh = await trx("invoices").where({ id: created }).first("total_amount");
      if (taken > Number(fresh.total_amount)) {
        throw Object.assign(
          new Error(`${taken} has already been taken on this sale, which is more than the corrected total of ${Number(fresh.total_amount)}. Refund the difference first.`),
          { status: 409 },
        );
      }
      // Their ledger entries stand; the payments just follow the sale.
      await trx("payments").whereIn("id", (payments as any[]).map((p) => p.id)).update({ invoice_id: created });
    }
    await trx("invoices").where({ id }).del();
    return created;
  });

  return getInvoice(newId);
};
