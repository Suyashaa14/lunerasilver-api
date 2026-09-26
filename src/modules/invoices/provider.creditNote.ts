import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { stampForDate } from "../../utils/fiscalYear";
import { allocateNumber } from "../../services/numbering/service.numbering";
import { refundPayment, getInvoiceBalance } from "../payments/provider.payments";
import { postCreditNote } from "../ledger/provider.posting";

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * A timestamp for a document dated `dateOnly` (YYYY-MM-DD).
 *
 * Today's documents get the actual current instant. Back-dated ones get the
 * start of that day. Never a locally-formatted time string: the connection runs
 * in UTC, so a local clock reading would be stored as though it were UTC and
 * land the document hours in the future.
 */
const timestampFor = (dateOnly: string): Date | string => {
  if (dateOnly !== new Date().toISOString().slice(0, 10)) return `${dateOnly} 00:00:00`;

  // Milliseconds are dropped deliberately. The column holds whole seconds and
  // MySQL *rounds* fractional ones rather than truncating, so a document saved
  // at .900 would be stored a second into the future -- enough for an "as at
  // now" report to skip it, intermittently and only sometimes.
  const now = new Date();
  now.setMilliseconds(0);
  return now;
};


export interface CreditNoteLine {
  invoiceItemId: number;
  /** Defaults to the whole line. */
  amount?: number;
}

export interface IssueCreditNotePayload {
  invoiceId: number;
  reason: string;
  issuedAt?: string;
  /** Omit to credit the whole invoice. */
  items?: CreditNoteLine[];
  /** Cash actually handed back, if any. */
  refund?: { amount: number; method: "cash" | "esewa_qr" | "bank_transfer" | "card" };
}

export const getCreditNote = async (id: number) => {
  const note = await db("credit_notes").where({ id }).first();
  if (!note) return null;
  const items = await db("credit_note_items").where({ credit_note_id: id }).orderBy("id");

  return {
    id: note.id,
    creditNoteNo: note.credit_note_no,
    fiscalYear: note.fiscal_year,
    invoiceId: Number(note.invoice_id),
    customerId: Number(note.customer_id),
    reason: note.reason,
    issuedAt: note.issued_at,
    issuedDateBs: note.issued_date_bs,
    subtotal: Number(note.subtotal),
    taxableAmount: Number(note.taxable_amount),
    vatAmount: Number(note.vat_amount),
    totalAmount: Number(note.total_amount),
    items: items.map((i: any) => ({
      id: i.id,
      invoiceItemId: Number(i.invoice_item_id),
      description: i.description,
      quantity: Number(i.quantity),
      amount: Number(i.amount),
      vatAmount: Number(i.vat_amount),
    })),
  };
};

/**
 * Reverses a sale the proper way.
 *
 * The original invoice is never touched. A credit note is its own numbered
 * document saying "this much of that invoice is being given back", which is
 * what a tax office expects once the customer has the paper or the figure has
 * been reported.
 *
 * In one transaction: number the note, write its lines, put the pieces back on
 * the shelf, hand back any cash as a negative payment, and -- only when the
 * whole invoice is credited -- mark the invoice void so it stops counting.
 */
