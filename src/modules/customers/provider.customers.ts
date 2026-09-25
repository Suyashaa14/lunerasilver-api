import type { Knex } from "knex";
import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import {
  CustomerDTO,
  CreateCustomerPayload,
  UpdateCustomerPayload,
  ListCustomerFilters,
} from "./interface/interface.customers";

const toDTO = (row: any): CustomerDTO => ({
  id: row.id,
  userId: row.user_id === null || row.user_id === undefined ? null : Number(row.user_id),
  name: row.name,
  phone: row.phone,
  email: row.email,
  pan: row.pan,
  addressLine: row.address_line,
  city: row.city,
  createdAt: row.created_at,
});

/**
 * Phone is the only thing a walk-in reliably gives you, so it is what a repeat
 * visit is matched on. Stored stripped of spaces, dashes and brackets, because
 * "980-000 0000" and "9800000000" are the same person and an exact match on the
 * raw text would quietly create a second record.
 */
export const normalizePhone = (phone?: string | null): string | null => {
  if (phone === null || phone === undefined) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.length === 0 ? null : digits;
};

const toRow = (data: CreateCustomerPayload | UpdateCustomerPayload) => ({
  name: data.name,
  phone: normalizePhone(data.phone),
  email: data.email ?? null,
  pan: data.pan ?? null,
  address_line: data.addressLine ?? null,
  city: data.city ?? null,
});

export const listCustomers = async (filters: ListCustomerFilters) => {
  const base = db("customers");
  if (filters.search) {
    const term = `%${filters.search.trim()}%`;
    base.where((q) => q.where("name", "like", term).orWhere("phone", "like", term).orWhere("email", "like", term));
  }

  const countRow = await base.clone().count({ c: "*" }).first();
  const rows = await base
    .clone()
    .orderBy("name", "asc")
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  return {
    data: rows.map(toDTO),
    total: Number((countRow as { c: number | string }).c),
    page: filters.page,
    pageSize: filters.pageSize,
  };
};

export const getCustomer = async (id: number): Promise<CustomerDTO | null> => {
  const row = await db("customers").where({ id }).first();
  return row ? toDTO(row) : null;
};

export const createCustomer = async (data: CreateCustomerPayload, actor: AuditActor) => {
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx("customers").insert({ ...toRow(data), user_id: data.userId ?? null });
    await writeAuditLog(trx, {
      ...actor,
      action: "create",
      entityType: "customers",
      entityId: newId,
      newValues: toRow(data),
    });
    return newId;
  });

  return getCustomer(id);
};

export const updateCustomer = async (id: number, data: UpdateCustomerPayload, actor: AuditActor) => {
  const existing = await db("customers").where({ id }).first();
  if (!existing) return null;

  await db.transaction(async (trx) => {
    const next = {
      name: data.name ?? existing.name,
      phone: data.phone === undefined ? existing.phone : normalizePhone(data.phone),
      email: data.email === undefined ? existing.email : data.email,
      pan: data.pan === undefined ? existing.pan : data.pan,
      address_line: data.addressLine === undefined ? existing.address_line : data.addressLine,
      city: data.city === undefined ? existing.city : data.city,
    };

    await trx("customers").where({ id }).update(next);
    await writeAuditLog(trx, {
      ...actor,
      action: "update",
      entityType: "customers",
      entityId: id,
      oldValues: {
        name: existing.name,
        phone: existing.phone,
        email: existing.email,
        pan: existing.pan,
        address_line: existing.address_line,
        city: existing.city,
      },
      newValues: next,
    });
  });

  return getCustomer(id);
};

/**
 * The counter-sale path: one call that reuses the buyer if we have seen their
 * number before, and creates them if not.
 *
 * Takes a connection so invoice issuing can run it inside the same transaction
 * as the invoice, rather than leaving a stray customer behind if the sale fails.
 *
 * With no phone there is nothing to match on, so a new record is created rather
 * than guessing. Merging anonymous buyers would put one person's purchases on
 * another person's account.
 */
export const findOrCreateByPhone = async (
  conn: Knex | Knex.Transaction,
  data: CreateCustomerPayload,
  actor: AuditActor,
): Promise<CustomerDTO> => {
  const phone = normalizePhone(data.phone);

  if (phone) {
    const existing = await conn("customers").where({ phone }).orderBy("id", "desc").first();
    if (existing) return toDTO(existing);
  }

  const [id] = await conn("customers").insert({ ...toRow(data), phone, user_id: data.userId ?? null });

  if ((conn as Knex.Transaction).isTransaction) {
    await writeAuditLog(conn as Knex.Transaction, {
      ...actor,
      action: "create",
      entityType: "customers",
      entityId: id,
      newValues: { ...toRow(data), phone },
    });
  }

  const row = await conn("customers").where({ id }).first();
  return toDTO(row);
};

/** The storefront path: one customer per login, reused on every later order. */
export const findOrCreateForUser = async (
  trx: Knex.Transaction,
  userId: number,
  fallback: CreateCustomerPayload,
): Promise<number> => {
  const existing = await trx("customers").where({ user_id: userId }).first("id");
  if (existing) return existing.id as number;

  const user = await trx("users").where({ id: userId }).first("name", "email", "phone");
  const [id] = await trx("customers").insert({
    user_id: userId,
    name: fallback.name || user?.name || "Customer",
    phone: normalizePhone(fallback.phone ?? user?.phone),
    email: user?.email ?? null,
    address_line: fallback.addressLine ?? null,
    city: fallback.city ?? null,
  });
  return id as number;
};
