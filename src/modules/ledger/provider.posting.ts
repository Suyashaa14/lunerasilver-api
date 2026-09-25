import type { Knex } from "knex";
import { AuditActor } from "../../utils/audit";
import { postEntry } from "./provider.ledger";

const money = (n: number) => Math.round(n * 100) / 100;

/** Which asset account money of each kind lands in. */
const CASH_ACCOUNT: Record<string, string> = {
  cash: "1000",
  cod: "1000",
  esewa_qr: "1020",
  bank_transfer: "1010",
  card: "1010",
};

export const ACCOUNTS = {
  cash: "1000",
  receivable: "1100",
  inventory: "1200",
  vatReceivable: "1300",
  payable: "2000",
  vatPayable: "2100",
  tdsPayable: "2200",
  sales: "4000",
  cogs: "5000",
  operatingExpense: "6000",
};

/**
 * A sale: the customer owes us the total, we have earned the net, and any VAT
 * belongs to the tax office rather than to us.
 *
 *   Dr Accounts receivable   total
 *     Cr Sales                        net of VAT
 *     Cr VAT payable                  VAT
 *
 * Cost of goods is posted at the same moment, because the margin only makes
 * sense if the cost leaves inventory in the same period the sale is recognised.
 *
 *   Dr Cost of goods sold    cost
 *     Cr Inventory                    cost
 */
export const postInvoice = async (
  trx: Knex.Transaction,
  invoice: { id: number; invoice_no: string; issued_at: string; taxable_amount: number; vat_amount: number; total_amount: number },
  costOfGoods: number,
  actor: AuditActor,
) => {
  const date = String(invoice.issued_at).slice(0, 10);

  await postEntry(trx, {
    date,
    narration: `Sale ${invoice.invoice_no}`,
    referenceType: "invoice",
    referenceId: invoice.id,
    lines: [
      { account: ACCOUNTS.receivable, debit: Number(invoice.total_amount) },
      { account: ACCOUNTS.sales, credit: Number(invoice.taxable_amount) },
      { account: ACCOUNTS.vatPayable, credit: Number(invoice.vat_amount) },
    ],
  }, actor);

  if (costOfGoods > 0) {
    await postEntry(trx, {
      date,
      narration: `Cost of goods on ${invoice.invoice_no}`,
      referenceType: "invoice",
      referenceId: invoice.id,
      lines: [
        { account: ACCOUNTS.cogs, debit: money(costOfGoods) },
        { account: ACCOUNTS.inventory, credit: money(costOfGoods) },
      ],
    }, actor);
  }
};

/**
 * Money arriving clears what the customer owed. A refund is the same entry the
 * other way round, which is why a negative amount needs no special case.
 */
export const postPayment = async (
  trx: Knex.Transaction,
  payment: { id: number; amount: number; method: string; received_at: string; invoice_id: number | null },
  actor: AuditActor,
) => {
  const amount = Number(payment.amount);
  const account = CASH_ACCOUNT[payment.method] ?? ACCOUNTS.cash;
  const date = String(payment.received_at).slice(0, 10);
  const inbound = amount >= 0;
  const value = Math.abs(amount);

  await postEntry(trx, {
    date,
    narration: inbound ? `Payment received` : `Refund paid`,
    referenceType: "payment",
    referenceId: payment.id,
    lines: inbound
      ? [
          { account, debit: value },
          { account: ACCOUNTS.receivable, credit: value },
        ]
      : [
          { account: ACCOUNTS.receivable, debit: value },
          { account, credit: value },
        ],
  }, actor);
};

/**
 * A credit note is a sale in reverse: the income comes back off, the VAT is no
 * longer owed to the tax office, and the customer stops owing us.
 */