export const issueCreditNote = async (payload: IssueCreditNotePayload, actor: AuditActor) => {
  const noteId = await db.transaction(async (trx) => {
    const invoice = await trx("invoices").where({ id: payload.invoiceId }).first();
    if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
    if (invoice.is_void) {
      throw Object.assign(new Error("This invoice is already void; there is nothing to credit"), { status: 409 });
    }

    const invoiceItems = await trx("invoice_items").where({ invoice_id: payload.invoiceId }).orderBy("id");

    // No lines given means credit the whole invoice.
    const requested: CreditNoteLine[] =
      payload.items && payload.items.length > 0
        ? payload.items
        : invoiceItems.map((i: any) => ({ invoiceItemId: i.id }));

    const byId = new Map(invoiceItems.map((i: any) => [Number(i.id), i]));
    const alreadyCredited = await trx("credit_note_items")
      .join("credit_notes", "credit_notes.id", "credit_note_items.credit_note_id")
      .where("credit_notes.invoice_id", payload.invoiceId)
      .select("credit_note_items.invoice_item_id", "credit_note_items.amount");

    const creditedSoFar = new Map<number, number>();
    for (const row of alreadyCredited as any[]) {
      const key = Number(row.invoice_item_id);
      creditedSoFar.set(key, (creditedSoFar.get(key) ?? 0) + Number(row.amount));
    }

    const lines = requested.map((line) => {
      const item = byId.get(line.invoiceItemId);
      if (!item) {
        throw Object.assign(new Error(`Line ${line.invoiceItemId} is not on this invoice`), { status: 400 });
      }

      const lineTotal = Number(item.line_total);
      const already = creditedSoFar.get(Number(item.id)) ?? 0;
      const amount = money(line.amount ?? lineTotal - already);

      if (amount <= 0) throw Object.assign(new Error(`${item.name_snapshot} is already fully credited`), { status: 409 });
      if (amount + already > lineTotal) {
        throw Object.assign(
          new Error(`Cannot credit ${amount} against ${item.name_snapshot}; only ${money(lineTotal - already)} remains`),
          { status: 400 },
        );
      }

      const vatShare = lineTotal > 0 ? money(Number(item.vat_amount) * (amount / lineTotal)) : 0;
      return { item, amount, vatShare, fullyCredited: money(amount + already) >= lineTotal };
    });

    const issuedAt = payload.issuedAt ?? new Date().toISOString().slice(0, 10);
    const { fiscalYear, bsDate } = await stampForDate(trx, issuedAt);
    const creditNoteNo = await allocateNumber(trx, fiscalYear, "CN");

    const subtotal = money(lines.reduce((s, l) => s + l.amount, 0));
    const vatAmount = money(lines.reduce((s, l) => s + l.vatShare, 0));

    const [newNoteId] = await trx("credit_notes").insert({
      credit_note_no: creditNoteNo,
      fiscal_year: fiscalYear,
      invoice_id: payload.invoiceId,
      customer_id: invoice.customer_id,
      reason: payload.reason,
      issued_at: timestampFor(issuedAt),
      issued_date_bs: bsDate,
      subtotal,
      discount: 0,
      taxable_amount: subtotal,
      vat_amount: vatAmount,
      total_amount: money(subtotal + vatAmount),
      created_by: actor.userId ?? null,
    });

    await trx("credit_note_items").insert(
      lines.map((l) => ({
        credit_note_id: newNoteId,
        invoice_item_id: l.item.id,
        description: l.item.name_snapshot,
        quantity: 1,
        amount: l.amount,
        vat_amount: l.vatShare,
      })),
    );

    // Only a fully credited line brings its piece back; a part credit is a
    // price adjustment, and the customer still has the ring.
    const returnedPieces = lines
      .filter((l) => l.fullyCredited && l.item.jewelry_id !== null)
      .map((l) => Number(l.item.jewelry_id));

    if (returnedPieces.length > 0) {
      await trx("jewelries").whereIn("id", returnedPieces).where({ status: "sold" }).update({ status: "available" });
      await trx("inventory_transactions").insert(
        returnedPieces.map((jewelryId) => ({
          jewelry_id: jewelryId,
          type: "return",
          direction: "in",
          quantity: 1,
          reference_type: "credit_note",
          reference_id: newNoteId,
          note: `${creditNoteNo}: ${payload.reason}`,
          created_by: actor.userId ?? null,
        })),
      );
    }

    // The invoice only goes void once every line has been credited in full.
    const allLines = invoiceItems.map((i: any) => Number(i.id));
    const creditedNow = new Map(creditedSoFar);
    for (const l of lines) creditedNow.set(Number(l.item.id), (creditedSoFar.get(Number(l.item.id)) ?? 0) + l.amount);
    const wholeInvoiceCredited = allLines.every(
      (lineId) => (creditedNow.get(lineId) ?? 0) >= Number(byId.get(lineId).line_total),
    );

    if (wholeInvoiceCredited) {
      await trx("invoices").where({ id: payload.invoiceId }).update({
        is_void: true,
        void_reason: `Fully credited by ${creditNoteNo}: ${payload.reason}`,
        voided_by: actor.userId ?? null,
        voided_at: trx.fn.now(),
      });
    }

    const restockedCost = returnedPieces.length
      ? (await trx("jewelries").whereIn("id", returnedPieces).select("cost_price"))
          .reduce((sum: number, r: any) => sum + Number(r.cost_price ?? 0), 0)
      : 0;

    await postCreditNote(trx, {
      id: newNoteId, credit_note_no: creditNoteNo, issued_at: issuedAt,
      taxable_amount: subtotal, vat_amount: vatAmount, total_amount: money(subtotal + vatAmount),
    }, restockedCost, actor);

    await writeAuditLog(trx, {
      ...actor,
      action: "create",
      entityType: "credit_notes",
      entityId: newNoteId,
      newValues: { credit_note_no: creditNoteNo, invoice_id: payload.invoiceId, total_amount: money(subtotal + vatAmount) },
    });

    return newNoteId;
  });

  // Cash actually handed back is its own negative payment row, outside the
  // document itself -- the note records what is owed, the payment records what moved.
  if (payload.refund && payload.refund.amount > 0) {
    await refundPayment(
      {
        invoiceId: payload.invoiceId,
        amount: payload.refund.amount,
        method: payload.refund.method,
        reason: `Credit note refund: ${payload.reason}`,
      },
      actor,
    );
  }

  return getCreditNote(noteId);
};

export { getInvoiceBalance };
