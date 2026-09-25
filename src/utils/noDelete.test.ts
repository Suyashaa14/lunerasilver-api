import { test, after } from "node:test";
import assert from "node:assert/strict";
import db, { unguardedDb } from "./db";
import { APPEND_ONLY_TABLES, HardDeleteBlocked } from "./noDelete";

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
