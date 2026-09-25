import { test, after, before } from "node:test";
import assert from "node:assert/strict";
// unguardedDb, because the delete guard now (correctly) refuses to remove
// audit rows -- and a test still has to clear up after itself.
import db, { unguardedDb } from "./db";
import { writeAuditLog } from "./audit";
import { actor, resolveActor } from "./testActor";

const ENTITY = "__audit_test__";

before(resolveActor);

const countRows = async (entityId: number): Promise<number> => {
  const row = await db("audit_logs").where({ entity_type: ENTITY, entity_id: entityId }).count({ c: "*" }).first();
  return Number((row as { c: number | string }).c);
};

after(async () => {
  await unguardedDb("audit_logs").where({ entity_type: ENTITY }).del();
  await unguardedDb.destroy();
});

// The rule this whole helper exists to enforce: the audit row and the change it
// describes live or die together.
test("rolling back the transaction rolls back the audit row", async () => {
  const entityId = 900001;

  await assert.rejects(
    db.transaction(async (trx) => {
      await writeAuditLog(trx, {
        action: "create",
        entityType: ENTITY,
        entityId,
        userId: actor.userId,
        newValues: { note: "should not survive" },
      });

      // Something later in the same transaction fails, as a constraint would.
      throw new Error("forced rollback");
    }),
    /forced rollback/,
  );

  assert.equal(await countRows(entityId), 0, "audit row survived a rolled-back transaction");
});

test("committing the transaction keeps the audit row", async () => {
  const entityId = 900002;

  await db.transaction(async (trx) => {
    await writeAuditLog(trx, {
      action: "update",
      entityType: ENTITY,
      entityId,
      userId: actor.userId,
      oldValues: { amount: 100 },
      newValues: { amount: 150 },
    });
  });

  assert.equal(await countRows(entityId), 1);

  const row = await db("audit_logs").where({ entity_type: ENTITY, entity_id: entityId }).first();
  const oldValues = typeof row.old_values === "string" ? JSON.parse(row.old_values) : row.old_values;
  const newValues = typeof row.new_values === "string" ? JSON.parse(row.new_values) : row.new_values;
  assert.deepEqual(oldValues, { amount: 100 });
  assert.deepEqual(newValues, { amount: 150 });
  assert.equal(row.action, "update");
});

test("credentials are redacted, never stored", async () => {
  const entityId = 900003;

  await db.transaction(async (trx) => {
    await writeAuditLog(trx, {
      action: "role_change",
      entityType: ENTITY,
      entityId,
      userId: actor.userId,
      newValues: { email: "a@b.com", password_hash: "$2b$10$realhash", nested: { token: "secret-token" } },
    });
  });

  const row = await db("audit_logs").where({ entity_type: ENTITY, entity_id: entityId }).first();
  const stored = typeof row.new_values === "string" ? row.new_values : JSON.stringify(row.new_values);

  assert.ok(!stored.includes("$2b$10$realhash"), "password hash was written to the audit log");
  assert.ok(!stored.includes("secret-token"), "nested token was written to the audit log");
  assert.ok(stored.includes("a@b.com"), "non-sensitive fields should still be recorded");
});

test("over-long request metadata is clipped to the column width", async () => {
  const entityId = 900004;

  await db.transaction(async (trx) => {
    await writeAuditLog(trx, {
      action: "login",
      entityType: ENTITY,
      entityId,
      userId: actor.userId,
      userAgent: "U".repeat(400),
      ipAddress: "1".repeat(80),
    });
  });

  const row = await db("audit_logs").where({ entity_type: ENTITY, entity_id: entityId }).first();
  assert.equal(row.user_agent.length, 255);
  assert.equal(row.ip_address.length, 45);
});
