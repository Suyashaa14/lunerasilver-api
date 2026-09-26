import db from "../../utils/db";
import { hashPassword } from "../../utils/password";
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

/**
 * Creates a staff or admin account directly.
 *
 * Deliberately separate from public signup, which only ever makes a customer.
 * Access to the shop's books is granted by the owner, never claimed by
 * whoever fills in a form.
 */
export const createUser = async (
  data: { name: string; email: string; password: string; role: "admin" | "staff" },
  actor: AuditActor,
) => {
  const existing = await db("users").where({ email: data.email }).first("id");
  if (existing) {
    throw Object.assign(new Error("That email already has an account"), { status: 409 });
  }

  const id = await db.transaction(async (trx) => {
    const [newId] = await trx("users").insert({
      name: data.name,
      email: data.email,
      password_hash: await hashPassword(data.password),
      role: data.role,
      is_active: true,
    });

    await writeAuditLog(trx, {
      ...actor,
      action: "create",
      entityType: "users",
      entityId: newId,
      // The password is redacted by writeAuditLog, but it is never passed here anyway.
      newValues: { name: data.name, email: data.email, role: data.role },
    });

    return newId;
  });

  const row = await db("users").where({ id }).first();
  return toDTO(row);
};
