import db from "../../utils/db";
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

const fetchExpenses = async (filters: DateRangeFilters) => {
  const query = db("expenses").orderBy("spent_at", "desc").orderBy("id", "desc");
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
  const [id] = await db("expenses").insert({
    category: data.category,
    amount: data.amount,
    spent_at: data.spentAt,
    note: data.note ?? null,
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

export const deleteExpense = async (id: number) => {
  const existing = await db("expenses").where({ id }).first();
  if (!existing) return false;
  await db("expenses").where({ id }).delete();
  return true;
};

export const getSummary = async (filters: DateRangeFilters): Promise<ExpensesSummary> => {
  const expenses = await fetchExpenses(filters);
  return expenses.reduce(
    (acc: ExpensesSummary, expense: ExpenseDTO) => ({ count: acc.count + 1, totalAmount: acc.totalAmount + expense.amount }),
    { count: 0, totalAmount: 0 },
  );
};

export const getMonthlySeries = async (filters: DateRangeFilters): Promise<ExpensesMonthlyPoint[]> => {
  const expenses = await fetchExpenses(filters);
  const byMonth = new Map<string, number>();

  for (const expense of expenses) {
    const month = expense.spentAt.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + expense.amount);
  }

  return Array.from(byMonth.entries())
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => a.month.localeCompare(b.month));
};

export const getByCategory = async (filters: DateRangeFilters): Promise<ExpensesCategoryPoint[]> => {
  const expenses = await fetchExpenses(filters);
  const byCategory = new Map<string, number>();

  for (const expense of expenses) {
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.amount);
  }

  return Array.from(byCategory.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
};
