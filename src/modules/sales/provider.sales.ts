import db from "../../utils/db";
// The sales table has been retired: a counter sale is now
// customers -> invoices -> payments -> inventory_transactions. The rows live on
// as sales_legacy so the history stays readable, but nothing writes to them.
const retired = () =>
  Object.assign(new Error("Sales are recorded as invoices now; this endpoint is retired."), { status: 410 });

import { toDateOnly } from "../../utils/date";
import {
  CreateSalePayload,
  UpdateSalePayload,
  SaleDTO,
  SalesSummary,
  SalesMonthlyPoint,
  SalesCategoryPoint,
  SalesProductPoint,
} from "./interface/interface.sales";

const toDTO = (row: any): SaleDTO => {
  const silverWeight = Number(row.silver_weight_grams);
  const rate = Number(row.silver_rate_per_gram);
  const stonePrice = Number(row.stone_price ?? 0);
  const makingCharge = row.source === "bought" ? Number(row.making_charge ?? 0) : 0;
  const silverCost = silverWeight * rate;
  const totalCost = silverCost + stonePrice + makingCharge;
  const soldPrice = Number(row.sold_price);

  return {
    id: row.id,
    ringName: row.ring_name,
    category: row.category,
    jewelryId: row.jewelry_id === null || row.jewelry_id === undefined ? null : Number(row.jewelry_id),
    source: row.source,
    silverWeightGrams: silverWeight,
    silverRatePerGram: rate,
    stoneWeightGrams: row.stone_weight_grams === null ? null : Number(row.stone_weight_grams),
    stonePrice,
    makingCharge,
    soldPrice,
    soldAt: toDateOnly(row.sold_at),
    notes: row.notes,
    silverCost,
    totalCost,
    profit: soldPrice - totalCost,
    createdAt: row.created_at,
  };
};

interface DateRangeFilters {
  from?: string;
  to?: string;
}

interface PageFilters extends DateRangeFilters {
  page: number;
  pageSize: number;
}

const applyDateRange = (query: any, filters: DateRangeFilters) => {
  if (filters.from) query.where("sold_at", ">=", filters.from);
  if (filters.to) query.where("sold_at", "<=", filters.to);
  return query;
};

export const fetchSales = async (filters: DateRangeFilters) => {
  const query = db("sales_legacy").orderBy("sold_at", "desc").orderBy("id", "desc");
  const rows = await applyDateRange(query, filters);
  return rows.map(toDTO);
};

export const listSales = async (filters: PageFilters) => {
  const all = await fetchSales(filters);
  const start = (filters.page - 1) * filters.pageSize;
  return {
    data: all.slice(start, start + filters.pageSize),
    total: all.length,
    page: filters.page,
    pageSize: filters.pageSize,
  };
};

export const getSale = async (id: number) => {
  const row = await db("sales_legacy").where({ id }).first();
  return row ? toDTO(row) : null;
};

const claimJewelry = async (trx: any, jewelryId: number) => {
  const jewelry = await trx("jewelries").where({ id: jewelryId }).first();
  if (!jewelry) {
    throw Object.assign(new Error("Linked jewelry item not found"), { status: 400 });
  }
  if (jewelry.status !== "available") {
    throw Object.assign(new Error(`${jewelry.name} is no longer available`), { status: 409 });
  }
  await trx("jewelries").where({ id: jewelryId }).update({ status: "sold" });
  return jewelry;
};

const releaseJewelry = async (trx: any, jewelryId: number) => {
  await trx("jewelries").where({ id: jewelryId }).update({ status: "available" });
};

export const createSale = async (_data: CreateSalePayload): Promise<never> => {
  throw retired();
};

export const updateSale = async (_id: number, _data: UpdateSalePayload): Promise<never> => {
  throw retired();
};

export const deleteSale = async (_id: number): Promise<never> => {
  throw retired();
};

// Aggregations are pure so a caller that already holds the rows -- the dashboard
// overview -- can reuse them without hitting the sales table again.
export const summarize = (sales: SaleDTO[]): SalesSummary =>
  sales.reduce(
    (acc: SalesSummary, sale: SaleDTO) => ({
      count: acc.count + 1,
      totalRevenue: acc.totalRevenue + sale.soldPrice,
      totalCost: acc.totalCost + sale.totalCost,
      totalProfit: acc.totalProfit + sale.profit,
    }),
    { count: 0, totalRevenue: 0, totalCost: 0, totalProfit: 0 },
  );

export const monthlySeries = (sales: SaleDTO[]): SalesMonthlyPoint[] => {
  const byMonth = new Map<string, SalesMonthlyPoint>();

  for (const sale of sales) {
    const month = sale.soldAt.slice(0, 7);
    const point = byMonth.get(month) ?? { month, revenue: 0, cost: 0, profit: 0 };
    point.revenue += sale.soldPrice;
    point.cost += sale.totalCost;
    point.profit += sale.profit;
    byMonth.set(month, point);
  }

  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
};

export const getSummary = async (filters: DateRangeFilters): Promise<SalesSummary> =>
  summarize(await fetchSales(filters));

export const getMonthlySeries = async (filters: DateRangeFilters): Promise<SalesMonthlyPoint[]> =>
  monthlySeries(await fetchSales(filters));

export const getByCategory = async (filters: DateRangeFilters): Promise<SalesCategoryPoint[]> => {
  const sales = await fetchSales(filters);
  const byCategory = new Map<string, SalesCategoryPoint>();

  for (const sale of sales) {
    const point = byCategory.get(sale.category) ?? { category: sale.category, count: 0, revenue: 0, cost: 0, profit: 0 };
    point.count += 1;
    point.revenue += sale.soldPrice;
    point.cost += sale.totalCost;
    point.profit += sale.profit;
    byCategory.set(sale.category, point);
  }

  return Array.from(byCategory.values()).sort((a, b) => b.revenue - a.revenue);
};

export const getByProduct = async (filters: DateRangeFilters): Promise<SalesProductPoint[]> => {
  const sales = await fetchSales(filters);
  const byName = new Map<string, { name: string; count: number; revenue: number; profit: number }>();

  for (const sale of sales) {
    const key = sale.ringName.trim().toLowerCase();
    const point = byName.get(key) ?? { name: sale.ringName.trim(), count: 0, revenue: 0, profit: 0 };
    point.count += 1;
    point.revenue += sale.soldPrice;
    point.profit += sale.profit;
    byName.set(key, point);
  }

  return Array.from(byName.values())
    .map((p) => ({ ...p, avgPrice: p.revenue / p.count }))
    .sort((a, b) => b.count - a.count);
};
