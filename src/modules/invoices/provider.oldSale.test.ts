import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { unguardedDb } from "../../utils/db";
import { logOldSale, updateOldSale, deleteOldSale, getOldSaleForEdit } from "./provider.oldSale";
import { actor, resolveActor } from "../../utils/testActor";

const BILL = "TSTOLD-1";
const BILL2 = "TSTOLD-2";
const BUYER = "__oldsale_test__";

const bill = (over: Record<string, unknown> = {}) => ({
  billNo: BILL,
  date: "2026-10-01",
  customer: { name: BUYER, phone: "9800000099" },
  silverRatePerGram: 100,
  paymentMethod: "cash" as const,
  items: [{ name: "Test Ring", category: "rings", quantity: 1, weightGrams: 10, amount: 3000, makingCharge: 500 }],
  ...over,
});

let firstEntry = 0;

/** Every ledger line written since the tests began, summed per account. */
const ledgerNet = async () => {
  const rows = await unguardedDb("journal_entry_lines as l")
    .join("journal_entries as e", "e.id", "l.journal_entry_id")
    .where("e.id", ">", firstEntry)
    .groupBy("l.account_id")
    .select("l.account_id")
    .sum({ d: "l.debit", c: "l.credit" });
  return rows.map((r: any) => Number(r.d) - Number(r.c));
};

const wipe = async () => {
  const ids = (await unguardedDb("invoices").where("invoice_no", "like", "TSTOLD-%").select("id")).map((r: any) => r.id);
  for (const id of ids) {
    const pay = (await unguardedDb("payments").where({ invoice_id: id }).select("id")).map((r: any) => r.id);
    await unguardedDb("payments").where({ invoice_id: id }).del();
    if (pay.length) await unguardedDb("audit_logs").where({ entity_type: "payments" }).whereIn("entity_id", pay).del();
    await unguardedDb("invoice_items").where({ invoice_id: id }).del();
    await unguardedDb("audit_logs").where({ entity_type: "invoices", entity_id: id }).del();
    await unguardedDb("invoices").where({ id }).del();
  }
  const jew = unguardedDb("jewelries").where("sku", "like", "OLD-TSTOLD-%").select("id");
  await unguardedDb("inventory_transactions").whereIn("jewelry_id", jew).del();
  await unguardedDb("jewelries").where("sku", "like", "OLD-TSTOLD-%").del();
  if (firstEntry > 0) {
    await unguardedDb("journal_entry_lines").whereIn("journal_entry_id", unguardedDb("journal_entries").where("id", ">", firstEntry).select("id")).del();
    await unguardedDb("journal_entries").where("id", ">", firstEntry).del();
  }
  await unguardedDb("customers").where("name", BUYER).del();
};

before(async () => {
  await resolveActor();
  await wipe();
  const last = await unguardedDb("journal_entries").max({ m: "id" }).first();
  firstEntry = Number(last?.m ?? 0);
});
after(async () => { await wipe(); await unguardedDb.destroy(); });

test("an old bill can be edited, and the books follow", async () => {
  const first = await logOldSale(bill(), actor);
  assert.ok(first);

  const form = await getOldSaleForEdit(first!.id);
  assert.equal(form!.billNo, BILL);
  assert.equal(form!.items[0].amount, 3000);
  assert.equal(form!.items[0].makingCharge, 500);
  assert.equal(form!.paid, true);

  // Amount typed wrong: it was 2500, and the bill number also changes.
  const second = await updateOldSale(first!.id, bill({
    billNo: BILL2,
    items: [{ name: "Test Ring", category: "rings", quantity: 1, weightGrams: 10, amount: 2500, makingCharge: 500 }],
  }), actor);
  assert.equal(second!.invoiceNo, BILL2);
  assert.equal(await unguardedDb("invoices").where({ invoice_no: BILL }).first(), undefined);
  const rows = await unguardedDb("invoices").where("invoice_no", "like", "TSTOLD-%");
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].subtotal), 2500);
  // One piece, not two: the first version's piece is gone.
  assert.equal((await unguardedDb("jewelries").where("sku", "like", "OLD-TSTOLD-%")).length, 1);
  // Paid again in full on the corrected figure.
  const paid = await unguardedDb("payments").where({ invoice_id: rows[0].id }).sum({ s: "amount" }).first();
  assert.equal(Number(paid!.s), Number(rows[0].total_amount));
});

test("an old bill paid by eSewa counts as paid at once, with nothing pending", async () => {
  const [row] = await unguardedDb("invoices").where("invoice_no", "like", "TSTOLD-%");
  const edited = await updateOldSale(row.id, bill({ billNo: BILL2, paymentMethod: "esewa_qr" }), actor);
  const pays = await unguardedDb("payments").where({ invoice_id: edited!.id });
  assert.equal(pays.length, 1);
  assert.equal(pays[0].status, "verified");
});

test("a failed edit leaves the bill as it was", async () => {
  const [row] = await unguardedDb("invoices").where("invoice_no", "like", "TSTOLD-%");
  await assert.rejects(
    updateOldSale(row.id, bill({ billNo: BILL2, discount: 999999 }), actor),
    /discount is larger/,
  );
  const still = await unguardedDb("invoices").where({ id: row.id }).first();
  assert.ok(still);
  assert.equal((await unguardedDb("payments").where({ invoice_id: row.id })).length, 1);
});

test("deleting an old bill frees its number and nets the ledger to zero", async () => {
  const [row] = await unguardedDb("invoices").where("invoice_no", "like", "TSTOLD-%");
  assert.equal(await deleteOldSale(row.id, actor), true);

  assert.equal((await unguardedDb("invoices").where("invoice_no", "like", "TSTOLD-%")).length, 0);
  assert.equal((await unguardedDb("jewelries").where("sku", "like", "OLD-TSTOLD-%")).length, 0);
  assert.ok((await ledgerNet()).every((n) => Math.abs(n) < 0.005), "ledger nets to zero per account");

  // The number can be used again.
  const again = await logOldSale(bill(), actor);
  assert.equal(again!.invoiceNo, BILL);
  assert.equal(await deleteOldSale(999999999, actor), false);
});

test("an issued invoice cannot be removed this way", async () => {
  const [{ id }] = await unguardedDb("invoices").where("is_old_bill", false).limit(1).select("id").then((r: any) => r.length ? r : [{ id: 0 }]);
  if (!id) return;
  await assert.rejects(deleteOldSale(id, actor), /Only a logged old bill/);
});
