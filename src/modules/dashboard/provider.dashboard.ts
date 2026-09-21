import db from "../../utils/db";
import * as invoicesProvider from "../invoices/provider.invoices";
import * as expensesProvider from "../expenses/provider.expenses";
import { PeriodKey, resolvePeriod } from "../../utils/period";

interface Range {
  from: string;
  to: string;
}

const endOfDay = (to: string) => `${to} 23:59:59`;

/**
 * Online-store figures. These come from orders, which is a different revenue
 * path from the counter -- the dashboard shows them apart rather than adding
 * them together, because they reconcile against different documents.
 */
export const getStats = async (range?: Range) => {
  const completed = () => {
    const q = db("order_items")
      .join("orders", "orders.id", "order_items.order_id")
      .where("orders.status", "completed");
    if (range) q.whereBetween("orders.created_at", [range.from, endOfDay(range.to)]);
    return q;
  };

  const orderCountQuery = db("orders").select("status").count({ count: "*" }).groupBy("status");
  if (range) orderCountQuery.whereBetween("created_at", [range.from, endOfDay(range.to)]);

  const [profitRow, revenueRow, silverInStockRow, silverSoldRow, orderCounts, jewelryCounts] =
    await Promise.all([
      completed().sum({ total: "order_items.making_charge_snapshot" }).first(),
      completed().sum({ total: "order_items.unit_price_snapshot" }).first(),
      // Stock is a present-tense figure: what is in the case right now, not
      // what was in it during the period.
      db("jewelries").where({ status: "available" }).sum({ total: "silver_weight_grams" }).first(),
      completed().sum({ total: "order_items.silver_weight_snapshot" }).first(),
      orderCountQuery,
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
  /** One line, the finding itself. */
  message: string;
  /** One line, why it matters. Rendered under the message. */
  detail: string;
  /** Where the alert sends you to act on it. */
  action: { label: string; href: string };
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const STALE_STOCK_DAYS = 60;

export const getAlerts = async (): Promise<Alert[]> => {
  const alerts: Alert[] = [];
  const now = new Date();
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonth = monthKey(now);
  const lastMonth = monthKey(lastMonthDate);
  const staleCutoff = new Date(now.getTime() - STALE_STOCK_DAYS * 24 * 60 * 60 * 1000);

  const [salesMonthly, expensesMonthly, byProduct, categoryStockRows, staleRow] = await Promise.all([
    invoicesProvider.getMonthlySeries({}),
    expensesProvider.getMonthlySeries({}),
    invoicesProvider.getByProduct({}),
    db("jewelries").where({ status: "available" }).select("category").count({ count: "*" }).groupBy("category"),
    db("jewelries").where({ status: "available" }).where("created_at", "<=", staleCutoff).count({ count: "*" }).first(),
  ]);

  const staleCount = Number((staleRow as any)?.count ?? 0);
  if (staleCount > 0) {
    alerts.push({
      id: "stale-stock",
      severity: "critical",
      icon: "🔴",
      message: `${staleCount} item${staleCount === 1 ? "" : "s"} unsold for over ${STALE_STOCK_DAYS} days`,
      detail: "Cash tied up in the display case",
      action: { label: "View items", href: "/admin/jewelries" },
    });
  }

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
        detail: `${MONTH_NAMES[now.getMonth()]} compared with ${MONTH_NAMES[lastMonthDate.getMonth()]}`,
        action: { label: "View sales", href: "/admin/sales" },
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
        detail: `${MONTH_NAMES[now.getMonth()]} compared with ${MONTH_NAMES[lastMonthDate.getMonth()]}`,
        action: { label: "View expenses", href: "/admin/expenses" },
      });
    }
  }

  const lowStockCategories = (categoryStockRows as any[])
    .map((r) => ({ category: r.category as string, count: Number(r.count) }))
    .filter((r) => r.count <= 2)
    .sort((a, b) => a.count - b.count)
    .slice(0, 3);

  lowStockCategories.forEach((row, index) => {
    alerts.push({
      id: `low-stock-${row.category}`,
      severity: "warning",
      icon: "🟠",
      message: `Only ${row.count} piece${row.count === 1 ? "" : "s"} left in ${row.category}`,
      detail: index === 0 ? "Lowest stock of any category" : "Running low",
      action: { label: `View ${row.category}`, href: "/admin/jewelries" },
    });
  });

  if (byProduct.length > 0) {
    const best = byProduct[0];
    alerts.push({
      id: "best-seller",
      severity: "info",
      icon: "🔥",
      message: `${best.name} is your best seller`,
      detail: `${best.count} sold this period`,
      action: { label: "Make more like it", href: "/admin/jewelries/new" },
    });
  }

  return alerts;
};

export interface NetProfitPoint {
  month: string;
  netProfit: number;
}

/**
 * Everything the dashboard renders, in one response.
 *
 * The stat blocks are scoped to the selected period; the trend chart is not --
 * it shows every month on record, because its job is to give the period a
 * shape to sit against.
 */
export const getOverview = async (periodKey: PeriodKey) => {
  const period = resolvePeriod(periodKey);
  const range = { from: period.from, to: period.to };

  const [business, stats, periodInvoices, periodExpenses, allInvoices, allExpenses] = await Promise.all([
    db("business_profile").first("trade_name", "legal_name"),
    getStats(range),
    invoicesProvider.fetchInvoices(range),
    expensesProvider.fetchExpenses(range),
    invoicesProvider.fetchInvoices({}),
    expensesProvider.fetchExpenses({}),
  ]);

  const counterSales = invoicesProvider.summarize(periodInvoices);
  const counterExpenses = expensesProvider.summarize(periodExpenses);
  const expensesByCategory = expensesProvider.categoryBreakdown(periodExpenses);

  // Trend spans every month with activity, sales less expenses.
  const byMonth = new Map<string, number>();
  for (const point of invoicesProvider.monthlySeries(allInvoices)) {
    byMonth.set(point.month, point.profit);
  }
  for (const point of expensesProvider.monthlySeries(allExpenses)) {
    byMonth.set(point.month, (byMonth.get(point.month) ?? 0) - point.amount);
  }
  const netProfitTrend: NetProfitPoint[] = Array.from(byMonth.entries())
    .map(([month, netProfit]) => ({ month, netProfit }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    business: { name: business?.trade_name || business?.legal_name || "Lunera Silver" },
    period,
    counter: {
      saleCount: counterSales.count,
      expenseCount: counterExpenses.count,
      revenue: counterSales.totalRevenue,
      cost: counterSales.totalCost,
      grossProfit: counterSales.totalProfit,
      expenses: counterExpenses.totalAmount,
      netProfit: counterSales.totalProfit - counterExpenses.totalAmount,
    },
    expensesByCategory,
    netProfitTrend,
    store: {
      orderRevenue: stats.totalRevenue,
      makingCharges: stats.totalProfit,
      silverSoldGrams: stats.silverSoldGrams,
      totalOrders: stats.totalOrders,
      silverInStockGrams: stats.silverInStockGrams,
      piecesListed: stats.jewelriesByStatus.available ?? 0,
      ordersByStatus: stats.ordersByStatus,
    },
  };
};
