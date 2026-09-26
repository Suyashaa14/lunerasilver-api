import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { unguardedDb } from "../../utils/db";
import { createCounterOrder, invoiceOrder, listOrders, updateOrderStatus } from "./provider.orders";
import { trialBalance } from "../ledger/provider.ledger";
import { actor, resolveActor } from "../../utils/testActor";

const MARK = "__orders_test__";
let jewelryId = 0;

const wipe = async () => {
  await unguardedDb("journal_entry_lines").del();
  await unguardedDb("journal_entries").del();
  await unguardedDb("inventory_transactions").del();
  await unguardedDb("invoice_items").del();
  await unguardedDb("invoices").del();
  await unguardedDb("order_status_history").del();
  await unguardedDb("order_items").del();
  await unguardedDb("orders").del();
  await unguardedDb("audit_logs").del();
  await unguardedDb("customers").del();
  await unguardedDb("jewelries").where("sku", "like", `${MARK}%`).del();
  await unguardedDb("fiscal_years").update({ status: "open" });
};

before(async () => {
  await resolveActor();
  await wipe();
});
beforeEach(async () => {
  await wipe();
  [jewelryId] = await unguardedDb("jewelries").insert({
    sku: `${MARK}-1`, name: "Order Ring", category: "rings", material: "silver",
    silver_weight_grams: 10, making_charge: 500, cost_price: 1200, status: "available",
  });
});
after(async () => { await wipe(); await unguardedDb.destroy(); });

const buyer = {
  recipientName: `${MARK} Buyer`,
  phone: `98${String(Date.now()).slice(-8)}`,
  addressLine: "Jhamsikhel, Ward 3",
  city: "Lalitpur",
  paymentMethod: "cod" as const,
};

const takeOrder = () => createCounterOrder({ ...buyer, items: [{ jewelryId }] }, actor);

test("an order taken at the counter needs no login and holds the piece", async () => {
  const order = await takeOrder();

  assert.equal(order.status, "pending");
  assert.equal(order.userId, null, "a counter order has no login behind it");
  assert.equal(order.source, "counter");
  assert.match(order.orderNo!, /^ORD-\d{4}\/\d{2}-\d{6}$/);
  assert.equal(order.items.length, 1);

  const piece = await unguardedDb("jewelries").where({ id: jewelryId }).first();
  assert.equal(piece.status, "reserved", "an order holds the piece; it is not sold until invoiced");

  // The inner join on users used to drop counter orders from this list entirely.
  const list = await listOrders({ page: 1, pageSize: 20 });
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].customerName, buyer.recipientName);
});

test("the same piece cannot be promised to two people", async () => {
  await takeOrder();
  await assert.rejects(takeOrder(), /cannot be ordered/);
});

test("invoicing an order sells the piece, links the two and moves the books", async () => {
  const order = await takeOrder();
  const quoted = order.items[0].unitPrice;

  const { invoice, order: after } = await invoiceOrder(order.id, actor);

  assert.equal(after!.status, "completed");
  assert.equal(invoice.orderId, order.id, "the invoice must point back at the order");
  assert.equal(invoice.items[0].unitPrice, quoted, "the buyer is charged what they were quoted");

  const piece = await unguardedDb("jewelries").where({ id: jewelryId }).first();
  assert.equal(piece.status, "sold");

  // The order now shows where its money went.
  const list = await listOrders({ page: 1, pageSize: 20 });
  assert.equal(list.data[0].invoice!.invoiceNo, invoice.invoiceNo);

  const tb = await trialBalance({});
  assert.ok(tb.balances, "the books must still balance after an order becomes a sale");
});

test("an order cannot be invoiced twice, or after it is cancelled", async () => {
  const order = await takeOrder();
  await invoiceOrder(order.id, actor);
  await assert.rejects(invoiceOrder(order.id, actor), /already on invoice/);

  const second = await createCounterOrder(
    {
      ...buyer,
      items: [{
        jewelryId: (await unguardedDb("jewelries").insert({
          sku: `${MARK}-2`, name: "Second Ring", category: "rings", material: "silver",
          silver_weight_grams: 5, making_charge: 200, cost_price: 600, status: "available",
        }))[0],
      }],
    },
    actor,
  );
  await updateOrderStatus(second.id, { status: "cancelled" });
  await assert.rejects(invoiceOrder(second.id, actor), /cancelled/);
});

test("cancelling an order puts the piece back on the shelf", async () => {
  const order = await takeOrder();
  await updateOrderStatus(order.id, { status: "cancelled" });

  const piece = await unguardedDb("jewelries").where({ id: jewelryId }).first();
  assert.equal(piece.status, "available");
});

test("the open filter shows what is still owed to a buyer", async () => {
  const order = await takeOrder();

  assert.equal((await listOrders({ page: 1, pageSize: 20, status: "open" })).data.length, 1);
  assert.equal((await listOrders({ page: 1, pageSize: 20, status: "completed" })).data.length, 0);

  await invoiceOrder(order.id, actor);

  assert.equal((await listOrders({ page: 1, pageSize: 20, status: "open" })).data.length, 0);
  assert.equal((await listOrders({ page: 1, pageSize: 20, status: "completed" })).data.length, 1);
});
