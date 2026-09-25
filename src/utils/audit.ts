import type { Knex } from "knex";
import type { Request } from "express";

export type AuditAction = "create" | "update" | "void" | "login" | "role_change";

/** Who did it and from where. Built from the request at the route boundary. */
export interface AuditActor {
  userId?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry extends AuditActor {
  action: AuditAction;
  /** The table the row lives in, e.g. "invoices". */
  entityType: string;
  entityId: number;
  oldValues?: unknown;
  newValues?: unknown;
}

// Column widths from the migration. Truncating here beats a write that throws
// halfway through a financial transaction because a browser sent a long UA.
const IP_MAX = 45;
const USER_AGENT_MAX = 255;
const ENTITY_TYPE_MAX = 60;

// Never copy a credential into a log that is deliberately never deleted.
const REDACTED_KEYS = ["password", "password_hash", "passwordHash", "token", "jwt", "secret"];

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.includes(key) ? "[redacted]" : redact(val);
  }
  return out;
};

const clip = (value: string | null | undefined, max: number): string | null =>
  value === null || value === undefined ? null : value.slice(0, max);

/** Pulls the actor out of an Express request. */
export const auditActor = (req: Request): AuditActor => ({
  userId: req.user?.id ?? null,
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

/**
 * Writes one audit row.
 *
 * The transaction is the first argument and is typed `Knex.Transaction`, not
 * `Knex` -- passing the root connection is a compile error. That is the whole
 * point: an audit row must live or die with the change it describes, so it can
 * never be committed while the change rolls back, or the reverse.
 *
 * Callers must not await this outside the transaction that made the change.
 */
export const writeAuditLog = async (trx: Knex.Transaction, entry: AuditEntry): Promise<void> => {
  await trx("audit_logs").insert({
    user_id: entry.userId ?? null,
    action: entry.action,
    entity_type: clip(entry.entityType, ENTITY_TYPE_MAX),
    entity_id: entry.entityId,
    old_values: entry.oldValues === undefined ? null : JSON.stringify(redact(entry.oldValues)),
    new_values: entry.newValues === undefined ? null : JSON.stringify(redact(entry.newValues)),
    ip_address: clip(entry.ipAddress, IP_MAX),
    user_agent: clip(entry.userAgent, USER_AGENT_MAX),
  });
};