export const postCreditNote = async (
  trx: Knex.Transaction,
  note: { id: number; credit_note_no: string; issued_at: string; taxable_amount: number; vat_amount: number; total_amount: number },
  restockedCost: number,
  actor: AuditActor,
) => {
  const date = String(note.issued_at).slice(0, 10);

  await postEntry(trx, {
    date,
    narration: `Credit note ${note.credit_note_no}`,
    referenceType: "credit_note",
    referenceId: note.id,
    lines: [
      { account: ACCOUNTS.sales, debit: Number(note.taxable_amount) },
      { account: ACCOUNTS.vatPayable, debit: Number(note.vat_amount) },
      { account: ACCOUNTS.receivable, credit: Number(note.total_amount) },
    ],
  }, actor);

  if (restockedCost > 0) {
    await postEntry(trx, {
      date,
      narration: `Stock returned on ${note.credit_note_no}`,
      referenceType: "credit_note",
      referenceId: note.id,
      lines: [
        { account: ACCOUNTS.inventory, debit: money(restockedCost) },
        { account: ACCOUNTS.cogs, credit: money(restockedCost) },
      ],
    }, actor);
  }
};

/**
 * A supplier bill: stock comes in, VAT paid on it is reclaimable, and the
 * supplier is owed the balance after any tax withheld.
 */
export const postPurchase = async (
  trx: Knex.Transaction,
  purchase: { id: number; bill_no: string; bill_date: string; taxable_amount: number; vat_amount: number; tds_amount: number; total_amount: number },
  actor: AuditActor,
) => {
  await postEntry(trx, {
    date: String(purchase.bill_date).slice(0, 10),
    narration: `Purchase bill ${purchase.bill_no}`,
    referenceType: "purchase",
    referenceId: purchase.id,
    lines: [
      { account: ACCOUNTS.inventory, debit: Number(purchase.taxable_amount) },
      { account: ACCOUNTS.vatReceivable, debit: Number(purchase.vat_amount) },
      { account: ACCOUNTS.payable, credit: Number(purchase.total_amount) },
      { account: ACCOUNTS.tdsPayable, credit: Number(purchase.tds_amount) },
    ],
  }, actor);
};

/** An overhead paid out: the expense is recognised and the cash leaves. */
export const postExpense = async (
  trx: Knex.Transaction,
  expense: { id: number; expense_no: string; spent_at: string; taxable_amount: number; vat_amount: number; amount: number; payment_method: string | null },
  actor: AuditActor,
) => {
  const account = expense.payment_method ? CASH_ACCOUNT[expense.payment_method] ?? ACCOUNTS.cash : ACCOUNTS.cash;

  await postEntry(trx, {
    date: String(expense.spent_at).slice(0, 10),
    narration: `Expense ${expense.expense_no}`,
    referenceType: "expense",
    referenceId: expense.id,
    lines: [
      { account: ACCOUNTS.operatingExpense, debit: Number(expense.taxable_amount) },
      { account: ACCOUNTS.vatReceivable, debit: Number(expense.vat_amount) },
      { account, credit: Number(expense.amount) },
    ],
  }, actor);
};

/** Cancelling a document reverses whatever it posted, rather than deleting it. */
export const postReversal = async (
  trx: Knex.Transaction,
  original: { referenceType: string; referenceId: number },
  date: string,
  narration: string,
  actor: AuditActor,
) => {
  const entries = await trx("journal_entries")
    .where({ reference_type: original.referenceType, reference_id: original.referenceId })
    .select("id");

  for (const entry of entries as any[]) {
    const lines = await trx("journal_entry_lines as l")
      .join("accounts as a", "a.id", "l.account_id")
      .where("l.journal_entry_id", entry.id)
      .select("a.code", "l.debit", "l.credit");

    await postEntry(trx, {
      date,
      narration,
      referenceType: `${original.referenceType}_reversal`,
      referenceId: original.referenceId,
      // Sides swapped: the reversal cancels the original exactly.
      lines: (lines as any[]).map((l) => ({
        account: l.code,
        debit: Number(l.credit),
        credit: Number(l.debit),
      })),
    }, actor);
  }
};
