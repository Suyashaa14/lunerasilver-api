import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import db, { unguardedDb } from "./db";
import { APPEND_ONLY_TABLES, HardDeleteBlocked, ImmutableRecord, MUTABLE_COLUMNS } from "./writeGuards";
import { actor, resolveActor } from "./testActor";

before(resolveActor);

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

// Spec §6: deleting a user must not remove their orders or invoices. The
// foreign keys only stop it once there is history to stop; a fresh account
// deleted cleanly and silently until this guard existed.
test("people and evidence cannot be deleted", () => {
  for (const table of ["users", "customers", "suppliers", "documents"]) {
    assert.throws(() => db(table).where({ id: -1 }).del(), HardDeleteBlocked, `${table} was deletable`);
  }
});

test("a user is retired by deactivating, not deleting", async () => {
  const [id] = await unguardedDb("users").insert({
    name: "Guard Test", email: `guard-${Date.now()}@test.invalid`,
    password_hash: "x", role: "staff", is_active: true,
  });

  assert.throws(() => db("users").where({ id }).del(), HardDeleteBlocked);

  const { setActive } = await import("../modules/users/provider.users");
  const off = await setActive(id, false, actor);
  assert.equal(off!.isActive, false);
  assert.equal((await unguardedDb("users").where({ id }).first()).id, id, "the row must survive");

  await unguardedDb("audit_logs").where({ entity_type: "users", entity_id: id }).del();
  await unguardedDb("users").where({ id }).del();
});

test("the last admin cannot be deactivated or demoted", async () => {
  const admin = await unguardedDb("users").where({ role: "admin", is_active: true }).first();
  const others = await unguardedDb("users").where({ role: "admin", is_active: true }).count({ c: "*" }).first();

  if (Number((others as any).c) === 1) {
    const { setActive, setRole } = await import("../modules/users/provider.users");
    await assert.rejects(() => setActive(admin.id, false, { userId: 999 }), /last active admin/);
    await assert.rejects(() => setRole(admin.id, "staff", { userId: 999 }), /last admin/);
  }
});
