import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import db, { unguardedDb } from "../../utils/db";
import { issueInvoice, getInvoice } from "./provider.issue";

const MARK = "__inv_test__";
const actor = { userId: 1, ipAddress: "::1", userAgent: "test" };

let jewelryId = 0;
let secondPieceId = 0;

const wipe = async () => {
  const invoiceIds = (await unguardedDb("invoices").where("buyer_name", "like", `${MARK}%`).select("id")).map((r: any) => r.id);
  if (invoiceIds.length > 0) {
    await unguardedDb("inventory_transactions").where({ reference_type: "invoice" }).whereIn("reference_id", invoiceIds).del();
    await unguardedDb("invoice_items").whereIn("invoice_id", invoiceIds).del();
    await unguardedDb("audit_logs").where({ entity_type: "invoices" }).whereIn("entity_id", invoiceIds).del();
    await unguardedDb("invoices").whereIn("id", invoiceIds).del();
  }
  const custIds = (await unguardedDb("customers").where("name", "like", `${MARK}%`).select("id")).map((r: any) => r.id);
  if (custIds.length > 0) {
    await unguardedDb("audit_logs").where({ entity_type: "customers" }).whereIn("entity_id", custIds).del();
    await unguardedDb("customers").whereIn("id", custIds).del();
  }
  await unguardedDb("inventory_transactions").where("jewelry_id", "in",
    unguardedDb("jewelries").where("sku", "like", `${MARK}%`).select("id")).del();
  await unguardedDb("jewelries").where("sku", "like", `${MARK}%`).del();
  // Only the real fiscal years. The numbering tests own a throwaway year of
  // their own, and resetting it underneath them breaks their count.

};

before(wipe);

beforeEach(async () => {
  await wipe();
  [jewelryId] = await unguardedDb("jewelries").insert({
    sku: `${MARK}-1`, name: "Test Ring", category: "rings", material: "silver",
    silver_weight_grams: 10, making_charge: 500, cost_price: 1200, status: "available",
  });
  [secondPieceId] = await unguardedDb("jewelries").insert({
    sku: `${MARK}-2`, name: "Test Pendant", category: "necklaces", material: "silver",
    silver_weight_grams: 5, making_charge: 300, cost_price: 600, status: "available",
  });
});

after(async () => {
  await wipe();
  await unguardedDb.destroy();
});

const buyer = { name: `${MARK} Buyer`, phone: "9800001111" };

test("issuing writes the document, the stock row and the audit row together", async () => {
  const invoice = await issueInvoice(
    { customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] },
    actor,
  );

  assert.match(invoice.invoiceNo, /^INV-\d{4}\/\d{2}-\d{6}$/);
  assert.equal(invoice.items.length, 1);

  // The spec's reconciliation rule: the lines must add up to the subtotal.
  const lineSum = invoice.items.reduce((s, i) => s + i.lineTotal, 0);
  assert.equal(lineSum, invoice.subtotal);
  assert.equal(invoice.taxableAmount + invoice.vatAmount, invoice.totalAmount);

  const piece = await unguardedDb("jewelries").where({ id: jewelryId }).first();
  assert.equal(piece.status, "sold");

  const ledger = await unguardedDb("inventory_transactions")
    .where({ reference_type: "invoice", reference_id: invoice.id });
  assert.equal(ledger.length, 1, "one stock row per line");
  assert.equal(ledger[0].direction, "out");
  assert.equal(Number(ledger[0].cost_amount), 1200, "cost of goods must be captured at sale time");

  const audit = await unguardedDb("audit_logs").where({ entity_type: "invoices", entity_id: invoice.id }).first();
  assert.ok(audit, "no audit row was written");
});

// Spec §6.1. The piece is unique, so exactly one till can sell it.
test("two tills selling the same piece: exactly one wins", async () => {
  const results = await Promise.allSettled([
    issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor),
    issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor),
  ]);

  const won = results.filter((r) => r.status === "fulfilled");
  const lost = results.filter((r) => r.status === "rejected");
  assert.equal(won.length, 1, "the same piece was sold twice");
  assert.equal(lost.length, 1);

  const invoices = await unguardedDb("invoices").where("buyer_name", "like", `${MARK}%`);
  assert.equal(invoices.length, 1, "a losing sale still left an invoice behind");
});

