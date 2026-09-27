import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import db, { unguardedDb } from "../../utils/db";
import { postEntry, trialBalance, UnbalancedEntry, UnknownAccount } from "./provider.ledger";
import { issueInvoice } from "../invoices/provider.issue";
import { issueCreditNote } from "../invoices/provider.creditNote";
import { recordPayment } from "../payments/provider.payments";
import { createPurchase } from "../purchases/provider.purchases";
import { closePeriod, reopenPeriod } from "./provider.periods";

const MARK = "__ledger_test__";
import { actor, resolveActor } from "../../utils/testActor";
let jewelryId = 0;
let supplierId = 0;

const wipe = async () => {
  await unguardedDb("journal_entry_lines").del();
  await unguardedDb("journal_entries").del();
  await unguardedDb("credit_note_items").del();
  await unguardedDb("credit_notes").del();
  await unguardedDb("payments").del();
  await unguardedDb("inventory_transactions").del();
  await unguardedDb("invoice_items").del();
  await unguardedDb("invoices").del();
  await unguardedDb("purchase_items").del();
  await unguardedDb("purchases").del();
  await unguardedDb("audit_logs").del();
  await unguardedDb("customers").del();
  await unguardedDb("jewelries").whereNotNull("purchase_item_id").update({ purchase_item_id: null });
  await unguardedDb("jewelries").where("sku", "like", `${MARK}%`).del();
  await unguardedDb("suppliers").where("name", "like", `${MARK}%`).del();
  await unguardedDb("fiscal_years").update({ status: "open" });
  await unguardedDb("business_profile").update({ is_vat_registered: false });
};

before(async () => {
  await resolveActor();
  await wipe();
});
beforeEach(async () => {
  await wipe();
  [supplierId] = await unguardedDb("suppliers").insert({ name: `${MARK} Supplier`, pan: "123456789" });
  [jewelryId] = await unguardedDb("jewelries").insert({
    sku: `${MARK}-1`, name: "Ledger Ring", category: "rings", material: "silver",
    silver_weight_grams: 10, making_charge: 500, cost_price: 1200, status: "available",
  });
});
after(async () => { await wipe(); await unguardedDb.destroy(); });

const buyer = { name: `${MARK} Buyer`, phone: "9800002222" };

test("an unbalanced entry is refused", async () => {
  await assert.rejects(
    db.transaction((trx) => postEntry(trx, {
      date: "2026-09-20", narration: "wrong",
      lines: [{ account: "1000", debit: 100 }, { account: "4000", credit: 90 }],
    }, actor)),
    UnbalancedEntry,
  );
});

test("an unknown account code is refused", async () => {
  await assert.rejects(
    db.transaction((trx) => postEntry(trx, {
      date: "2026-09-20", narration: "wrong",
      lines: [{ account: "9999", debit: 100 }, { account: "4000", credit: 100 }],
    }, actor)),
    UnknownAccount,
  );
});

test("a sale posts receivable, income and cost of goods", async () => {
  const invoice = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);

  const entries = await unguardedDb("journal_entries").where({ reference_type: "invoice", reference_id: invoice.id });
  assert.equal(entries.length, 2, "a sale posts the revenue entry and the cost entry");

  const tb = await trialBalance({});
  const byCode = new Map(tb.rows.map((r) => [r.code, r]));

  assert.equal(byCode.get("1100")!.balance, invoice.totalAmount, "receivable should equal the invoice");
  assert.equal(byCode.get("4000")!.balance, invoice.taxableAmount, "income should equal the net");
  assert.equal(byCode.get("5000")!.balance, 1200, "cost of goods should be the piece's cost");
  assert.equal(byCode.get("1200")!.balance, -1200, "inventory should fall by the cost");
  assert.ok(tb.balances, "the books must balance");
});

test("payment moves the debt into cash", async () => {
  const invoice = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);
  await recordPayment({ invoiceId: invoice.id, amount: invoice.totalAmount, method: "cash" }, actor);

  const tb = await trialBalance({});
  const byCode = new Map(tb.rows.map((r) => [r.code, r]));

  assert.equal(byCode.get("1000")!.balance, invoice.totalAmount, "cash should hold the money");
  assert.equal(byCode.get("1100")!.balance, 0, "nothing should still be receivable");
  assert.ok(tb.balances);
});

test("a purchase puts stock in and owes the supplier", async () => {
  await createPurchase({
    supplierId, billNo: `${MARK}-B1`, billDate: "2026-09-20",
    items: [{ description: "Bought ring", unitCost: 3000 }],
  }, actor);

  const tb = await trialBalance({});
  const byCode = new Map(tb.rows.map((r) => [r.code, r]));
  assert.equal(byCode.get("1200")!.balance, 3000);
  assert.equal(byCode.get("2000")!.balance, 3000);
  assert.ok(tb.balances);
});

