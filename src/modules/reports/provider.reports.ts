import db from "../../utils/db";
import { trialBalance } from "../ledger/provider.ledger";

const money = (n: number) => Math.round(n * 100) / 100;

export interface Range {
  from?: string;
  to?: string;
  fiscalYear?: string;
}

interface Line {
  code: string;
  name: string;
  amount: number;
}

/**
 * Profit and loss for a period, read from the ledger rather than recomputed
 * from documents -- so it can never disagree with the trial balance.
 */
export const profitAndLoss = async (range: Range) => {
  const tb = await trialBalance(range);

  const income: Line[] = tb.rows.filter((r) => r.type === "income")
    .map((r) => ({ code: r.code, name: r.name, amount: r.balance }));
  // Cost of sales is separated from overheads so gross margin is visible.
  const costOfSales: Line[] = tb.rows.filter((r) => r.type === "expense" && r.code.startsWith("5"))
    .map((r) => ({ code: r.code, name: r.name, amount: r.balance }));
  const expenses: Line[] = tb.rows.filter((r) => r.type === "expense" && !r.code.startsWith("5"))
    .map((r) => ({ code: r.code, name: r.name, amount: r.balance }));

  const totalIncome = money(income.reduce((s, l) => s + l.amount, 0));
  const totalCostOfSales = money(costOfSales.reduce((s, l) => s + l.amount, 0));
  const totalExpenses = money(expenses.reduce((s, l) => s + l.amount, 0));
  const grossProfit = money(totalIncome - totalCostOfSales);

  return {
    range,
    income,
    totalIncome,
    costOfSales,
    totalCostOfSales,
    grossProfit,
    grossMarginPercent: totalIncome === 0 ? 0 : Math.round((grossProfit / totalIncome) * 1000) / 10,
    expenses,
    totalExpenses,
    netProfit: money(grossProfit - totalExpenses),
  };
};

/**
 * Balance sheet as at a date.
 *
 * The period's profit has not been closed to equity, so it is shown as its own
 * line -- that is what makes the two sides agree before a year-end close.
 */
export const balanceSheet = async (range: Range) => {
  const tb = await trialBalance({ to: range.to, fiscalYear: range.fiscalYear });

  const pick = (type: string): Line[] =>
    tb.rows.filter((r) => r.type === type && r.balance !== 0)
      .map((r) => ({ code: r.code, name: r.name, amount: r.balance }));

  const assets = pick("asset");
  const liabilities = pick("liability");
  const equity = pick("equity");

  const totalAssets = money(assets.reduce((s, l) => s + l.amount, 0));
  const totalLiabilities = money(liabilities.reduce((s, l) => s + l.amount, 0));
  const totalEquity = money(equity.reduce((s, l) => s + l.amount, 0));

  const income = money(tb.rows.filter((r) => r.type === "income").reduce((s, r) => s + r.balance, 0));
  const expense = money(tb.rows.filter((r) => r.type === "expense").reduce((s, r) => s + r.balance, 0));
  const profitForPeriod = money(income - expense);

  const totalFunding = money(totalLiabilities + totalEquity + profitForPeriod);

  return {
    asAt: range.to ?? null,
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    totalEquity,
    profitForPeriod,
    totalFunding,
    // Assets must equal what funded them. If this is false the ledger has been
    // written to outside postEntry.
    balances: totalAssets === totalFunding,
    difference: money(totalAssets - totalFunding),
  };
};

const bucketOf = (days: number) => (days <= 30 ? "current" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "over90");

