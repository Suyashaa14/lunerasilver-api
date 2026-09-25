import { unguardedDb } from "./db";
import type { AuditActor } from "./audit";

/**
 * A real user id for tests to act as.
 *
 * audit_logs.user_id is a foreign key, so a hardcoded id breaks the moment the
 * seeded admin is recreated with a different one. Resolved from the database
 * instead of assumed.
 */
export const actor: AuditActor = { userId: 0, ipAddress: "::1", userAgent: "test" };

export const resolveActor = async (): Promise<AuditActor> => {
  const admin = await unguardedDb("users").where({ role: "admin" }).first("id");
  if (!admin) throw new Error("No admin user — run `npm run seed` before the tests");
  actor.userId = Number(admin.id);
  return actor;
};
