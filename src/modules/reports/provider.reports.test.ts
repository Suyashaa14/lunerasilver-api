import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { unguardedDb } from "../../utils/db";
import { issueInvoice } from "../invoices/provider.issue";
import { issueCreditNote } from "../invoices/provider.creditNote";
import { recordPayment } from "../payments/provider.payments";
import { createPurchase } from "../purchases/provider.purchases";
import { createExpense } from "../expenses/provider.expenses";
import { profitAndLoss, balanceSheet, agedReceivables, agedPayables, stockValuation, salesRegister, vatReturn, reconciliation } from "./provider.reports";

const MARK = "__report_test__";
import { actor, resolveActor } from "../../utils/testActor";
let jewelryId = 0;
let supplierId = 0;

const wipe = async () => {
  for (const t of ["journal_entry_lines", "journal_entries", "credit_note_items", "credit_notes", "payments",
                   "inventory_transactions", "invoice_items", "invoices", "purchase_items", "purchases",
                   "audit_logs", "customers", "expenses"]) {
    await unguardedDb(t).del();
  }
  await unguardedDb("jewelries").whereNotNull("purchase_item_id").update({ purchase_item_id: null });
  await unguardedDb("jewelries").where("sku", "like", `${MARK}%`).del();
  await unguardedDb("suppliers").where("name", "like", `${MARK}%`).del();
  await unguardedDb("fiscal_years").update({ status: "open" });
};

before(async () => {
  await resolveActor();
  await wipe();
});
beforeEach(async () => {
  await wipe();
  [supplierId] = await unguardedDb("suppliers").insert({ name: `${MARK} Supplier`, pan: "123456789" });
  [jewelryId] = await unguardedDb("jewelries").insert({
    sku: `${MARK}-1`, name: "Report Ring", category: "rings", material: "silver",
    silver_weight_grams: 10, making_charge: 500, cost_price: 1200, status: "available",
  });
});
after(async () => { await wipe(); await unguardedDb.destroy(); });

const buyer = { name: `${MARK} Buyer`, phone: "9800003333" };
const sell = () => issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);

test("profit and loss separates cost of sales from overheads", async () => {
  const invoice = await sell();
  await createExpense({ category: "rent", amount: 800, spentAt: "2026-09-21", paymentMethod: "cash" } as any, actor);

  const pl = await profitAndLoss({});
  assert.equal(pl.totalIncome, invoice.taxableAmount);
  assert.equal(pl.totalCostOfSales, 1200, "the piece's cost belongs in cost of sales");
  assert.equal(pl.grossProfit, invoice.taxableAmount - 1200);
  assert.equal(pl.totalExpenses, 800, "rent is an overhead, not a cost of sale");
  assert.equal(pl.netProfit, invoice.taxableAmount - 1200 - 800);
});

// The accounting identity. If this fails, something wrote outside postEntry.
test("the balance sheet balances", async () => {
  await createPurchase({ supplierId, billNo: `${MARK}-B1`, billDate: "2026-09-20",
    items: [{ description: "Stock", unitCost: 5000 }] }, actor);
  const invoice = await sell();
  await recordPayment({ invoiceId: invoice.id, amount: 1000, method: "cash" }, actor);
  await createExpense({ category: "rent", amount: 800, spentAt: "2026-09-21", paymentMethod: "cash" } as any, actor);

  const bs = await balanceSheet({});
  assert.ok(bs.balances, `assets ${bs.totalAssets} vs funding ${bs.totalFunding}, off by ${bs.difference}`);
  assert.equal(bs.difference, 0);
});

test("aged receivables show only what is still owed, in the right bucket", async () => {
  const invoice = await sell();
  let aged = await agedReceivables();
  assert.equal(aged.total, invoice.totalAmount);
  assert.equal(aged.items[0].bucket, "current", "an invoice issued today is current");

  await recordPayment({ invoiceId: invoice.id, amount: invoice.totalAmount, method: "cash" }, actor);
  aged = await agedReceivables();
  assert.equal(aged.total, 0, "a settled invoice should drop off entirely");
  assert.equal(aged.items.length, 0);
});

