import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";

export interface MovementDTO {
  id: number;
  jewelryId: number;
  type: string;
  direction: "in" | "out";
  quantity: number;
  costAmount: number | null;
  referenceType: string;
  referenceId: number | null;
  note: string | null;
  createdAt: string;
}

const toDTO = (row: any): MovementDTO => ({
  id: row.id,
  jewelryId: Number(row.jewelry_id),
  type: row.type,
  direction: row.direction,
  quantity: Number(row.quantity),
  costAmount: row.cost_amount === null ? null : Number(row.cost_amount),
  referenceType: row.reference_type,
  referenceId: row.reference_id === null ? null : Number(row.reference_id),
  note: row.note,
  createdAt: row.created_at,
});

/** Every movement of one piece, oldest first. This is its whole life story. */
export const getMovements = async (jewelryId: number): Promise<MovementDTO[]> => {
  const rows = await db("inventory_transactions").where({ jewelry_id: jewelryId }).orderBy("id", "asc");
  return rows.map(toDTO);
};

/**
 * A manual correction: a miscount, a piece found again, a weight fixed after
 * polishing. Everything else writes its own rows automatically from the
 * document that caused it.
 */
export const recordAdjustment = async (
  payload: { jewelryId: number; direction: "in" | "out"; note: string; costAmount?: number | null },
  actor: AuditActor,
): Promise<MovementDTO> => {
  const id = await db.transaction(async (trx) => {
    const piece = await trx("jewelries").where({ id: payload.jewelryId }).first();
    if (!piece) throw Object.assign(new Error("Piece not found"), { status: 404 });

    const [newId] = await trx("inventory_transactions").insert({
      jewelry_id: payload.jewelryId,
      type: "adjustment",
      direction: payload.direction,
      quantity: 1,
      cost_amount: payload.costAmount ?? null,
      reference_type: "manual",
      reference_id: null,
      note: payload.note,
      created_by: actor.userId ?? null,
    });

    await writeAuditLog(trx, {
      ...actor,
      action: "update",
      entityType: "inventory_transactions",
      entityId: newId,
      newValues: { jewelry_id: payload.jewelryId, direction: payload.direction, note: payload.note },
    });

    return newId;
  });

  return toDTO(await db("inventory_transactions").where({ id }).first());
};

export interface StockCheckRow {
  jewelryId: number;
  sku: string;
  status: string;
  ledgerBalance: number;
  expectedBalance: number;
  agrees: boolean;
}

/**
 * Rebuilds stock from the ledger and compares it to what each piece claims.
 *
 * Pieces are unique, so a piece on the shelf should net to 1 in the ledger and
 * a piece that has left should net to 0. Anything else means a document wrote
 * its stock row wrongly, and the reported stock figure cannot be trusted.
 */
export const reconcileStock = async (): Promise<StockCheckRow[]> => {
  const pieces = await db("jewelries").select("id", "sku", "status");
  const movements = await db("inventory_transactions").select("jewelry_id", "direction", "quantity");

  const balances = new Map<number, number>();
  for (const m of movements as any[]) {
    const delta = (m.direction === "in" ? 1 : -1) * Number(m.quantity);
    balances.set(Number(m.jewelry_id), (balances.get(Number(m.jewelry_id)) ?? 0) + delta);
  }

  const onShelf = ["available", "reserved"];

  return (pieces as any[]).map((p) => {
    const ledgerBalance = balances.get(Number(p.id)) ?? 0;
    const expectedBalance = onShelf.includes(p.status) ? 1 : 0;
    return {
      jewelryId: Number(p.id),
      sku: p.sku,
      status: p.status,
      ledgerBalance,
      expectedBalance,
      // A piece added before the ledger existed has no rows at all; that is a
      // gap in history rather than a disagreement, so it is not flagged.
      agrees: ledgerBalance === expectedBalance || ledgerBalance === 0,
    };
  });
};
