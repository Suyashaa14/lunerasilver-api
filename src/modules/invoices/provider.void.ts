import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { assertFiscalYearOpen } from "../../utils/fiscalYear";
import { postReversal } from "../ledger/provider.posting";
import { getInvoice } from "./provider.issue";
import { InvoiceDTO } from "./interface/interface.invoices";

/**
 * Cancels an invoice that should not have been issued.
 *
 * The row is never edited or removed -- its number stays used, so the sequence
 * keeps no holes -- it is simply marked void and stops counting as revenue.
 * The pieces go back on the shelf with an inbound stock row, because the sale
 * did not happen.
 *
 * This is for an invoice issued in error. Once a document has reached the buyer
 * or the figure has been reported to the tax office, the correction is a credit
 * note (Step 1.5), which leaves the original standing.
 */
export const voidInvoice = async (
  id: number,
  reason: string,
  actor: AuditActor,
): Promise<InvoiceDTO | null> => {
  const existing = await db("invoices").where({ id }).first();
  if (!existing) return null;

  if (existing.is_void) {
    throw Object.assign(new Error("This invoice is already void"), { status: 409 });
  }

  await db.transaction(async (trx) => {
    // A signed-off period cannot be reopened by cancelling one of its documents.
    await assertFiscalYearOpen(trx, existing.fiscal_year);

    await trx("invoices").where({ id }).update({
      is_void: true,
      void_reason: reason,
      voided_by: actor.userId ?? null,
      voided_at: trx.fn.now(),
    });

    const lines = await trx("invoice_items").where({ invoice_id: id }).select("jewelry_id");
    const pieceIds = lines.map((l: any) => l.jewelry_id).filter((v: number | null) => v !== null);

    if (pieceIds.length > 0) {
      // Only pieces still marked sold by this invoice go back. One already
      // resold on a later document must not be pulled out from under it.
      await trx("jewelries").whereIn("id", pieceIds).where({ status: "sold" }).update({ status: "available" });

      await trx("inventory_transactions").insert(
        pieceIds.map((jewelryId: number) => ({
          jewelry_id: jewelryId,
          type: "return",
          direction: "in",
          quantity: 1,
          reference_type: "invoice",
          reference_id: id,
          note: `Invoice ${existing.invoice_no} voided: ${reason}`,
          created_by: actor.userId ?? null,
        })),
      );
    }

    // The sale did not happen, so its posting is reversed rather than removed.
    await postReversal(
      trx,
      { referenceType: "invoice", referenceId: id },
      new Date().toISOString().slice(0, 10),
      `Void of ${existing.invoice_no}: ${reason}`,
      actor,
    );

    await writeAuditLog(trx, {
      ...actor,
      action: "void",
      entityType: "invoices",
      entityId: id,
      oldValues: { is_void: false, total_amount: existing.total_amount },
      newValues: { is_void: true, void_reason: reason },
    });
  });

  return getInvoice(id);
};

/**
 * Counts a print. The first is the original; every later one is a copy, which
 * is why the count is kept rather than discarded.
 */
export const recordPrint = async (id: number, actor: AuditActor): Promise<InvoiceDTO | null> => {
  const existing = await db("invoices").where({ id }).first();
  if (!existing) return null;

  await db.transaction(async (trx) => {
    await trx("invoices").where({ id }).increment("print_count", 1);
    await writeAuditLog(trx, {
      ...actor,
      action: "update",
      entityType: "invoices",
      entityId: id,
      oldValues: { print_count: Number(existing.print_count) },
      newValues: { print_count: Number(existing.print_count) + 1 },
    });
  });

  return getInvoice(id);
};
