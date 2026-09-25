import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";

export interface SupplierDTO {
  id: number;
  name: string;
  pan: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  isActive: boolean;
}

export interface SupplierPayload {
  name: string;
  pan?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine?: string | null;
  city?: string | null;
  isActive?: boolean;
}

const toDTO = (row: any): SupplierDTO => ({
  id: row.id,
  name: row.name,
  pan: row.pan,
  phone: row.phone,
  email: row.email,
  addressLine: row.address_line,
  city: row.city,
  isActive: Boolean(row.is_active),
});

const toRow = (data: SupplierPayload) => ({
  name: data.name,
  pan: data.pan ?? null,
  phone: data.phone ?? null,
  email: data.email ?? null,
  address_line: data.addressLine ?? null,
  city: data.city ?? null,
});

export const listSuppliers = async (filters: { search?: string; includeInactive?: boolean }) => {
  const query = db("suppliers").orderBy("name", "asc");
  if (!filters.includeInactive) query.where("is_active", true);
  if (filters.search) {
    const term = `%${filters.search.trim()}%`;
    query.where((q) => q.where("name", "like", term).orWhere("pan", "like", term));
  }
  return (await query).map(toDTO);
};

export const getSupplier = async (id: number): Promise<SupplierDTO | null> => {
  const row = await db("suppliers").where({ id }).first();
  return row ? toDTO(row) : null;
};

export const createSupplier = async (data: SupplierPayload, actor: AuditActor) => {
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx("suppliers").insert(toRow(data));
    await writeAuditLog(trx, { ...actor, action: "create", entityType: "suppliers", entityId: newId, newValues: toRow(data) });
    return newId;
  });
  return getSupplier(id);
};

export const updateSupplier = async (id: number, data: SupplierPayload, actor: AuditActor) => {
  const existing = await db("suppliers").where({ id }).first();
  if (!existing) return null;

  await db.transaction(async (trx) => {
    const next = {
      name: data.name ?? existing.name,
      pan: data.pan === undefined ? existing.pan : data.pan,
      phone: data.phone === undefined ? existing.phone : data.phone,
      email: data.email === undefined ? existing.email : data.email,
      address_line: data.addressLine === undefined ? existing.address_line : data.addressLine,
      city: data.city === undefined ? existing.city : data.city,
      is_active: data.isActive === undefined ? existing.is_active : data.isActive,
    };
    await trx("suppliers").where({ id }).update(next);
    await writeAuditLog(trx, {
      ...actor, action: "update", entityType: "suppliers", entityId: id,
      oldValues: { name: existing.name, is_active: Boolean(existing.is_active) }, newValues: next,
    });
  });

  return getSupplier(id);
};
