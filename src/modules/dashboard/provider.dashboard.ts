import db from "../../utils/db";
import * as invoicesProvider from "../invoices/provider.invoices";
import * as expensesProvider from "../expenses/provider.expenses";

export const getStats = async () => {
  const [profitRow, revenueRow, silverInStockRow, silverSoldRow, orderCounts, jewelryCounts] =
    await Promise.all([
      db("order_items")
        .join("orders", "orders.id", "order_items.order_id")
        .where("orders.status", "completed")
        .sum({ total: "order_items.making_charge_snapshot" })
        .first(),
      db("order_items")
        .join("orders", "orders.id", "order_items.order_id")
        .where("orders.status", "completed")
        .sum({ total: "order_items.unit_price_snapshot" })
        .first(),
      db("jewelries").where({ status: "available" }).sum({ total: "silver_weight_grams" }).first(),
      db("order_items")
        .join("orders", "orders.id", "order_items.order_id")
        .where("orders.status", "completed")
        .sum({ total: "order_items.silver_weight_snapshot" })
        .first(),
      db("orders").select("status").count({ count: "*" }).groupBy("status"),
      db("jewelries").select("status").count({ count: "*" }).groupBy("status"),
    ]);

  const ordersByStatus: Record<string, number> = {};
  for (const row of orderCounts as any[]) ordersByStatus[row.status] = Number(row.count);

  const jewelriesByStatus: Record<string, number> = {};
  for (const row of jewelryCounts as any[]) jewelriesByStatus[row.status] = Number(row.count);

  return {
    totalProfit: Number(profitRow?.total ?? 0),
    totalRevenue: Number(revenueRow?.total ?? 0),
    silverInStockGrams: Number(silverInStockRow?.total ?? 0),
    silverSoldGrams: Number(silverSoldRow?.total ?? 0),
    ordersByStatus,
    jewelriesByStatus,
    totalOrders: Object.values(ordersByStatus).reduce((a, b) => a + b, 0),
  };
};

export interface Alert {
  id: string;
  severity: "critical" | "warning" | "info" | "good";
  icon: string;
  message: string;
}

const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const STALE_STOCK_DAYS = 60;

export const getAlerts = async (): Promise<Alert[]> => {
  const alerts: Alert[] = [];
  const now = new Date();
  const thisMonth = monthKey(now);
  const lastMonth = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const staleCutoff = new Date(now.getTime() - STALE_STOCK_DAYS * 24 * 60 * 60 * 1000);

  const [salesMonthly, expensesMonthly, byProduct, categoryStockRows, staleRow] = await Promise.all([
    invoicesProvider.getMonthlySeries({}),
    expensesProvider.getMonthlySeries({}),
    invoicesProvider.getByProduct({}),
    db("jewelries").where({ status: "available" }).select("category").count({ count: "*" }).groupBy("category"),
    db("jewelries").where({ status: "available" }).where("created_at", "<=", staleCutoff).count({ count: "*" }).first(),
  ]);

  const thisMonthSales = salesMonthly.find((m) => m.month === thisMonth)?.revenue ?? 0;
  const lastMonthSales = salesMonthly.find((m) => m.month === lastMonth)?.revenue ?? 0;
  if (lastMonthSales > 0) {
    const change = ((thisMonthSales - lastMonthSales) / lastMonthSales) * 100;
    if (Math.abs(change) >= 10) {
      alerts.push({
        id: "sales-trend",
        severity: change >= 0 ? "good" : "warning",
        icon: change >= 0 ? "🟢" : "🔴",
        message: `Sales are ${Math.abs(change).toFixed(0)}% ${change >= 0 ? "higher" : "lower"} than last month`,
      });
    }
  }

  const thisMonthExpenses = expensesMonthly.find((m) => m.month === thisMonth)?.amount ?? 0;
  const lastMonthExpenses = expensesMonthly.find((m) => m.month === lastMonth)?.amount ?? 0;
  if (lastMonthExpenses > 0) {
    const change = ((thisMonthExpenses - lastMonthExpenses) / lastMonthExpenses) * 100;
    if (change >= 15) {
      alerts.push({
        id: "expenses-trend",
        severity: "warning",
        icon: "🟡",
        message: `Expenses this month are ${change.toFixed(0)}% higher than last month`,
      });
    }
  }

  if (byProduct.length > 0) {
    const best = byProduct[0];
    alerts.push({
      id: "best-seller",
      severity: "info",
      icon: "🔥",
      message: `${best.name} is your best-selling item (${best.count} sold)`,
    });
  }

  const lowStockCategories = (categoryStockRows as any[])
    .map((r) => ({ category: r.category as string, count: Number(r.count) }))
    .filter((r) => r.count <= 2)
    .sort((a, b) => a.count - b.count)
    .slice(0, 3);

  for (const row of lowStockCategories) {
    alerts.push({
      id: `low-stock-${row.category}`,
      severity: "warning",
      icon: "🟠",
      message: `Only ${row.count} piece${row.count === 1 ? "" : "s"} left in ${row.category}`,
    });
  }

  const staleCount = Number((staleRow as any)?.count ?? 0);
  if (staleCount > 0) {
    alerts.push({
      id: "stale-stock",
      severity: "critical",
      icon: "🔴",
      message: `${staleCount} item${staleCount === 1 ? "" : "s"} unsold for over ${STALE_STOCK_DAYS} days`,
    });
  }

  return alerts;
};

export interface NetProfitPoint {
  month: string;
  netProfit: number;
}

/**
 * Everything the admin dashboard renders, in one response.
 *
 * The page used to make six calls, and sales and expenses were each read from
 * the database twice (once for the summary, once for the monthly series). Here
 * each table is read once and every aggregate is derived from those rows.
 *
 * The per-resource endpoints stay as they are -- the Analytics page needs them
 * separately so it can apply its own date range.
 */
export const getOverview = async () => {
  const [stats, invoices, expenses] = await Promise.all([
    getStats(),
    invoicesProvider.fetchInvoices({}),
    expensesProvider.fetchExpenses({}),
  ]);

  const salesSummary = invoicesProvider.summarize(invoices);
  const expensesSummary = expensesProvider.summarize(expenses);

  // Merge the two monthly series into the single net-profit line the chart draws,
  // so the client does not have to reconcile two sets of month keys.
  const byMonth = new Map<string, number>();
  for (const point of invoicesProvider.monthlySeries(invoices)) {
    byMonth.set(point.month, point.profit);
  }
  for (const point of expensesProvider.monthlySeries(expenses)) {
    byMonth.set(point.month, (byMonth.get(point.month) ?? 0) - point.amount);
  }

  const netProfitTrend: NetProfitPoint[] = Array.from(byMonth.entries())
    .map(([month, netProfit]) => ({ month, netProfit }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    stats,
    sales: salesSummary,
    expenses: expensesSummary,
    expensesByCategory: expensesProvider.categoryBreakdown(expenses),
    netProfitTrend,
    netProfit: salesSummary.totalProfit - expensesSummary.totalAmount,
  };
};