test("a void invoice is not owed", async () => {
  const { voidInvoice } = await import("../invoices/provider.void");
  const invoice = await sell();
  await voidInvoice(invoice.id, "mistake", actor);
  assert.equal((await agedReceivables()).total, 0);
});

test("aged payables show unpaid supplier bills", async () => {
  await createPurchase({ supplierId, billNo: `${MARK}-B2`, billDate: "2026-09-20",
    items: [{ description: "Stock", unitCost: 3000 }] }, actor);
  const aged = await agedPayables();
  assert.equal(aged.total, 3000);
  assert.equal(aged.items[0].supplier, `${MARK} Supplier`);
});

test("stock valuation counts only what is on the shelf, and flags pieces with no cost", async () => {
  await unguardedDb("jewelries").insert({
    sku: `${MARK}-2`, name: "No cost", category: "rings", material: "silver",
    silver_weight_grams: 5, making_charge: 200, cost_price: null, status: "available",
  });

  // Scoped to this test's own pieces: the database may hold others.
  const mine = (s: Awaited<ReturnType<typeof stockValuation>>) =>
    s.items.filter((i) => i.sku.startsWith(MARK));

  let stock = await stockValuation();
  assert.equal(mine(stock).length, 2);
  assert.equal(mine(stock).filter((i) => i.cost === null).length, 1,
    "a piece with no cost must be flagged, not counted as zero");
  assert.equal(mine(stock).reduce((t, i) => t + (i.cost ?? 0), 0), 1200);

  await sell();
  stock = await stockValuation();
  assert.equal(mine(stock).length, 1, "a sold piece leaves the valuation");
});

test("the sales register carries the tax split and zeroes a void invoice", async () => {
  const invoice = await sell();
  let register = await salesRegister({});
  assert.equal(register.totalTaxable, invoice.taxableAmount);
  assert.equal(register.totalVat, 0, "not VAT-registered, so zero -- but the column exists");

  const { voidInvoice } = await import("../invoices/provider.void");
  await voidInvoice(invoice.id, "mistake", actor);
  register = await salesRegister({});
  assert.equal(register.totalTaxable, 0);
  assert.equal(register.rows[0].isVoid, true, "a void invoice stays listed, at zero");
});

test("the VAT return nets output against input", async () => {
  await sell();
  await createPurchase({ supplierId, billNo: `${MARK}-B3`, billDate: "2026-09-20",
    items: [{ description: "Stock", unitCost: 3000, vatAmount: 390 }] }, actor);

  const vat = await vatReturn({});
  assert.equal(vat.isVatRegistered, false);
  assert.equal(vat.outputVat, 0);
  // PAN only: the 390 was booked as cost, so it must not be offered back here.
  assert.equal(vat.inputVat, 0, "unreclaimable tax must not appear as reclaimable");
  assert.equal(vat.vatPaidNotReclaimable, 390, "but it should still be visible");
  assert.equal(vat.netPayable, 0);
});

test("a credit note reduces the sales register and the VAT owed", async () => {
  const invoice = await sell();
  await issueCreditNote({ invoiceId: invoice.id, reason: "returned" }, actor);
  const vat = await vatReturn({});
  assert.equal(vat.sales.taxable, 0, "a fully credited sale nets to nothing");
});

// The plan's acceptance test: three routes to revenue, one number.
test("P&L revenue equals the sales register equals collected plus outstanding", async () => {
  const invoice = await sell();
  await recordPayment({ invoiceId: invoice.id, amount: 1000, method: "cash" }, actor);

  const check = await reconciliation({});
  assert.equal(check.profitAndLossRevenue, check.salesRegisterTaxable);
  assert.equal(check.salesRegisterTaxable, check.collectedPlusOutstanding);
  assert.ok(check.agrees, JSON.stringify(check));
});
