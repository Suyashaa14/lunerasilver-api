import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";

export interface UserDTO {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: "admin" | "staff" | "customer";
  isActive: boolean;
}

const toDTO = (row: any): UserDTO => ({
  id: row.id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  role: row.role,
  isActive: Boolean(row.is_active),
});

export const listUsers = async (includeInactive: boolean) => {
  const query = db("users").orderBy("name");
  if (!includeInactive) query.where("is_active", true);
  return (await query).map(toDTO);
};

/** Turns an account off without removing the person from the history. */
export const setActive = async (id: number, isActive: boolean, actor: AuditActor) => {
  const existing = await db("users").where({ id }).first();
  if (!existing) return null;

  if (!isActive && existing.id === actor.userId) {
    throw Object.assign(new Error("You cannot deactivate your own account"), { status: 409 });
  }
  if (!isActive && existing.role === "admin") {
    const admins = await db("users").where({ role: "admin", is_active: true }).count({ c: "*" }).first();
    if (Number((admins as any).c) <= 1) {
      throw Object.assign(new Error("This is the last active admin; promote someone first"), { status: 409 });
    }
  }

  await db.transaction(async (trx) => {
    await trx("users").where({ id }).update({ is_active: isActive });
    await writeAuditLog(trx, {
      ...actor, action: "update", entityType: "users", entityId: id,
      oldValues: { is_active: Boolean(existing.is_active) }, newValues: { is_active: isActive },
    });
  });

  return toDTO(await db("users").where({ id }).first());
};

export const setRole = async (id: number, role: "admin" | "staff" | "customer", actor: AuditActor) => {
  const existing = await db("users").where({ id }).first();
  if (!existing) return null;

  if (existing.role === "admin" && role !== "admin") {
    const admins = await db("users").where({ role: "admin", is_active: true }).count({ c: "*" }).first();
    if (Number((admins as any).c) <= 1) {
      throw Object.assign(new Error("This is the last admin; promote someone first"), { status: 409 });
    }
  }

  await db.transaction(async (trx) => {
    await trx("users").where({ id }).update({ role });
    await writeAuditLog(trx, {
      ...actor, action: "role_change", entityType: "users", entityId: id,
      oldValues: { role: existing.role }, newValues: { role },
    });
  });

  return toDTO(await db("users").where({ id }).first());
};

/**
 * A "delete my account" request. The row stays, because invoices and audit rows
 * point at it; the personal details are replaced so nothing identifying remains.
 */
export const anonymise = async (id: number, actor: AuditActor) => {
  const existing = await db("users").where({ id }).first();
  if (!existing) return null;

  await db.transaction(async (trx) => {
    await trx("users").where({ id }).update({
      name: "Removed account",
      email: `removed-${id}@removed.invalid`,
      phone: null,
      is_active: false,
    });
    await writeAuditLog(trx, {
      ...actor, action: "update", entityType: "users", entityId: id,
      oldValues: { anonymised: false }, newValues: { anonymised: true },
    });
  });

  return toDTO(await db("users").where({ id }).first());
};