test("a credit note reverses the sale and the books still balance", async () => {
  const invoice = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);
  await issueCreditNote({ invoiceId: invoice.id, reason: "returned" }, actor);

  const tb = await trialBalance({});
  const byCode = new Map(tb.rows.map((r) => [r.code, r]));

  assert.equal(byCode.get("4000")!.balance, 0, "income should be back to nothing");
  assert.equal(byCode.get("1100")!.balance, 0, "nothing should still be owed");
  assert.equal(byCode.get("5000")!.balance, 0, "cost of goods should be reversed with the stock");
  assert.ok(tb.balances);
});

test("voiding a sale reverses its posting", async () => {
  const { voidInvoice } = await import("../invoices/provider.void");
  const invoice = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);
  await voidInvoice(invoice.id, "issued in error", actor);

  const tb = await trialBalance({});
  const byCode = new Map(tb.rows.map((r) => [r.code, r]));
  assert.equal(byCode.get("4000")!.balance, 0);
  assert.equal(byCode.get("1100")!.balance, 0);
  assert.ok(tb.balances);
});

// The whole point of double entry: whatever happens, the two sides agree.
test("after a full trading cycle the books balance to the rupee", async () => {
  await createPurchase({
    supplierId, billNo: `${MARK}-B2`, billDate: "2026-09-20",
    items: [{ description: "Stock", unitCost: 5000 }],
  }, actor);
  const invoice = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);
  await recordPayment({ invoiceId: invoice.id, amount: 1000, method: "cash" }, actor);
  await recordPayment(
    { invoiceId: invoice.id, amount: Math.round((invoice.totalAmount - 1000) * 100) / 100, method: "bank_transfer" },
    actor,
  );

  const tb = await trialBalance({});
  assert.equal(tb.totalDebit, tb.totalCredit, `debits ${tb.totalDebit} vs credits ${tb.totalCredit}`);
  assert.ok(tb.balances);
});

test("a year that does not balance cannot be closed, and a closed year refuses writes", async () => {
  const invoice = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);

  const closed = await closePeriod("2083/84", actor);
  assert.equal(closed.status, "closed");
  assert.equal(closed.totalDebit, closed.totalCredit);

  await assert.rejects(
    () => recordPayment({ invoiceId: invoice.id, amount: 100, method: "cash" }, actor),
    /closed/,
  );

  await reopenPeriod("2083/84", "correcting a posting", actor);
  const payment = await recordPayment({ invoiceId: invoice.id, amount: 100, method: "cash" }, actor);
  assert.equal(payment.amount, 100);
});

// --- PAN-only vs VAT-registered ---------------------------------------------

test("PAN only: VAT on a bill becomes part of the cost, not a reclaimable asset", async () => {
  await unguardedDb("business_profile").update({ is_vat_registered: false });

  await createPurchase({
    supplierId, billNo: `${MARK}-VAT1`, billDate: "2026-09-20",
    items: [{ description: "Stock", unitCost: 1000, vatAmount: 130,
              stockIn: { name: "VAT Ring", category: "rings", sku: `${MARK}-v1`, silverWeightGrams: 5, makingCharge: 100 } }],
  }, actor);

  const tb = await trialBalance({});
  const byCode = new Map(tb.rows.map((r) => [r.code, r]));

  assert.equal(byCode.get("1200")!.balance, 1130, "the tax belongs in the cost of the stock");
  assert.equal(byCode.get("1300"), undefined, "nothing should sit in VAT receivable");
  assert.ok(tb.balances);

  const piece = await unguardedDb("jewelries").where({ sku: `${MARK}-v1` }).first();
  assert.equal(Number(piece.cost_price), 1130, "the piece's cost must include the tax it cannot reclaim");
});

test("VAT registered: the same bill splits the tax out as reclaimable", async () => {
  await unguardedDb("business_profile").update({ is_vat_registered: true });

  await createPurchase({
    supplierId, billNo: `${MARK}-VAT2`, billDate: "2026-09-20",
    items: [{ description: "Stock", unitCost: 1000, vatAmount: 130,
              stockIn: { name: "VAT Ring 2", category: "rings", sku: `${MARK}-v2`, silverWeightGrams: 5, makingCharge: 100 } }],
  }, actor);

  const tb = await trialBalance({});
  const byCode = new Map(tb.rows.map((r) => [r.code, r]));

  assert.equal(byCode.get("1200")!.balance, 1000, "stock is worth the net price");
  assert.equal(byCode.get("1300")!.balance, 130, "the tax is owed back by the tax office");
  assert.ok(tb.balances);

  const piece = await unguardedDb("jewelries").where({ sku: `${MARK}-v2` }).first();
  assert.equal(Number(piece.cost_price), 1000, "reclaimable tax is not a cost");

  await unguardedDb("business_profile").update({ is_vat_registered: false });
});

// --- Skill promotion levy ----------------------------------------------------

