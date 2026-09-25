import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { allocateNumber } from "../../services/numbering/service.numbering";
import { stampForDate, assertFiscalYearOpen } from "../../utils/fiscalYear";
import { postExpense } from "../ledger/provider.posting";
import { toDateOnly } from "../../utils/date";
import {
  CreateExpensePayload,
  UpdateExpensePayload,
  ExpenseDTO,
  ExpensesSummary,
  ExpensesMonthlyPoint,
  ExpensesCategoryPoint,
} from "./interface/interface.expenses";

const toDTO = (row: any): ExpenseDTO => ({
  id: row.id,
  category: row.category,
  amount: Number(row.amount),
  spentAt: toDateOnly(row.spent_at),
  note: row.note,
  createdAt: row.created_at,
});

interface DateRangeFilters {
  from?: string;
  to?: string;
}

interface PageFilters extends DateRangeFilters {
  page: number;
  pageSize: number;
}

const applyDateRange = (query: any, filters: DateRangeFilters) => {
  if (filters.from) query.where("spent_at", ">=", filters.from);
  if (filters.to) query.where("spent_at", "<=", filters.to);
  return query;
};

export const fetchExpenses = async (filters: DateRangeFilters) => {
  // Voided expenses stay in the table for the history, but they are cancelled,
  // so they must not reach a summary, a chart or a tax return.
  const query = db("expenses").where("is_void", false).orderBy("spent_at", "desc").orderBy("id", "desc");
  const rows = await applyDateRange(query, filters);
  return rows.map(toDTO);
};

export const listExpenses = async (filters: PageFilters) => {
  const all = await fetchExpenses(filters);
  const start = (filters.page - 1) * filters.pageSize;
  return {
    data: all.slice(start, start + filters.pageSize),
    total: all.length,
    page: filters.page,
    pageSize: filters.pageSize,
  };
};

export const getExpense = async (id: number) => {
  const row = await db("expenses").where({ id }).first();
  return row ? toDTO(row) : null;
};

export const createExpense = async (data: CreateExpensePayload, actor: AuditActor = {}) => {
  const id = await db.transaction(async (trx) => {
    // The number comes from the shared gapless allocator, inside this same
    // transaction: if the insert fails, the number is handed back rather than
    // leaving a hole in the sequence.
    // Stamps the period and the BS date, and refuses a closed year.
    const { fiscalYear, bsDate } = await stampForDate(trx, data.spentAt);
    const expenseNo = await allocateNumber(trx, fiscalYear, "EXPENSE");

    const [newId] = await trx("expenses").insert({
      expense_no: expenseNo,
      category: data.category,
      supplier_id: data.supplierId ?? null,
      bill_no: data.billNo ?? null,
      payment_method: data.paymentMethod ?? null,
      payment_reference: data.paymentReference ?? null,
      receipt_document_id: data.receiptDocumentId ?? null,
      amount: data.amount,
      // taxable + vat always add back to `amount`, the gross actually paid.
      // Not VAT-registered yet, so vat is zero and taxable is the whole figure.
      taxable_amount: data.vatAmount !== undefined ? data.amount - data.vatAmount : data.amount,
      vat_amount: data.vatAmount ?? 0,
      spent_at: data.spentAt,
      spent_at_bs: bsDate,
      fiscal_year: fiscalYear,
      note: data.note ?? null,
    });

    await postExpense(trx, {
      id: newId, expense_no: expenseNo, spent_at: data.spentAt,
      taxable_amount: data.vatAmount !== undefined ? data.amount - data.vatAmount : data.amount,
      vat_amount: data.vatAmount ?? 0,
      amount: data.amount,
      payment_method: data.paymentMethod ?? null,
    }, actor);

    return newId;
  });

  return getExpense(id);
};

export const updateExpense = async (id: number, data: UpdateExpensePayload) => {
  const existing = await db("expenses").where({ id }).first();
  if (!existing) return null;

  if (existing.is_void) {
    throw Object.assign(new Error("This expense is voided and can no longer be edited"), { status: 409 });
  }

  return db.transaction(async (trx) => {
    // The year the row is already in has to be open, or a signed-off period
    // could be changed after the fact.
    if (existing.fiscal_year) await assertFiscalYearOpen(trx, existing.fiscal_year);

    const spentAt = data.spentAt ?? existing.spent_at;
    // Re-stamped on every write. Moving the date to another fiscal year moves
    // the stamp with it -- and is refused if that year is closed.
    const { fiscalYear, bsDate } = await stampForDate(trx, spentAt);
    const amount = data.amount ?? existing.amount;

    await trx("expenses").where({ id }).update({
      category: data.category ?? existing.category,
      amount,
      taxable_amount: amount,
      spent_at: spentAt,
      spent_at_bs: bsDate,
      fiscal_year: fiscalYear,
      note: data.note ?? existing.note,
    });

    return getExpense(id);
  });
};

/**
 * Cancels an expense without removing it.
 *
 * The row stays and keeps its number, so a gap never appears in the sequence;
 * it simply stops counting. The reason and the person are recorded, and the
 * audit row is written in the same transaction as the change.
 */
export const voidExpense = async (id: number, reason: string, actor: AuditActor) => {
  const existing = await db("expenses").where({ id }).first();
  if (!existing) return null;

  if (existing.is_void) {
    throw Object.assign(new Error("This expense is already voided"), { status: 409 });
  }

  await db.transaction(async (trx) => {
    await trx("expenses").where({ id }).update({
      is_void: true,
      void_reason: reason,
      voided_by: actor.userId ?? null,
      voided_at: trx.fn.now(),
    });

    await writeAuditLog(trx, {
      ...actor,
      action: "void",
      entityType: "expenses",
      entityId: id,
      oldValues: { is_void: false },
      newValues: { is_void: true, void_reason: reason },
    });
  });

  const row = await db("expenses").where({ id }).first();
  return toDTO(row);
};

// Aggregations are pure so a caller that already holds the rows -- the dashboard
// overview -- can reuse them without hitting the expenses table again.
export const summarize = (expenses: ExpenseDTO[]): ExpensesSummary =>
  expenses.reduce(
    (acc: ExpensesSummary, expense: ExpenseDTO) => ({ count: acc.count + 1, totalAmount: acc.totalAmount + expense.amount }),
    { count: 0, totalAmount: 0 },
  );

export const monthlySeries = (expenses: ExpenseDTO[]): ExpensesMonthlyPoint[] => {
  const byMonth = new Map<string, number>();

  for (const expense of expenses) {
    const month = expense.spentAt.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + expense.amount);
  }

  return Array.from(byMonth.entries())
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => a.month.localeCompare(b.month));
};

export const categoryBreakdown = (expenses: ExpenseDTO[]): ExpensesCategoryPoint[] => {
  const byCategory = new Map<string, number>();

  for (const expense of expenses) {
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.amount);
  }

  return Array.from(byCategory.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
};

export const getSummary = async (filters: DateRangeFilters): Promise<ExpensesSummary> =>
  summarize(await fetchExpenses(filters));

export const getMonthlySeries = async (filters: DateRangeFilters): Promise<ExpensesMonthlyPoint[]> =>
  monthlySeries(await fetchExpenses(filters));

export const getByCategory = async (filters: DateRangeFilters): Promise<ExpensesCategoryPoint[]> =>
  categoryBreakdown(await fetchExpenses(filters));
