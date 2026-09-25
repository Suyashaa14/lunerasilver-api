import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import db, { unguardedDb } from "../../utils/db";
import { findOrCreateByPhone, normalizePhone, createCustomer, updateCustomer } from "./provider.customers";

const MARK = "__cust_test__";
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
    findOrCreateByPhone(trx, { name: `${MARK} Rita`, phone: "9800000001" }, actor),
  );
  const second = await db.transaction((trx) =>
    findOrCreateByPhone(trx, { name: `${MARK} Rita again`, phone: "980-000 0001" }, actor),
  );

  assert.equal(second.id, first.id, "a repeat visit created a duplicate customer");
  assert.equal(second.name, `${MARK} Rita`, "the existing record should not be overwritten");

  const count = await unguardedDb("customers").where({ phone: "9800000001" }).count({ c: "*" }).first();
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
