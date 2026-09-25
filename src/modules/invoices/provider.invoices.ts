import db from "../../utils/db";

export interface DateRangeFilters {
  from?: string;
  to?: string;
}

export interface InvoiceRow {
  id: number;
  issuedAt: string;
  /** Net of any credit notes raised against this invoice. */
  revenue: number;
  cost: number;
  profit: number;
}

export interface InvoiceSummary {
  count: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
}

export interface InvoiceMonthlyPoint {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
}

export interface ProductPoint {
  name: string;
  count: number;
  revenue: number;
}

/**
 * Revenue now comes from issued invoices rather than the retired sales table.
 *
 * Two corrections are folded in that the old table could not express:
 * void invoices are excluded outright, and credit notes are subtracted, so a
 * returned sale stops counting as revenue without anything being edited or
 * deleted. Cost of goods is the cost_amount recorded on the outbound stock
 * ledger rows for the invoice -- a snapshot taken at sale time, so re-pricing a
 * piece later never rewrites a past margin.
 */
export const fetchInvoices = async (filters: DateRangeFilters): Promise<InvoiceRow[]> => {
  const query = db("invoices as i")
    .where("i.is_void", false)
    .where("i.series", "SALES")
    .select("i.id", "i.issued_at", "i.total_amount")
    .select(
      db.raw(
        `COALESCE((SELECT SUM(it.cost_amount) FROM inventory_transactions it
                   WHERE it.reference_type = 'invoice' AND it.reference_id = i.id
                     AND it.direction = 'out'), 0) AS cogs`,
      ),
    )
    .select(
      db.raw(
        `COALESCE((SELECT SUM(cn.total_amount) FROM credit_notes cn
                   WHERE cn.invoice_id = i.id), 0) AS credited`,
      ),
    )
    .orderBy("i.issued_at", "desc")
    .orderBy("i.id", "desc");

  if (filters.from) query.where("i.issued_at", ">=", filters.from);
  if (filters.to) query.where("i.issued_at", "<=", `${filters.to} 23:59:59`);

  const rows = await query;

  return rows.map((row: any) => {
    const revenue = Number(row.total_amount) - Number(row.credited);
    const cost = Number(row.cogs);
    return {
      id: row.id,
      issuedAt: new Date(row.issued_at).toISOString(),
      revenue,
      cost,
      profit: revenue - cost,
    };
  });
};

// Pure, so the dashboard overview can derive every aggregate from one read.
export const summarize = (invoices: InvoiceRow[]): InvoiceSummary =>
  invoices.reduce(
    (acc: InvoiceSummary, inv: InvoiceRow) => ({
      count: acc.count + 1,
      totalRevenue: acc.totalRevenue + inv.revenue,
      totalCost: acc.totalCost + inv.cost,
      totalProfit: acc.totalProfit + inv.profit,
    }),
    { count: 0, totalRevenue: 0, totalCost: 0, totalProfit: 0 },
  );

export const monthlySeries = (invoices: InvoiceRow[]): InvoiceMonthlyPoint[] => {
  const byMonth = new Map<string, InvoiceMonthlyPoint>();

  for (const inv of invoices) {
    const month = inv.issuedAt.slice(0, 7);
    const point = byMonth.get(month) ?? { month, revenue: 0, cost: 0, profit: 0 };
    point.revenue += inv.revenue;
    point.cost += inv.cost;
    point.profit += inv.profit;
    byMonth.set(month, point);
  }

  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
};

export const getSummary = async (filters: DateRangeFilters): Promise<InvoiceSummary> =>
  summarize(await fetchInvoices(filters));

export const getMonthlySeries = async (filters: DateRangeFilters): Promise<InvoiceMonthlyPoint[]> =>
  monthlySeries(await fetchInvoices(filters));

export const getByProduct = async (filters: DateRangeFilters): Promise<ProductPoint[]> => {
  const query = db("invoice_items as ii")
    .join("invoices as i", "i.id", "ii.invoice_id")
    .where("i.is_void", false)
    .where("i.series", "SALES")
    .groupBy("ii.name_snapshot")
    .select("ii.name_snapshot as name")
    .sum({ count: "ii.quantity" })
    .sum({ revenue: "ii.line_total" })
    .orderBy("count", "desc");

  if (filters.from) query.where("i.issued_at", ">=", filters.from);
  if (filters.to) query.where("i.issued_at", "<=", `${filters.to} 23:59:59`);

  const rows = await query;
  return rows.map((r: any) => ({ name: r.name, count: Number(r.count), revenue: Number(r.revenue) }));
};

export interface CategoryPoint {
  category: string;
  amount: number;
  count: number;
}

/**
 * Sales split by category, from the snapshot on the line rather than a join to
 * the catalogue -- a piece recategorised today must not move a sale made last
 * year. Lines written before the snapshot column existed report as "unknown".
 */
export const getByCategory = async (filters: DateRangeFilters): Promise<CategoryPoint[]> => {
  const query = db("invoice_items as ii")
    .join("invoices as i", "i.id", "ii.invoice_id")
    .where("i.is_void", false)
    .where("i.series", "SALES")
    .groupBy("ii.category_snapshot")
    .select("ii.category_snapshot as category")
    .sum({ amount: "ii.line_total" })
    .count({ count: "ii.id" })
    .orderBy("amount", "desc");

  if (filters.from) query.where("i.issued_at", ">=", filters.from);
  if (filters.to) query.where("i.issued_at", "<=", `${filters.to} 23:59:59`);

  return (await query).map((r: any) => ({
    category: r.category ?? "unknown",
    amount: Number(r.amount),
    count: Number(r.count),
  }));
};