test("a failed sale leaves nothing behind — no number, no stock row, no customer", async () => {
  const seqBefore = await unguardedDb("invoice_sequences").where({ series: "SALES", fiscal_year: "2083/84" }).first();

  await assert.rejects(
    issueInvoice(
      { customer: { name: `${MARK} Ghost`, phone: "9800009999" }, paymentMethod: "cash", items: [{ jewelryId: 99999 }] },
      actor,
    ),
    /not found/,
  );

  const seqAfter = await unguardedDb("invoice_sequences").where({ series: "SALES", fiscal_year: "2083/84" }).first();
  assert.equal(Number(seqAfter.next_number), Number(seqBefore.next_number), "a failed sale burned an invoice number");
  assert.equal((await unguardedDb("customers").where({ phone: "9800009999" })).length, 0, "a failed sale left a customer");
  assert.equal((await unguardedDb("jewelries").where({ id: jewelryId }).first()).status, "available");
});

test("a piece that is already sold cannot be sold again", async () => {
  await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);
  await assert.rejects(
    issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor),
    /cannot be sold/,
  );
});

test("a retired piece cannot be sold", async () => {
  await unguardedDb("jewelries").where({ id: jewelryId }).update({ status: "damaged" });
  await assert.rejects(
    issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor),
    /damaged and cannot be sold/,
  );
});

test("figures are snapshots, not live lookups", async () => {
  const invoice = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);
  const line = invoice.items[0];

  // Move the catalogue underneath the issued invoice.
  await unguardedDb("jewelries").where({ id: jewelryId }).update({ name: "Renamed", silver_weight_grams: 99, making_charge: 9999 });

  const reread = await getInvoice(invoice.id);
  assert.equal(reread!.items[0].name, line.name, "the invoice followed a catalogue rename");
  assert.equal(reread!.items[0].silverWeightGrams, line.silverWeightGrams);
  assert.equal(reread!.items[0].unitPrice, line.unitPrice);
});

test("several pieces on one invoice", async () => {
  const invoice = await issueInvoice(
    { customer: buyer, paymentMethod: "cash", items: [{ jewelryId }, { jewelryId: secondPieceId }] },
    actor,
  );

  assert.equal(invoice.items.length, 2);
  assert.equal(invoice.items.reduce((s, i) => s + i.lineTotal, 0), invoice.subtotal);

  const ledger = await unguardedDb("inventory_transactions").where({ reference_type: "invoice", reference_id: invoice.id });
  assert.equal(ledger.length, 2, "one stock row per line");
});

test("a discount larger than the price is refused", async () => {
  await assert.rejects(
    issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId, discount: 999999 }] }, actor),
    /larger than its price/,
  );
});

test("the buyer is reused, not duplicated, across two sales", async () => {
  const first = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);
  const second = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId: secondPieceId }] }, actor);

  assert.equal(second.customerId, first.customerId);
  assert.equal((await unguardedDb("customers").where({ phone: "9800001111" })).length, 1);
});

// --- Step 1.3: void ----------------------------------------------------------

test("voiding keeps the invoice, drops it from revenue and restocks the piece", async () => {
  const { voidInvoice } = await import("./provider.void");
  const invoice = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);

  const voided = await voidInvoice(invoice.id, "issued to the wrong customer", actor);

  assert.equal(voided!.isVoid, true);
  assert.equal(voided!.voidReason, "issued to the wrong customer");
  // Still there, still numbered -- the sequence keeps no holes.
  assert.equal(voided!.invoiceNo, invoice.invoiceNo);
  assert.equal(voided!.totalAmount, invoice.totalAmount);

  const piece = await unguardedDb("jewelries").where({ id: jewelryId }).first();
  assert.equal(piece.status, "available", "a voided sale left the piece off the shelf");

  const ledger = await unguardedDb("inventory_transactions")
    .where({ reference_type: "invoice", reference_id: invoice.id })
    .orderBy("id");
  assert.deepEqual(ledger.map((r: any) => r.direction), ["out", "in"], "stock must go out then come back");

  const audit = await unguardedDb("audit_logs").where({ entity_type: "invoices", entity_id: invoice.id });
  assert.deepEqual(audit.map((r: any) => r.action), ["create", "void"]);
});

test("a voided invoice cannot be voided twice", async () => {
  const { voidInvoice } = await import("./provider.void");
  const invoice = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);
  await voidInvoice(invoice.id, "first", actor);
  await assert.rejects(() => voidInvoice(invoice.id, "second", actor), /already void/);
});

test("a restocked piece can be sold again", async () => {
  const { voidInvoice } = await import("./provider.void");
  const first = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);
  await voidInvoice(first.id, "wrong customer", actor);

  const second = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.invoiceNo, first.invoiceNo, "the voided number must not be reused");
});

test("printing counts, and the first one is the original", async () => {
  const { recordPrint } = await import("./provider.void");
  const invoice = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);
  assert.equal(invoice.printCount, 0);

  assert.equal((await recordPrint(invoice.id, actor))!.printCount, 1);
  assert.equal((await recordPrint(invoice.id, actor))!.printCount, 2);
});