/** Who owes us, and for how long. Unpaid invoices only; void ones are excluded. */
export const agedReceivables = async (asOf?: string) => {
  const cutoff = asOf ? new Date(`${asOf}T23:59:59`) : new Date();

  const rows = await db("invoices as i")
    .join("customers as c", "c.id", "i.customer_id")
    .where("i.is_void", false)
    .where("i.issued_at", "<=", cutoff)
    .select("i.id", "i.invoice_no", "i.issued_at", "i.issued_date_bs", "i.total_amount", "c.name as customer")
    .select(
      db.raw(
        `COALESCE((SELECT SUM(p.amount) FROM payments p
                   WHERE p.invoice_id = i.id AND p.status = 'verified' AND p.received_at <= ?), 0) AS paid`,
        [cutoff],
      ),
    )
    .orderBy("i.issued_at", "asc");

  const items = (rows as any[])
    .map((r) => {
      const outstanding = money(Number(r.total_amount) - Number(r.paid));
      const days = Math.floor((cutoff.getTime() - new Date(r.issued_at).getTime()) / 86400000);
      return {
        invoiceId: r.id, invoiceNo: r.invoice_no, customer: r.customer,
        issuedDateBs: r.issued_date_bs, total: Number(r.total_amount),
        paid: Number(r.paid), outstanding, daysOutstanding: days, bucket: bucketOf(days),
      };
    })
    .filter((r) => r.outstanding > 0);

  const buckets = { current: 0, d31_60: 0, d61_90: 0, over90: 0 };
  for (const i of items) buckets[i.bucket as keyof typeof buckets] = money(buckets[i.bucket as keyof typeof buckets] + i.outstanding);

  return { asOf: asOf ?? null, items, buckets, total: money(items.reduce((s, i) => s + i.outstanding, 0)) };
};

/** Who we owe. Supplier bills are not yet part-payable, so this is bill-level. */
export const agedPayables = async (asOf?: string) => {
  const cutoff = asOf ? new Date(`${asOf}T23:59:59`) : new Date();

  const rows = await db("purchases as p")
    .join("suppliers as s", "s.id", "p.supplier_id")
    .whereNot("p.payment_status", "paid")
    .where("p.bill_date", "<=", cutoff)
    .select("p.id", "p.bill_no", "p.bill_date", "p.bill_date_bs", "p.total_amount", "p.payment_status", "s.name as supplier")
    .orderBy("p.bill_date", "asc");

  const items = (rows as any[]).map((r) => {
    const days = Math.floor((cutoff.getTime() - new Date(r.bill_date).getTime()) / 86400000);
    return {
      purchaseId: r.id, billNo: r.bill_no, supplier: r.supplier, billDateBs: r.bill_date_bs,
      outstanding: Number(r.total_amount), daysOutstanding: days, bucket: bucketOf(days),
    };
  });

  const buckets = { current: 0, d31_60: 0, d61_90: 0, over90: 0 };
  for (const i of items) buckets[i.bucket as keyof typeof buckets] = money(buckets[i.bucket as keyof typeof buckets] + i.outstanding);

  return { asOf: asOf ?? null, items, buckets, total: money(items.reduce((s, i) => s + i.outstanding, 0)) };
};

/**
 * What the stock on the shelf is worth at cost.
 *
 * Pieces with no cost price are listed separately rather than counted as zero,
 * because a zero would understate the figure without saying so.
 */
export const stockValuation = async () => {
  const rows = await db("jewelries")
    .whereIn("status", ["available", "reserved"])
    .orderBy("category")
    .orderBy("sku")
    .select("id", "sku", "name", "category", "status", "silver_weight_grams", "cost_price");

  const valued = (rows as any[]).filter((r) => r.cost_price !== null);
  const unvalued = (rows as any[]).filter((r) => r.cost_price === null);

  const byCategory = new Map<string, { category: string; pieces: number; grams: number; cost: number }>();
  for (const r of rows as any[]) {
    const entry = byCategory.get(r.category) ?? { category: r.category, pieces: 0, grams: 0, cost: 0 };
    entry.pieces += 1;
    entry.grams = money(entry.grams + Number(r.silver_weight_grams));
    entry.cost = money(entry.cost + Number(r.cost_price ?? 0));
    byCategory.set(r.category, entry);
  }

  return {
    pieces: rows.length,
    silverGrams: money((rows as any[]).reduce((s, r) => s + Number(r.silver_weight_grams), 0)),
    totalCost: money(valued.reduce((s, r) => s + Number(r.cost_price), 0)),
    piecesWithoutCost: unvalued.length,
    byCategory: Array.from(byCategory.values()),
    items: (rows as any[]).map((r) => ({
      id: r.id, sku: r.sku, name: r.name, category: r.category, status: r.status,
      silverGrams: Number(r.silver_weight_grams),
      cost: r.cost_price === null ? null : Number(r.cost_price),
    })),
  };
};

