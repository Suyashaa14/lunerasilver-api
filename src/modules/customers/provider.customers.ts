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
    if (existing) {
      // A repeat buyer keeps the record they already have, but details taken at
      // the counter this time are worth keeping. Only blanks are filled -- never
      // an overwrite, because the stored value may be the corrected one.
      const fill: Record<string, string> = {};
      const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
      if (blank(existing.address_line) && !blank(data.addressLine)) fill.address_line = data.addressLine as string;
      if (blank(existing.city) && !blank(data.city)) fill.city = data.city as string;
      if (blank(existing.email) && !blank(data.email)) fill.email = data.email as string;
      if (blank(existing.pan) && !blank(data.pan)) fill.pan = data.pan as string;

      if (Object.keys(fill).length === 0) return toDTO(existing);

      await conn("customers").where({ id: existing.id }).update(fill);
      if ((conn as Knex.Transaction).isTransaction) {
        await writeAuditLog(conn as Knex.Transaction, {
          ...actor,
          action: "update",
          entityType: "customers",
          entityId: existing.id,
          newValues: fill,
        });
      }
      return toDTO(await conn("customers").where({ id: existing.id }).first());
    }
  }

  let id: number;
  try {
    [id] = await conn("customers").insert({ ...toRow(data), phone, user_id: data.userId ?? null });
  } catch (err: any) {
    // Two sales for the same new buyer saved at the same instant: the second
    // insert waits on the unique index, then fails. The buyer exists now, so
    // use them rather than failing the sale. A locking read is needed here --
    // a plain one would still be reading this transaction's older snapshot.
    if (err?.code !== "ER_DUP_ENTRY" || !phone) throw err;
    const raced = await conn("customers").where({ phone }).forUpdate().first();
    if (!raced) throw err;
    return toDTO(raced);
  }

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

/**
 * Everything this customer has ever bought, piece by piece.
 *
 * Read from invoice lines rather than from the catalogue, so it still reads
 * correctly years later: the snapshot on the line is what was sold and what was
 * charged, whatever has happened to the piece or the silver rate since.
 *
 * Void invoices and credited lines are kept but marked. A return is part of a
 * customer's history, not something to hide from it.
 */
export const getCustomerPurchases = async (customerId: number) => {
  const rows = await db("invoice_items as it")
    .join("invoices as i", "i.id", "it.invoice_id")
    .where("i.customer_id", customerId)
    .where("i.series", "SALES")
    .orderBy("i.issued_at", "desc")
    .orderBy("it.id", "desc")
    .select(
      "it.id",
      "it.jewelry_id",
      "it.name_snapshot",
      "it.sku_snapshot",
      "it.category_snapshot",
      "it.silver_weight_snapshot",
      "it.unit_price",
      "it.discount",
      "it.line_total",
      "i.id as invoice_id",
      "i.invoice_no",
      "i.issued_at",
      "i.issued_date_bs",
      "i.is_void",
      db.raw(
        `COALESCE((SELECT SUM(cni.amount) FROM credit_note_items cni
                   WHERE cni.invoice_item_id = it.id), 0) AS credited`,
      ),
    );

  const items = rows.map((r: any) => {
    const lineTotal = Number(r.line_total);
    const credited = Number(r.credited);
    const isVoid = Boolean(r.is_void);
    return {
      id: Number(r.id),
      jewelryId: r.jewelry_id === null ? null : Number(r.jewelry_id),
      name: r.name_snapshot,
      sku: r.sku_snapshot,
      category: r.category_snapshot,
      silverWeightGrams: r.silver_weight_snapshot === null ? null : Number(r.silver_weight_snapshot),
      unitPrice: Number(r.unit_price),
      discount: Number(r.discount),
      lineTotal,
      credited,
      // What the customer actually kept and paid for.
      netAmount: isVoid ? 0 : Math.round((lineTotal - credited) * 100) / 100,
      isVoid,
      isReturned: !isVoid && credited >= lineTotal,
      invoice: { id: Number(r.invoice_id), invoiceNo: r.invoice_no },
      issuedAt: r.issued_at,
      issuedDateBs: r.issued_date_bs,
    };
  });

  const kept = items.filter((i) => !i.isVoid && !i.isReturned);

  return {
    items,
    summary: {
      piecesBought: kept.length,
      totalSpent: Math.round(items.reduce((sum, i) => sum + i.netAmount, 0) * 100) / 100,
      silverGrams: Math.round(kept.reduce((sum, i) => sum + (i.silverWeightGrams ?? 0), 0) * 1000) / 1000,
      firstBoughtAt: items.length > 0 ? items[items.length - 1].issuedAt : null,
      lastBoughtAt: items.length > 0 ? items[0].issuedAt : null,
    },
  };
};
