import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import db, { unguardedDb } from "../../utils/db";
import { issueInvoice } from "../invoices/provider.issue";
import { issueCreditNote } from "../invoices/provider.creditNote";
import { recordPayment, refundPayment, verifyPayment, getInvoiceBalance } from "./provider.payments";

const MARK = "__pay_test__";
import { actor, resolveActor } from "../../utils/testActor";
let jewelryId = 0;

const wipe = async () => {
  const invIds = (await unguardedDb("invoices").where("buyer_name", "like", `${MARK}%`).select("id")).map((r: any) => r.id);
  const cnIds = invIds.length ? (await unguardedDb("credit_notes").whereIn("invoice_id", invIds).select("id")).map((r: any) => r.id) : [];
  if (cnIds.length) {
    await unguardedDb("credit_note_items").whereIn("credit_note_id", cnIds).del();
    await unguardedDb("inventory_transactions").where({ reference_type: "credit_note" }).whereIn("reference_id", cnIds).del();
    await unguardedDb("credit_notes").whereIn("id", cnIds).del();
  }
  if (invIds.length) {
    await unguardedDb("payments").whereIn("invoice_id", invIds).del();
    await unguardedDb("inventory_transactions").where({ reference_type: "invoice" }).whereIn("reference_id", invIds).del();
    await unguardedDb("invoice_items").whereIn("invoice_id", invIds).del();
    await unguardedDb("invoices").whereIn("id", invIds).del();
  }
  await unguardedDb("customers").where("name", "like", `${MARK}%`).del();
  await unguardedDb("inventory_transactions").where("jewelry_id", "in",
    unguardedDb("jewelries").where("sku", "like", `${MARK}%`).select("id")).del();
  await unguardedDb("jewelries").where("sku", "like", `${MARK}%`).del();
  await unguardedDb("audit_logs").del();

};

before(async () => {
  await resolveActor();
  await wipe();
});
beforeEach(async () => {
  await wipe();
  [jewelryId] = await unguardedDb("jewelries").insert({
    sku: `${MARK}-1`, name: "Pay Ring", category: "rings", material: "silver",
    silver_weight_grams: 10, making_charge: 500, cost_price: 1200, status: "available",
  });
});
after(async () => { await wipe(); await unguardedDb.destroy(); });

const buyer = { name: `${MARK} Buyer`, phone: "9800007777" };
const sell = () => issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);

test("cash is verified on the spot; a bank transfer waits", async () => {
  const invoice = await sell();
  const cash = await recordPayment({ invoiceId: invoice.id, amount: 100, method: "cash" }, actor);
  const bank = await recordPayment({ invoiceId: invoice.id, amount: 100, method: "bank_transfer" }, actor);

  assert.equal(cash.status, "verified");
  assert.equal(bank.status, "pending");
});

test("part payments add up and the balance follows", async () => {
  const invoice = await sell();
  await recordPayment({ invoiceId: invoice.id, amount: 1000, method: "cash" }, actor);

  let balance = (await getInvoiceBalance(db, invoice.id))!;
  assert.equal(balance.paid, 1000);
  assert.equal(balance.outstanding, invoice.totalAmount - 1000);
  assert.equal(balance.isSettled, false);

  await recordPayment({ invoiceId: invoice.id, amount: invoice.totalAmount - 1000, method: "cash" }, actor);
  balance = (await getInvoiceBalance(db, invoice.id))!;
  assert.equal(balance.outstanding, 0);
  assert.equal(balance.isSettled, true);
});

// Spec §6: verified payments must not exceed the invoice unless refunds exist.
test("paying more than is owed is refused", async () => {
  const invoice = await sell();
  await assert.rejects(
    () => recordPayment({ invoiceId: invoice.id, amount: invoice.totalAmount + 1, method: "cash" }, actor),
    /more than the/,
  );
});

test("pending money is reported apart from settled money", async () => {
  const invoice = await sell();
  const pending = await recordPayment({ invoiceId: invoice.id, amount: 500, method: "esewa_qr" }, actor);

  let balance = (await getInvoiceBalance(db, invoice.id))!;
  assert.equal(balance.paid, 0, "unverified money must not count as paid");
  assert.equal(balance.pending, 500);

  await verifyPayment(pending.id, actor);
  balance = (await getInvoiceBalance(db, invoice.id))!;
  assert.equal(balance.paid, 500);
  assert.equal(balance.pending, 0);
});

