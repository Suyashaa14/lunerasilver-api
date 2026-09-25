import { test, after } from "node:test";
import assert from "node:assert/strict";
import db, { unguardedDb } from "./db";
import { APPEND_ONLY_TABLES, HardDeleteBlocked, ImmutableRecord, MUTABLE_COLUMNS } from "./writeGuards";

after(async () => {
  await unguardedDb.destroy();
});

// Thrown synchronously on purpose: it fails before the query is ever built,
// rather than returning a promise that rejects later.
test("deleting from a money table throws", () => {
  for (const table of ["expenses", "invoices", "audit_logs", "jewelries"]) {
    assert.throws(() => db(table).where({ id: -1 }).del(), HardDeleteBlocked, `${table} was deletable`);
  }
});

// The guard has to survive into transactions, because that is where money is
// actually written.
test("deleting inside a transaction throws too", async () => {
  await assert.rejects(
    db.transaction(async (trx) => {
      await trx("payments").where({ id: -1 }).del();
    }),
    HardDeleteBlocked,
  );
});

test("truncate is blocked as well", () => {
  assert.throws(() => db("invoice_items").truncate(), HardDeleteBlocked);
});

// Working state is not history. The cart must stay clearable.
test("non-money tables can still be deleted from", async () => {
  const removed = await db("cart_items").where({ id: -1 }).del();
  assert.equal(removed, 0);
});

test("reads and writes are untouched", async () => {
  const rows = await db("expenses").select("id").limit(1);
  assert.ok(Array.isArray(rows));
});

test("every table named in the spec is covered", () => {
  for (const table of ["invoices", "invoice_items", "credit_notes", "credit_note_items", "payments", "purchases", "purchase_items", "expenses", "inventory_transactions", "audit_logs"]) {
    assert.ok(APPEND_ONLY_TABLES.includes(table), `${table} is not protected`);
  }
});

// Step 1.3: an issued invoice is a tax document, not a record to tidy up.
test("changing an issued invoice's figures is refused", () => {
  for (const change of [{ total_amount: 1 }, { subtotal: 1 }, { customer_id: 2 }, { invoice_no: "X" }, { issued_at: "2026-01-01" }]) {
    assert.throws(() => db("invoices").where({ id: -1 }).update(change), ImmutableRecord);
  }
});

test("the update guard also catches the two-argument form", () => {
  assert.throws(() => db("invoices").where({ id: -1 }).update("total_amount", 5), ImmutableRecord);
});

test("voiding and counting a print are allowed", () => {
  assert.doesNotThrow(() => db("invoices").where({ id: -1 }).update({ is_void: true, void_reason: "r" }));
  assert.doesNotThrow(() => db("invoices").where({ id: -1 }).increment("print_count", 1));
});

// increment() builds its own UPDATE and would otherwise slip past the guard.
test("increment cannot be used to move money", () => {
  assert.throws(() => db("invoices").where({ id: -1 }).increment("total_amount", 100), ImmutableRecord);
  assert.throws(() => db("invoices").where({ id: -1 }).decrement("subtotal", 100), ImmutableRecord);
});

test("invoice lines cannot be changed at all", () => {
  assert.equal(MUTABLE_COLUMNS.invoice_items.length, 0);
  assert.throws(() => db("invoice_items").where({ id: -1 }).update({ unit_price: 1 }), ImmutableRecord);
});

test("ordinary tables are still editable", () => {
  assert.doesNotThrow(() => db("customers").where({ id: -1 }).update({ name: "fine" }));
  assert.doesNotThrow(() => db("jewelries").where({ id: -1 }).update({ status: "available" }));
});