/** Every invoice in the period, with its tax split. What IRD asks to see. */
export const salesRegister = async (range: Range) => {
  const query = db("invoices as i")
    .join("customers as c", "c.id", "i.customer_id")
    .where("i.series", "SALES")
    .orderBy("i.issued_at", "asc")
    .select("i.invoice_no", "i.issued_at", "i.issued_date_bs", "i.fiscal_year", "i.buyer_name", "i.buyer_pan",
            "i.taxable_amount", "i.vat_amount", "i.total_amount", "i.is_void", "c.name as customer");

  if (range.fiscalYear) query.where("i.fiscal_year", range.fiscalYear);
  if (range.from) query.where("i.issued_at", ">=", range.from);
  if (range.to) query.where("i.issued_at", "<=", `${range.to} 23:59:59`);

  const rows = (await query).map((r: any) => ({
    invoiceNo: r.invoice_no, dateBs: r.issued_date_bs, buyer: r.buyer_name, buyerPan: r.buyer_pan,
    taxable: r.is_void ? 0 : Number(r.taxable_amount),
    vat: r.is_void ? 0 : Number(r.vat_amount),
    total: r.is_void ? 0 : Number(r.total_amount),
    isVoid: Boolean(r.is_void),
  }));

  return {
    rows,
    totalTaxable: money(rows.reduce((s, r) => s + r.taxable, 0)),
    totalVat: money(rows.reduce((s, r) => s + r.vat, 0)),
    total: money(rows.reduce((s, r) => s + r.total, 0)),
  };
};

export const purchaseRegister = async (range: Range) => {
  const query = db("purchases as p")
    .join("suppliers as s", "s.id", "p.supplier_id")
    .orderBy("p.bill_date", "asc")
    .select("p.bill_no", "p.bill_date_bs", "p.fiscal_year", "p.taxable_amount", "p.vat_amount",
            "p.tds_amount", "p.total_amount", "s.name as supplier", "s.pan as supplier_pan");

  if (range.fiscalYear) query.where("p.fiscal_year", range.fiscalYear);
  if (range.from) query.where("p.bill_date", ">=", range.from);
  if (range.to) query.where("p.bill_date", "<=", range.to);

  const rows = (await query).map((r: any) => ({
    billNo: r.bill_no, dateBs: r.bill_date_bs, supplier: r.supplier, supplierPan: r.supplier_pan,
    taxable: Number(r.taxable_amount), vat: Number(r.vat_amount),
    tds: Number(r.tds_amount), total: Number(r.total_amount),
  }));

  return {
    rows,
    totalTaxable: money(rows.reduce((s, r) => s + r.taxable, 0)),
    totalVat: money(rows.reduce((s, r) => s + r.vat, 0)),
    total: money(rows.reduce((s, r) => s + r.total, 0)),
  };
};

/**
 * VAT owed for a period: tax charged on sales, less tax paid on purchases and
 * expenses. Returns zeros while the shop is not VAT-registered, which is
 * correct rather than empty -- the figures are being kept either way.
 */
