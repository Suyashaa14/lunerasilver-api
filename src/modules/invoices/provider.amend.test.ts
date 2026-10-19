import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { unguardedDb } from "../../utils/db";
import { issueInvoice } from "./provider.issue";
import { updateInvoice, deleteInvoice, getSaleForEdit } from "./provider.amend";
import { recordPayment } from "../payments/provider.payments";
import { actor, resolveActor } from "../../utils/testActor";

const BUYER = "__amend_test__";
const SKU = "__amend_test__-1";
let pieceId = 0;
let firstEntry = 0;
let invoiceId = 0;
let invoiceNo = "";

const wipe = async () => {
  const ids = (await unguardedDb("invoices").where("buyer_name", BUYER).select("id")).map((r: any) => r.id);
  for (const id of ids) {
    const pay = (await unguardedDb("payments").where({ invoice_id: id }).select("id")).map((r: any) => r.id);
    await unguardedDb("payments").where({ invoice_id: id }).del();
    if (pay.length) await unguardedDb("audit_logs").where({ entity_type: "payments" }).whereIn("entity_id", pay).del();
    await unguardedDb("invoice_items").where({ invoice_id: id }).del();
    await unguardedDb("audit_logs").where({ entity_type: "invoices", entity_id: id }).del();
    await unguardedDb("invoices").where({ id }).del();
  }
  await unguardedDb("inventory_transactions").whereIn("jewelry_id", unguardedDb("jewelries").where("sku", SKU).select("id")).del();
  await unguardedDb("jewelries").where("sku", SKU).del();
  if (firstEntry > 0) {
    await unguardedDb("journal_entry_lines").whereIn("journal_entry_id", unguardedDb("journal_entries").where("id", ">", firstEntry).select("id")).del();
    await unguardedDb("journal_entries").where("id", ">", firstEntry).del();
  }
  await unguardedDb("customers").where("name", BUYER).del();
};

const sale = (price: number, discount = 0) => ({
  customer: { name: BUYER, phone: "9800000088" },
  paymentMethod: "cash" as const,
  items: [{ jewelryId: pieceId, unitPrice: price, discount }],
});

const net = async () => {
  const rows = await unguardedDb("journal_entry_lines as l")
    .join("journal_entries as e", "e.id", "l.journal_entry_id")
    .where("e.id", ">", firstEntry)
    .groupBy("l.account_id")
    .sum({ d: "l.debit", c: "l.credit" });
  return rows.map((r: any) => Number(r.d) - Number(r.c));
};

before(async () => {
  await resolveActor();
  await wipe();
  const last = await unguardedDb("journal_entries").max({ m: "id" }).first();
  firstEntry = Number(last?.m ?? 0);
  [pieceId] = await unguardedDb("jewelries").insert({
    sku: SKU, name: "Amend Ring", category: "rings", material: "silver",
    silver_weight_grams: 10, making_charge: 500, cost_price: 1200, status: "available",
  });
});
after(async () => { await wipe(); await unguardedDb.destroy(); });

test("a counter sale can be edited: same number, payment follows, piece stays sold", async () => {
  const first = await issueInvoice(sale(5000), actor);
  invoiceId = first.id;
  invoiceNo = first.invoiceNo;
  await recordPayment({ invoiceId, amount: 1000, method: "cash" } as any, actor);

  const form = await getSaleForEdit(invoiceId);
  assert.equal(form!.items[0].unitPrice, 5000);
  assert.equal(form!.paid, 1000);

  const edited = await updateInvoice(invoiceId, sale(4000, 200), actor);
  assert.equal(edited!.invoiceNo, invoiceNo);
  assert.equal(edited!.items.length, 1);
  assert.equal(edited!.discount, 200);
  invoiceId = edited!.id;

  assert.equal((await unguardedDb("invoices").where({ buyer_name: BUYER })).length, 1);
  assert.equal((await unguardedDb("jewelries").where({ id: pieceId }).first()).status, "sold");
  const paid = await unguardedDb("payments").where({ invoice_id: invoiceId }).sum({ s: "amount" }).first();
  assert.equal(Number(paid!.s), 1000);
});

test("an edit that would leave the sale underpaid is refused and changes nothing", async () => {
  await assert.rejects(updateInvoice(invoiceId, sale(500), actor), /already been taken/);
  const inv = await unguardedDb("invoices").where({ id: invoiceId }).first();
  assert.ok(inv);
  assert.equal((await unguardedDb("payments").where({ invoice_id: invoiceId })).length, 1);
  assert.equal((await unguardedDb("jewelries").where({ id: pieceId }).first()).status, "sold");
});

test("deleting a counter sale returns the piece and nets the ledger to zero", async () => {
  assert.equal(await deleteInvoice(invoiceId, actor), true);
  assert.equal((await unguardedDb("invoices").where({ buyer_name: BUYER })).length, 0);
  assert.equal((await unguardedDb("jewelries").where({ id: pieceId }).first()).status, "available");
  assert.equal((await unguardedDb("payments").where({ invoice_id: invoiceId })).length, 0);
  assert.ok((await net()).every((n) => Math.abs(n) < 0.005), "ledger nets to zero per account");
  assert.equal(await deleteInvoice(999999999, actor), false);
});
