import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { allocateNumber, resolveFiscalYear } from "../../services/numbering/service.numbering";
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

export const createExpense = async (data: CreateExpensePayload) => {
  const id = await db.transaction(async (trx) => {
    // The number comes from the shared gapless allocator, inside this same
    // transaction: if the insert fails, the number is handed back rather than
    // leaving a hole in the sequence.
    const fiscalYear = await resolveFiscalYear(trx, data.spentAt);
    const expenseNo = await allocateNumber(trx, fiscalYear, "EXPENSE");

    const [newId] = await trx("expenses").insert({
      expense_no: expenseNo,
      category: data.category,
      amount: data.amount,
      // Not VAT-registered, so the whole amount is taxable and VAT is zero.
      // When registration happens this splits properly -- see D2 in the plan.
      taxable_amount: data.amount,
      vat_amount: 0,
      spent_at: data.spentAt,
      fiscal_year: fiscalYear,
      note: data.note ?? null,
    });

    return newId;
  });

  return getExpense(id);
};

export const updateExpense = async (id: number, data: UpdateExpensePayload) => {
  const existing = await db("expenses").where({ id }).first();
  if (!existing) return null;

  const update: Record<string, unknown> = {
    category: data.category ?? existing.category,
    amount: data.amount ?? existing.amount,
    spent_at: data.spentAt ?? existing.spent_at,
    note: data.note ?? existing.note,
  };

  await db("expenses").where({ id }).update(update);
  return getExpense(id);
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
