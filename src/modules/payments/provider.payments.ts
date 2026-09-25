import type { Knex } from "knex";
import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { stampForDate } from "../../utils/fiscalYear";
import { postPayment } from "../ledger/provider.posting";
import {
  RecordPaymentPayload,
  RefundPaymentPayload,
  PaymentDTO,
  InvoiceBalance,
} from "./interface/interface.payments";

const money = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const toDTO = (row: any): PaymentDTO => ({
  id: row.id,
  invoiceId: num(row.invoice_id),
  orderId: num(row.order_id),
  amount: Number(row.amount),
  method: row.method,
  referenceNo: row.reference_no,
  status: row.status,
  receivedAt: row.received_at,
  receivedDateBs: row.received_date_bs,
  fiscalYear: row.fiscal_year,
  verifiedBy: num(row.verified_by),
  verifiedAt: row.verified_at,
  note: row.note,
});

/**
 * Cash is verified as it is recorded -- the note is in the till, there is
 * nothing left to check. Everything else has to be matched against a bank or
 * wallet statement first, so it starts pending.
 */
const initialStatus = (method: RecordPaymentPayload["method"]) => (method === "cash" ? "verified" : "pending");

/**
 * What an invoice still owes.
 *
 * Only verified money counts as paid. Pending is reported separately so the
 * counter can see "the customer says they sent it" without it being treated as
 * settled. Refunds are negative rows, so they simply reduce the sum.
 */
export const getInvoiceBalance = async (
  conn: Knex | Knex.Transaction,
  invoiceId: number,
): Promise<InvoiceBalance | null> => {
  const invoice = await conn("invoices").where({ id: invoiceId }).first("id", "total_amount", "is_void");
  if (!invoice) return null;

  const rows = await conn("payments").where({ invoice_id: invoiceId }).select("amount", "status");
  const sumOf = (status: string) =>
    money(rows.filter((r: any) => r.status === status).reduce((s: number, r: any) => s + Number(r.amount), 0));

  const total = invoice.is_void ? 0 : Number(invoice.total_amount);
  const paid = sumOf("verified");

  return {
    invoiceId,
    total,
    paid,
    pending: sumOf("pending"),
    outstanding: money(total - paid),
    isSettled: money(total - paid) <= 0,
  };
};

/**
 * orders.payment_status is a cache of these rows, never set by hand -- so it is
 * recomputed on every payment write rather than being told what to say.
 */
export const recomputeOrderPaymentStatus = async (trx: Knex.Transaction, orderId: number): Promise<void> => {
  const order = await trx("orders").where({ id: orderId }).first("id", "total_amount");
  if (!order) return;

  const rows = await trx("payments").where({ order_id: orderId }).select("amount", "status");
  const verified = money(rows.filter((r: any) => r.status === "verified").reduce((s: number, r: any) => s + Number(r.amount), 0));
  const hasPending = rows.some((r: any) => r.status === "pending");

  const status = verified >= Number(order.total_amount) ? "paid" : hasPending ? "awaiting_verification" : "unpaid";
  await trx("orders").where({ id: orderId }).update({ payment_status: status });
};

const assertHasParent = (payload: { invoiceId?: number | null; orderId?: number | null }) => {
  if (!payload.invoiceId && !payload.orderId) {
    throw Object.assign(new Error("A payment must belong to an invoice or an order"), { status: 400 });
  }
};

export const recordPayment = async (payload: RecordPaymentPayload, actor: AuditActor): Promise<PaymentDTO> => {
  assertHasParent(payload);
  if (payload.amount <= 0) {
    throw Object.assign(new Error("Use a refund to record money going back out"), { status: 400 });
  }

  const id = await db.transaction(async (trx) => {
    const receivedAt = payload.receivedAt ?? new Date().toISOString().slice(0, 10);
    const { fiscalYear, bsDate } = await stampForDate(trx, receivedAt);

    if (payload.invoiceId) {
      const invoice = await trx("invoices").where({ id: payload.invoiceId }).first("id", "is_void", "total_amount");
      if (!invoice) throw Object.assign(new Error("Invoice not found"), { status: 404 });
      if (invoice.is_void) {
        throw Object.assign(new Error("This invoice is void and cannot take a payment"), { status: 409 });
      }

      // Spec §6: verified payments must not exceed the invoice unless a refund
      // has been issued. Overpayment is nearly always a keying mistake.
      const balance = await getInvoiceBalance(trx, payload.invoiceId);
      if (balance && payload.amount > balance.outstanding) {
        throw Object.assign(
          new Error(`That is more than the ${balance.outstanding} still outstanding on this invoice`),
          { status: 400 },
        );
      }
    }

    const [newId] = await trx("payments").insert({
      invoice_id: payload.invoiceId ?? null,
      order_id: payload.orderId ?? null,
      amount: money(payload.amount),
      method: payload.method,
      reference_no: payload.referenceNo ?? null,
      status: initialStatus(payload.method),
      received_at: receivedAt,
      received_date_bs: bsDate,
      fiscal_year: fiscalYear,
      verified_by: initialStatus(payload.method) === "verified" ? actor.userId ?? null : null,
      verified_at: initialStatus(payload.method) === "verified" ? trx.fn.now() : null,
      note: payload.note ?? null,
    });

    if (payload.orderId) await recomputeOrderPaymentStatus(trx, payload.orderId);

    // Only money against an invoice touches receivables; a deposit on an order
    // has no receivable to clear yet.
    if (payload.invoiceId) {
      await postPayment(trx, {
        id: newId, amount: money(payload.amount), method: payload.method,
        received_at: receivedAt, invoice_id: payload.invoiceId,
      }, actor);
    }

    await writeAuditLog(trx, {
      ...actor,
      action: "create",
      entityType: "payments",
      entityId: newId,
      newValues: { amount: money(payload.amount), method: payload.method, invoice_id: payload.invoiceId ?? null },
    });

    return newId;
  });

  return toDTO(await db("payments").where({ id }).first());
};