test("a refund is a negative row, and cannot exceed what was taken", async () => {
  const invoice = await sell();
  await recordPayment({ invoiceId: invoice.id, amount: 1000, method: "cash" }, actor);

  await assert.rejects(
    () => refundPayment({ invoiceId: invoice.id, amount: 2000, method: "cash", reason: "too much" }, actor),
    /only 1000 was taken/,
  );

  const refund = await refundPayment({ invoiceId: invoice.id, amount: 400, method: "cash", reason: "goodwill" }, actor);
  assert.equal(refund.amount, -400);

  const balance = (await getInvoiceBalance(db, invoice.id))!;
  assert.equal(balance.paid, 600);
});

test("a void invoice takes no payment", async () => {
  const { voidInvoice } = await import("../invoices/provider.void");
  const invoice = await sell();
  await voidInvoice(invoice.id, "mistake", actor);
  await assert.rejects(
    () => recordPayment({ invoiceId: invoice.id, amount: 100, method: "cash" }, actor),
    /void and cannot take a payment/,
  );
});

test("a payment must belong to something", async () => {
  await assert.rejects(() => recordPayment({ amount: 100, method: "cash" }, actor), /must belong to/);
});

// --- credit notes ------------------------------------------------------------

test("crediting a whole invoice voids it, restocks the piece and hands cash back", async () => {
  const invoice = await sell();
  await recordPayment({ invoiceId: invoice.id, amount: invoice.totalAmount, method: "cash" }, actor);

  const note = await issueCreditNote(
    { invoiceId: invoice.id, reason: "customer returned it", refund: { amount: invoice.totalAmount, method: "cash" } },
    actor,
  );

  assert.match(note!.creditNoteNo, /^CN-\d{4}\/\d{2}-\d{6}$/);
  assert.equal(note!.totalAmount, invoice.totalAmount);

  const after = await unguardedDb("invoices").where({ id: invoice.id }).first();
  assert.equal(Boolean(after.is_void), true, "a fully credited invoice should stop counting");
  // The original figures are untouched -- the reversal is its own document.
  assert.equal(Number(after.total_amount), invoice.totalAmount);

  assert.equal((await unguardedDb("jewelries").where({ id: jewelryId }).first()).status, "available");

  const balance = (await getInvoiceBalance(db, invoice.id))!;
  assert.equal(balance.paid, 0, "the refund should cancel out the payment");
});

test("a part credit leaves the invoice standing and the piece with the customer", async () => {
  const invoice = await sell();
  const line = invoice.items[0];

  const note = await issueCreditNote(
    { invoiceId: invoice.id, reason: "price adjustment", items: [{ invoiceItemId: line.id, amount: 200 }] },
    actor,
  );

  assert.equal(note!.totalAmount, 200);
  const after = await unguardedDb("invoices").where({ id: invoice.id }).first();
  assert.equal(Boolean(after.is_void), false, "a part credit must not void the invoice");
  assert.equal((await unguardedDb("jewelries").where({ id: jewelryId }).first()).status, "sold");
});

test("crediting more than a line is worth is refused", async () => {
  const invoice = await sell();
  const line = invoice.items[0];
  await assert.rejects(
    () => issueCreditNote({ invoiceId: invoice.id, reason: "x", items: [{ invoiceItemId: line.id, amount: line.lineTotal + 1 }] }, actor),
    /only .* remains/,
  );
});

test("two part credits cannot together exceed the line", async () => {
  const invoice = await sell();
  const line = invoice.items[0];
  await issueCreditNote({ invoiceId: invoice.id, reason: "first", items: [{ invoiceItemId: line.id, amount: line.lineTotal - 100 }] }, actor);
  await assert.rejects(
    () => issueCreditNote({ invoiceId: invoice.id, reason: "second", items: [{ invoiceItemId: line.id, amount: 200 }] }, actor),
    /only 100 remains/,
  );
});

test("an already void invoice cannot be credited", async () => {
  const { voidInvoice } = await import("../invoices/provider.void");
  const invoice = await sell();
  await voidInvoice(invoice.id, "mistake", actor);
  await assert.rejects(() => issueCreditNote({ invoiceId: invoice.id, reason: "x" }, actor), /already void/);
});
