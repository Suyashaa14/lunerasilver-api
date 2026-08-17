import db from "../../utils/db";
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

const fetchSales = async (filters: DateRangeFilters) => {
  const query = db("sales").orderBy("sold_at", "desc").orderBy("id", "desc");
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
  const row = await db("sales").where({ id }).first();
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

export const createSale = async (data: CreateSalePayload) => {
  return db.transaction(async (trx) => {
    if (data.jewelryId) {
      await claimJewelry(trx, data.jewelryId);
    }

    const [id] = await trx("sales").insert({
      ring_name: data.ringName,
      category: data.category || "other",
      jewelry_id: data.jewelryId ?? null,
      source: data.source,
      silver_weight_grams: data.silverWeightGrams,
      silver_rate_per_gram: data.silverRatePerGram,
      stone_weight_grams: data.stoneWeightGrams ?? null,
      stone_price: data.stonePrice ?? 0,
      making_charge: data.source === "bought" ? data.makingCharge ?? 0 : 0,
      sold_price: data.soldPrice,
      sold_at: data.soldAt,
      notes: data.notes ?? null,
    });

    const row = await trx("sales").where({ id }).first();
    return toDTO(row);
  });
};

export const updateSale = async (id: number, data: UpdateSalePayload) => {
  return db.transaction(async (trx) => {
    const existing = await trx("sales").where({ id }).first();
    if (!existing) return null;

    const jewelryIdProvided = data.jewelryId !== undefined;
    const oldJewelryId: number | null = existing.jewelry_id;
    const newJewelryId: number | null = jewelryIdProvided ? (data.jewelryId ?? null) : oldJewelryId;

    if (jewelryIdProvided && newJewelryId !== oldJewelryId) {
      if (oldJewelryId) await releaseJewelry(trx, oldJewelryId);
      if (newJewelryId) await claimJewelry(trx, newJewelryId);
    }

    const source = data.source ?? existing.source;
    const update: Record<string, unknown> = {
      ring_name: data.ringName ?? existing.ring_name,
      category: data.category || existing.category,
      jewelry_id: newJewelryId,
      source,
      silver_weight_grams: data.silverWeightGrams ?? existing.silver_weight_grams,
      silver_rate_per_gram: data.silverRatePerGram ?? existing.silver_rate_per_gram,
      stone_weight_grams: data.stoneWeightGrams ?? existing.stone_weight_grams,
      stone_price: data.stonePrice ?? existing.stone_price,
      making_charge: source === "bought" ? data.makingCharge ?? existing.making_charge : 0,
      sold_price: data.soldPrice ?? existing.sold_price,
      sold_at: data.soldAt ?? existing.sold_at,
      notes: data.notes ?? existing.notes,
    };

    await trx("sales").where({ id }).update(update);
    const row = await trx("sales").where({ id }).first();
    return toDTO(row);
  });
};

export const deleteSale = async (id: number) => {
  return db.transaction(async (trx) => {
    const existing = await trx("sales").where({ id }).first();
    if (!existing) return false;
    if (existing.jewelry_id) await releaseJewelry(trx, existing.jewelry_id);
    await trx("sales").where({ id }).delete();
    return true;
  });
};

export const getSummary = async (filters: DateRangeFilters): Promise<SalesSummary> => {
  const sales = await fetchSales(filters);
  return sales.reduce(
    (acc: SalesSummary, sale: SaleDTO) => ({
      count: acc.count + 1,
      totalRevenue: acc.totalRevenue + sale.soldPrice,
      totalCost: acc.totalCost + sale.totalCost,
      totalProfit: acc.totalProfit + sale.profit,
    }),
    { count: 0, totalRevenue: 0, totalCost: 0, totalProfit: 0 },
  );
};

export const getMonthlySeries = async (filters: DateRangeFilters): Promise<SalesMonthlyPoint[]> => {
  const sales = await fetchSales(filters);
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