// The levy is charged on top of the goods and owed onward, so it must never
// reach the sales account, and a sale given back in full must leave nothing
// sitting in it.
test("the levy is charged on top, kept out of sales, and given back in full", async () => {
  const invoice = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);

  const expected = Math.round(invoice.taxableAmount * 0.5) / 100;
  assert.equal(invoice.skillPromoRate, 0.5);
  assert.equal(invoice.skillPromoAmount, expected, "0.5% of the goods");
  assert.equal(invoice.totalAmount, Math.round((invoice.taxableAmount + expected) * 100) / 100);

  const afterSale = new Map((await trialBalance({})).rows.map((r) => [r.code, r]));
  assert.equal(afterSale.get("2300")!.balance, expected, "the levy is owed onward");
  assert.equal(afterSale.get("4000")!.balance, invoice.taxableAmount, "the levy must not be revenue");

  const note = await issueCreditNote({ invoiceId: invoice.id, reason: "returned" }, actor);
  assert.equal(note!.skillPromoAmount, expected, "a full credit gives the levy back too");

  const afterCredit = new Map((await trialBalance({})).rows.map((r) => [r.code, r]));
  assert.equal(afterCredit.get("2300")?.balance ?? 0, 0, "nothing should still be owed onward");
  assert.equal(afterCredit.get("1100")?.balance ?? 0, 0, "the buyer should owe nothing");
});

// Two part credits must not leave a rounded remainder behind in the levy.
test("part credits give the levy back exactly, however they are split", async () => {
  const invoice = await issueInvoice({ customer: buyer, paymentMethod: "cash", items: [{ jewelryId }] }, actor);
  const line = invoice.items[0];

  await issueCreditNote(
    { invoiceId: invoice.id, reason: "part one", items: [{ invoiceItemId: line.id, amount: 333 }] },
    actor,
  );
  await issueCreditNote(
    { invoiceId: invoice.id, reason: "the rest", items: [{ invoiceItemId: line.id, amount: line.lineTotal - 333 }] },
    actor,
  );

  const after = new Map((await trialBalance({})).rows.map((r) => [r.code, r]));
  assert.equal(after.get("2300")?.balance ?? 0, 0, "a levy remainder was stranded by rounding");
  assert.equal(after.get("1100")?.balance ?? 0, 0, "the buyer should owe nothing");
});

// --- Cost is fixed at purchase; only the silver moves -----------------------

// The shop's flow: a supplier is paid for silver, making and stone; the shop
// adds its own profit; the customer pays the total. The cost must not move
// afterwards, and the profit must not hide inside the making charge.
test("a piece keeps the cost it was bought at, and prices from today's rate", async () => {
  const { createPurchase: buy } = await import("../purchases/provider.purchases");
  const { getJewelry } = await import("../jewelries/provider.jewelries");
  const { updateSilverRate } = await import("../settings/provider.settings");

  await updateSilverRate(100);

  await buy({
    supplierId, billNo: `${MARK}-FLOW`, billDate: "2026-09-20",
    items: [{
      description: "Ring from the bill",
      stockIn: {
        name: "Flow Ring", category: "rings", sku: `${MARK}-flow`,
        silverWeightGrams: 10,
        ratePerGram: 100,   // the rate paid that day
        makingCharge: 500,  // paid to the supplier
        stonePrice: 300,    // paid to the supplier
        profitAmount: 400,  // the shop's own margin
      },
    }],
  }, actor);

  const piece = await unguardedDb("jewelries").where({ sku: `${MARK}-flow` }).first();
  assert.equal(Number(piece.cost_price), 1800, "10g x 100 + 500 making + 300 stone");
  assert.equal(Number(piece.cost_rate_per_gram), 100, "the rate paid is kept");
  assert.equal(Number(piece.profit_amount), 400);

  const atCostRate = await getJewelry(piece.id);
  assert.equal(atCostRate!.price, 2200, "cost 1800 plus 400 profit while the rate is unchanged");

  // Silver doubles overnight.
  await updateSilverRate(200);

  const afterRise = await getJewelry(piece.id);
  assert.equal(afterRise!.price, 3200, "10g x 200 + 500 + 300 + 400 -- only the silver moved");

  const unchanged = await unguardedDb("jewelries").where({ id: piece.id }).first("cost_price");
  assert.equal(Number(unchanged.cost_price), 1800, "the cost must not follow the market");

  await updateSilverRate(100);
});

// The bill and the piece must never tell two different stories.
test("a typed line cost that disagrees with its own parts is refused", async () => {
  const { createPurchase: buy } = await import("../purchases/provider.purchases");

  await assert.rejects(
    buy({
      supplierId, billNo: `${MARK}-MISMATCH`, billDate: "2026-09-20",
      items: [{
        description: "Wrong total",
        unitCost: 9999,
        stockIn: {
          name: "Bad Ring", category: "rings", sku: `${MARK}-bad`,
          silverWeightGrams: 10, ratePerGram: 100, makingCharge: 500, stonePrice: 300,
        },
      }],
    }, actor),
    /does not match/,
  );
});