/** Money going back out. A negative row, never a deleted one. */
export const refundPayment = async (payload: RefundPaymentPayload, actor: AuditActor): Promise<PaymentDTO> => {
  assertHasParent(payload);
  if (payload.amount <= 0) {
    throw Object.assign(new Error("A refund amount must be positive"), { status: 400 });
  }

  const id = await db.transaction(async (trx) => {
    const receivedAt = payload.receivedAt ?? new Date().toISOString().slice(0, 10);
    const { fiscalYear, bsDate } = await stampForDate(trx, receivedAt);

    if (payload.invoiceId) {
      const balance = await getInvoiceBalance(trx, payload.invoiceId);
      if (!balance) throw Object.assign(new Error("Invoice not found"), { status: 404 });
      if (payload.amount > balance.paid) {
        throw Object.assign(
          new Error(`Cannot refund ${payload.amount}; only ${balance.paid} was taken`),
          { status: 400 },
        );
      }
    }

    const [newId] = await trx("payments").insert({
      invoice_id: payload.invoiceId ?? null,
      order_id: payload.orderId ?? null,
      amount: money(-payload.amount),
      method: payload.method,
      status: "verified",
      received_at: receivedAt,
      received_date_bs: bsDate,
      fiscal_year: fiscalYear,
      verified_by: actor.userId ?? null,
      verified_at: trx.fn.now(),
      note: payload.reason,
    });

    if (payload.orderId) await recomputeOrderPaymentStatus(trx, payload.orderId);

    if (payload.invoiceId) {
      await postPayment(trx, {
        id: newId, amount: money(-payload.amount), method: payload.method,
        received_at: receivedAt, invoice_id: payload.invoiceId,
      }, actor);
    }

    await writeAuditLog(trx, {
      ...actor,
      action: "create",
      entityType: "payments",
      entityId: newId,
      newValues: { amount: money(-payload.amount), reason: payload.reason },
    });

    return newId;
  });

  return toDTO(await db("payments").where({ id }).first());
};

const setStatus = async (
  id: number,
  status: "verified" | "rejected",
  actor: AuditActor,
  note?: string,
): Promise<PaymentDTO | null> => {
  const existing = await db("payments").where({ id }).first();
  if (!existing) return null;
  if (existing.status === status) {
    throw Object.assign(new Error(`This payment is already ${status}`), { status: 409 });
  }

  await db.transaction(async (trx) => {
    await trx("payments").where({ id }).update({
      status,
      verified_by: actor.userId ?? null,
      verified_at: trx.fn.now(),
      note: note ?? existing.note,
    });

    if (existing.order_id) await recomputeOrderPaymentStatus(trx, existing.order_id);

    await writeAuditLog(trx, {
      ...actor,
      action: "update",
      entityType: "payments",
      entityId: id,
      oldValues: { status: existing.status },
      newValues: { status },
    });
  });

  return toDTO(await db("payments").where({ id }).first());
};

export const verifyPayment = (id: number, actor: AuditActor) => setStatus(id, "verified", actor);
export const rejectPayment = (id: number, actor: AuditActor, reason: string) =>
  setStatus(id, "rejected", actor, reason);

export const listPayments = async (filters: { invoiceId?: number; orderId?: number }) => {
  const query = db("payments").orderBy("id", "desc");
  if (filters.invoiceId) query.where({ invoice_id: filters.invoiceId });
  if (filters.orderId) query.where({ order_id: filters.orderId });
  return (await query).map(toDTO);
};