export const vatReturn = async (range: Range) => {
  const [business, sales, purchases, expenseVat, creditNotes] = await Promise.all([
    db("business_profile").first("is_vat_registered", "vat_number", "default_vat_rate"),
    salesRegister(range),
    purchaseRegister(range),
    (async () => {
      const q = db("expenses").where("is_void", false).sum({ vat: "vat_amount" }).sum({ taxable: "taxable_amount" });
      if (range.fiscalYear) q.where("fiscal_year", range.fiscalYear);
      if (range.from) q.where("spent_at", ">=", range.from);
      if (range.to) q.where("spent_at", "<=", range.to);
      return q.first();
    })(),
    (async () => {
      // Only credit notes against invoices that are still standing.
      // A fully credited invoice is voided, so the sales register has already
      // dropped it -- subtracting its credit note as well would count the
      // reversal twice and push the figures negative.
      const q = db("credit_notes as cn")
        .join("invoices as i", "i.id", "cn.invoice_id")
        .where("i.is_void", false)
        .sum({ vat: "cn.vat_amount" })
        .sum({ taxable: "cn.taxable_amount" });
      if (range.fiscalYear) q.where("cn.fiscal_year", range.fiscalYear);
      if (range.from) q.where("cn.issued_at", ">=", range.from);
      if (range.to) q.where("cn.issued_at", "<=", `${range.to} 23:59:59`);
      return q.first();
    })(),
  ]);

  const registered = Boolean((business as any)?.is_vat_registered);
  const outputVat = money(sales.totalVat - Number((creditNotes as any)?.vat ?? 0));
  const vatPaidOnPurchases = money(purchases.totalVat + Number((expenseVat as any)?.vat ?? 0));
  // Only a registered business can reclaim the tax it paid. For PAN-only, that
  // tax was booked as cost, so offering it back here would contradict the ledger.
  const inputVat = registered ? vatPaidOnPurchases : 0;

  return {
    range,
    isVatRegistered: registered,
    note: registered
      ? undefined
      : "PAN registration only. No VAT is charged on sales, and VAT paid to suppliers is not reclaimable — it is recorded as part of cost.",
    vatPaidNotReclaimable: registered ? 0 : vatPaidOnPurchases,
    vatNumber: (business as any)?.vat_number ?? null,
    sales: { taxable: money(sales.totalTaxable - Number((creditNotes as any)?.taxable ?? 0)), vat: outputVat },
    purchases: { taxable: purchases.totalTaxable, vat: purchases.totalVat },
    expenses: { taxable: Number((expenseVat as any)?.taxable ?? 0), vat: Number((expenseVat as any)?.vat ?? 0) },
    outputVat,
    inputVat,
    netPayable: money(outputVat - inputVat),
  };
};

/**
 * The cross-check from the plan: revenue in the profit and loss must equal the
 * sales register, which must equal money collected plus money still owed.
 * Three different routes through the data, one number.
 */
export const reconciliation = async (range: Range) => {
  const [pl, register, receivables] = await Promise.all([
    profitAndLoss(range),
    salesRegister(range),
    agedReceivables(range.to),
  ]);

  const collected = await (async () => {
    const q = db("payments as p")
      .join("invoices as i", "i.id", "p.invoice_id")
      .where("p.status", "verified")
      .where("i.is_void", false)
      .sum({ amount: "p.amount" });
    if (range.fiscalYear) q.where("i.fiscal_year", range.fiscalYear);
    if (range.from) q.where("i.issued_at", ">=", range.from);
    if (range.to) q.where("i.issued_at", "<=", `${range.to} 23:59:59`);
    return Number(((await q.first()) as any)?.amount ?? 0);
  })();

  const plRevenue = pl.totalIncome;
  const registerTotal = register.totalTaxable;
  const collectedPlusOwed = money(collected + receivables.total);

  return {
    profitAndLossRevenue: plRevenue,
    salesRegisterTaxable: registerTotal,
    collectedPlusOutstanding: collectedPlusOwed,
    agrees: plRevenue === registerTotal && registerTotal === collectedPlusOwed,
  };
};
