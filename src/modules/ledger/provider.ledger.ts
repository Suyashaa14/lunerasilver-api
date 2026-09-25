import type { Knex } from "knex";
import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { stampForDate } from "../../utils/fiscalYear";
import { allocateNumber } from "../../services/numbering/service.numbering";

const money = (n: number) => Math.round(n * 100) / 100;

export interface PostingLine {
  /** Account code from the chart of accounts, e.g. "1100". */
  account: string;
  debit?: number;
  credit?: number;
  note?: string;
}

export interface PostingPayload {
  date: string;
  narration: string;
  referenceType?: string;
  referenceId?: number | null;
  lines: PostingLine[];
}

export class UnbalancedEntry extends Error {
  status = 400;
  constructor(debits: number, credits: number) {
    super(`Entry does not balance: debits ${debits}, credits ${credits}. Every entry must net to zero.`);
    this.name = "UnbalancedEntry";
  }
}

export class UnknownAccount extends Error {
  status = 400;
  constructor(code: string) {
    super(`No account with code ${code} in the chart of accounts`);
    this.name = "UnknownAccount";
  }
}

/**
 * Writes one balanced journal entry.
 *
 * Refuses anything that does not balance, because an unbalanced entry makes the
 * trial balance meaningless from that moment on and there is no way to tell
 * later which side was wrong.
 *
 * Takes the caller's transaction so the entry is committed with the document
 * that caused it -- a sale and its posting are one event, not two.
 */
export const postEntry = async (
  trx: Knex.Transaction,
  payload: PostingPayload,
  actor: AuditActor,
): Promise<number> => {
  const lines = payload.lines
    .map((l) => ({ ...l, debit: money(l.debit ?? 0), credit: money(l.credit ?? 0) }))
    // Zero-value lines are dropped rather than rejected: a VAT line is legitimately
    // zero while the shop is not registered, and it should simply not appear.
    .filter((l) => l.debit !== 0 || l.credit !== 0);

  if (lines.length === 0) return 0;

  const debits = money(lines.reduce((s, l) => s + l.debit, 0));
  const credits = money(lines.reduce((s, l) => s + l.credit, 0));
  if (debits !== credits) throw new UnbalancedEntry(debits, credits);

  const codes = [...new Set(lines.map((l) => l.account))];
  const accounts = await trx("accounts").whereIn("code", codes).select("id", "code");
  const byCode = new Map(accounts.map((a: any) => [a.code, Number(a.id)]));
  for (const code of codes) if (!byCode.has(code)) throw new UnknownAccount(code);

  const { fiscalYear, bsDate } = await stampForDate(trx, payload.date);
  const entryNo = await allocateNumber(trx, fiscalYear, "JOURNAL");

  const [entryId] = await trx("journal_entries").insert({
    entry_no: entryNo,
    fiscal_year: fiscalYear,
    entry_date: payload.date,
    entry_date_bs: bsDate,
    narration: payload.narration,
    reference_type: payload.referenceType ?? null,
    reference_id: payload.referenceId ?? null,
    created_by: actor.userId ?? null,
  });

  await trx("journal_entry_lines").insert(
    lines.map((l) => ({
      journal_entry_id: entryId,
      account_id: byCode.get(l.account),
      debit: l.debit,
      credit: l.credit,
      note: l.note ?? null,
    })),
  );

  await writeAuditLog(trx, {
    ...actor,
    action: "create",
    entityType: "journal_entries",
    entityId: entryId,
    newValues: { entry_no: entryNo, narration: payload.narration, debits },
  });

  return entryId as number;
};

export const getEntry = async (id: number) => {
  const entry = await db("journal_entries").where({ id }).first();
  if (!entry) return null;
  const lines = await db("journal_entry_lines as l")
    .join("accounts as a", "a.id", "l.account_id")
    .where("l.journal_entry_id", id)
    .orderBy("l.id")
    .select("l.id", "a.code", "a.name", "l.debit", "l.credit", "l.note");

  return {
    id: entry.id,
    entryNo: entry.entry_no,
    fiscalYear: entry.fiscal_year,
    entryDate: entry.entry_date,
    entryDateBs: entry.entry_date_bs,
    narration: entry.narration,
    referenceType: entry.reference_type,
    referenceId: entry.reference_id === null ? null : Number(entry.reference_id),
    lines: lines.map((l: any) => ({
      id: l.id, account: l.code, accountName: l.name,
      debit: Number(l.debit), credit: Number(l.credit), note: l.note,
    })),
  };
};

export const listEntries = async (filters: { fiscalYear?: string; from?: string; to?: string; limit?: number }) => {
  const query = db("journal_entries").orderBy("entry_date", "desc").orderBy("id", "desc").limit(filters.limit ?? 100);
  if (filters.fiscalYear) query.where({ fiscal_year: filters.fiscalYear });
  if (filters.from) query.where("entry_date", ">=", filters.from);
  if (filters.to) query.where("entry_date", "<=", filters.to);

  const entries = await query;
  const ids = entries.map((e: any) => e.id);
  const totals = ids.length
    ? await db("journal_entry_lines").whereIn("journal_entry_id", ids).groupBy("journal_entry_id")
        .select("journal_entry_id").sum({ debit: "debit" })
    : [];
  const byEntry = new Map(totals.map((t: any) => [Number(t.journal_entry_id), Number(t.debit)]));

  return entries.map((e: any) => ({
    id: e.id,
    entryNo: e.entry_no,
    entryDate: e.entry_date,
    entryDateBs: e.entry_date_bs,
    narration: e.narration,
    referenceType: e.reference_type,
    referenceId: e.reference_id === null ? null : Number(e.reference_id),
    amount: byEntry.get(Number(e.id)) ?? 0,
  }));
};

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}

/**
 * Every account's totals for a period, plus the proof that the books balance:
 * total debits must equal total credits. If they ever differ, something wrote
 * to the ledger outside postEntry.
 */
export const trialBalance = async (filters: { from?: string; to?: string; fiscalYear?: string }) => {
  const query = db("journal_entry_lines as l")
    .join("journal_entries as e", "e.id", "l.journal_entry_id")
    .join("accounts as a", "a.id", "l.account_id")
    .groupBy("a.id", "a.code", "a.name", "a.type")
    .select("a.code", "a.name", "a.type")
    .sum({ debit: "l.debit" })
    .sum({ credit: "l.credit" })
    .orderBy("a.code");

  if (filters.fiscalYear) query.where("e.fiscal_year", filters.fiscalYear);
  if (filters.from) query.where("e.entry_date", ">=", filters.from);
  if (filters.to) query.where("e.entry_date", "<=", filters.to);

  const rows = (await query).map((r: any) => {
    const debit = Number(r.debit);
    const credit = Number(r.credit);
    // Assets and expenses are debit-natured; the rest are credit-natured.
    const debitNatured = r.type === "asset" || r.type === "expense";
    return {
      code: r.code, name: r.name, type: r.type, debit, credit,
      balance: money(debitNatured ? debit - credit : credit - debit),
    } as TrialBalanceRow;
  });

  const totalDebit = money(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = money(rows.reduce((s, r) => s + r.credit, 0));

  return { rows, totalDebit, totalCredit, balances: totalDebit === totalCredit };
};
