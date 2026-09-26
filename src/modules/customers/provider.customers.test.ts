import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import db, { unguardedDb } from "../../utils/db";
import { findOrCreateByPhone, normalizePhone, createCustomer, updateCustomer, getCustomerPurchases } from "./provider.customers";

const MARK = "__cust_test__";
// Unique per run, so a number used elsewhere in the database cannot collide.
const TEST_PHONE = `98${String(Date.now()).slice(-8)}`;
import { actor, resolveActor } from "../../utils/testActor";

const cleanup = async () => {
  const ids = (await unguardedDb("customers").where("name", "like", `${MARK}%`).select("id")).map((r: any) => r.id);
  if (ids.length > 0) {
    await unguardedDb("audit_logs").where({ entity_type: "customers" }).whereIn("entity_id", ids).del();
    await unguardedDb("customers").whereIn("id", ids).del();
  }
};

before(async () => {
  await resolveActor();
  await cleanup();
});
after(async () => {
  await cleanup();
  await unguardedDb.destroy();
});

test("phone numbers are stripped to digits before matching", () => {
  assert.equal(normalizePhone("980-000 0000"), "9800000000");
  assert.equal(normalizePhone("(980) 000-0000"), "9800000000");
  assert.equal(normalizePhone("+977 9800000000"), "+9779800000000");
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
});

// The point of the step: a repeat visit must not create a second record.
test("the same phone returns the same customer, however it is typed", async () => {
  const first = await db.transaction((trx) =>
    findOrCreateByPhone(trx, { name: `${MARK} Rita`, phone: TEST_PHONE }, actor),
  );
  const second = await db.transaction((trx) =>
    findOrCreateByPhone(trx, { name: `${MARK} Rita again`, phone: `${TEST_PHONE.slice(0, 3)}-${TEST_PHONE.slice(3, 6)} ${TEST_PHONE.slice(6)}` }, actor),
  );

  assert.equal(second.id, first.id, "a repeat visit created a duplicate customer");
  assert.equal(second.name, `${MARK} Rita`, "the existing record should not be overwritten");

  const count = await unguardedDb("customers").where({ phone: TEST_PHONE }).count({ c: "*" }).first();
  assert.equal(Number((count as any).c), 1);
});

test("different phones are different customers", async () => {
  const a = await db.transaction((trx) => findOrCreateByPhone(trx, { name: `${MARK} A`, phone: "9800000002" }, actor));
  const b = await db.transaction((trx) => findOrCreateByPhone(trx, { name: `${MARK} B`, phone: "9800000003" }, actor));
  assert.notEqual(a.id, b.id);
});

// Nothing to match on means nothing to merge on. Two anonymous buyers are two
// people, not one.
test("no phone always creates a new record", async () => {
  const a = await db.transaction((trx) => findOrCreateByPhone(trx, { name: `${MARK} Walk-in` }, actor));
  const b = await db.transaction((trx) => findOrCreateByPhone(trx, { name: `${MARK} Walk-in` }, actor));
  assert.notEqual(a.id, b.id);
  assert.equal(a.phone, null);
});

test("a rolled-back sale leaves no customer behind", async () => {
  const before = await unguardedDb("customers").count({ c: "*" }).first();

  await assert.rejects(
    db.transaction(async (trx) => {
      await findOrCreateByPhone(trx, { name: `${MARK} Ghost`, phone: "9800000009" }, actor);
      throw new Error("sale failed");
    }),
    /sale failed/,
  );

  const after = await unguardedDb("customers").count({ c: "*" }).first();
  assert.equal(Number((after as any).c), Number((before as any).c));
});

test("create and update write audit rows", async () => {
  const created = await createCustomer({ name: `${MARK} Audited`, phone: "9800000004" }, actor);
  assert.ok(created);

  const updated = await updateCustomer(created!.id, { city: "Kathmandu" }, actor);
  assert.equal(updated!.city, "Kathmandu");
  assert.equal(updated!.name, `${MARK} Audited`, "an unrelated field was overwritten");

  const rows = await unguardedDb("audit_logs")
    .where({ entity_type: "customers", entity_id: created!.id })
    .orderBy("id");
  assert.deepEqual(rows.map((r: any) => r.action), ["create", "update"]);
});

// The address is taken at the counter, often on a later visit than the first.
// It has to land on the record that already exists, or the invoice prints "-".
test("a repeat buyer's blank details are filled in, and filled ones are left alone", async () => {
  const phone = `98${String(Date.now()).slice(-8)}`;

  const first = await db.transaction((trx) =>
    findOrCreateByPhone(trx, { name: `${MARK} Bimala`, phone }, actor),
  );
  assert.equal(first.addressLine, null);

  const second = await db.transaction((trx) =>
    findOrCreateByPhone(trx, { name: `${MARK} Bimala`, phone, addressLine: "Jhamsikhel, Ward 3" }, actor),
  );
  assert.equal(second.id, first.id, "a second record was created");
  assert.equal(second.addressLine, "Jhamsikhel, Ward 3");

  // A correction lives on the customer record. A later sale must not undo it.
  await updateCustomer(first.id, { addressLine: "Corrected address" }, actor);
  const third = await db.transaction((trx) =>
    findOrCreateByPhone(trx, { name: `${MARK} Bimala`, phone, addressLine: "Jhamsikhel, Ward 3" }, actor),
  );
  assert.equal(third.addressLine, "Corrected address", "a stored address was overwritten by the counter");
});

// One phone, one customer -- enforced by the database, not just by the lookup.
// Two sales saved at the same instant used to be able to split a buyer's
// history across two records.
test("the same phone cannot end up on two customers", async () => {
  const phone = `98${String(Date.now()).slice(-8)}`;
  const first = await createCustomer({ name: `${MARK} Unique`, phone }, actor);
  assert.ok(first);

  await assert.rejects(
    unguardedDb("customers").insert({ name: `${MARK} Copy`, phone }),
    /Duplicate entry|ER_DUP_ENTRY/,
  );

  // Two at once resolve to the one buyer rather than failing a sale.
  const [a, b] = await Promise.all([
    db.transaction((trx) => findOrCreateByPhone(trx, { name: `${MARK} Race A`, phone }, actor)),
    db.transaction((trx) => findOrCreateByPhone(trx, { name: `${MARK} Race B`, phone }, actor)),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(a.id, first!.id);
});

// A walk-in who gives no number still gets their own row: there is nothing to
// recognise them by, so they cannot be merged with anyone.
test("customers without a phone are not collapsed into one", async () => {
  const one = await createCustomer({ name: `${MARK} Walkin A` }, actor);
  const two = await createCustomer({ name: `${MARK} Walkin B` }, actor);
  assert.notEqual(one!.id, two!.id);
});

test("a customer with no purchases reports an empty history", async () => {
  const customer = await createCustomer({ name: `${MARK} Fresh`, phone: `97${String(Date.now()).slice(-8)}` }, actor);
  const history = await getCustomerPurchases(customer!.id);
  assert.deepEqual(history.items, []);
  assert.equal(history.summary.piecesBought, 0);
  assert.equal(history.summary.totalSpent, 0);
});
