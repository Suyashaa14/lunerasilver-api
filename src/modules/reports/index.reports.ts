import express, { Request, Response } from "express";
import * as reports from "./provider.reports";
import { trialBalance } from "../ledger/provider.ledger";
import { toCsv } from "./csv";
import { authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();
router.use(authenticateAdmin);

const range = (q: any): reports.Range => ({
  from: q.from ? String(q.from) : undefined,
  to: q.to ? String(q.to) : undefined,
  fiscalYear: q.fiscalYear ? String(q.fiscalYear) : undefined,
});

const sendCsv = (res: Response, name: string, columns: { key: string; label: string }[], rows: any[]) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
  res.send(toCsv(columns, rows));
};

router.get("/trial-balance", asyncHandler(async (req: Request, res: Response) => {
  const report = await trialBalance(range(req.query));
  if (req.query.format === "csv") {
    return sendCsv(res, "trial-balance", [
      { key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "type", label: "Type" },
      { key: "debit", label: "Debit" }, { key: "credit", label: "Credit" }, { key: "balance", label: "Balance" },
    ], report.rows);
  }
  res.json(report);
}));

router.get("/profit-and-loss", asyncHandler(async (req: Request, res: Response) => {
  const report = await reports.profitAndLoss(range(req.query));
  if (req.query.format === "csv") {
    const rows = [
      ...report.income.map((l) => ({ section: "Income", ...l })),
      { section: "Income", code: "", name: "Total income", amount: report.totalIncome },
      ...report.costOfSales.map((l) => ({ section: "Cost of sales", ...l })),
      { section: "", code: "", name: "Gross profit", amount: report.grossProfit },
      ...report.expenses.map((l) => ({ section: "Expenses", ...l })),
      { section: "", code: "", name: "Net profit", amount: report.netProfit },
    ];
    return sendCsv(res, "profit-and-loss", [
      { key: "section", label: "Section" }, { key: "code", label: "Code" },
      { key: "name", label: "Account" }, { key: "amount", label: "Amount" },
    ], rows);
  }
  res.json(report);
}));

router.get("/balance-sheet", asyncHandler(async (req: Request, res: Response) => {
  res.json(await reports.balanceSheet(range(req.query)));
}));

router.get("/aged-receivables", asyncHandler(async (req: Request, res: Response) => {
  const report = await reports.agedReceivables(req.query.asOf ? String(req.query.asOf) : undefined);
  if (req.query.format === "csv") {
    return sendCsv(res, "aged-receivables", [
      { key: "invoiceNo", label: "Invoice" }, { key: "customer", label: "Customer" },
      { key: "issuedDateBs", label: "Date (BS)" }, { key: "total", label: "Total" },
      { key: "paid", label: "Paid" }, { key: "outstanding", label: "Outstanding" },
      { key: "daysOutstanding", label: "Days" }, { key: "bucket", label: "Bucket" },
    ], report.items);
  }
  res.json(report);
}));

router.get("/aged-payables", asyncHandler(async (req: Request, res: Response) => {
  res.json(await reports.agedPayables(req.query.asOf ? String(req.query.asOf) : undefined));
}));

router.get("/stock-valuation", asyncHandler(async (req: Request, res: Response) => {
  const report = await reports.stockValuation();
  if (req.query.format === "csv") {
    return sendCsv(res, "stock-valuation", [
      { key: "sku", label: "SKU" }, { key: "name", label: "Name" }, { key: "category", label: "Category" },
      { key: "status", label: "Status" }, { key: "silverGrams", label: "Silver g" }, { key: "cost", label: "Cost" },
    ], report.items);
  }
  res.json(report);
}));

router.get("/sales-register", asyncHandler(async (req: Request, res: Response) => {
  const report = await reports.salesRegister(range(req.query));
  if (req.query.format === "csv") {
    return sendCsv(res, "sales-register", [
      { key: "invoiceNo", label: "Invoice" }, { key: "dateBs", label: "Date (BS)" },
      { key: "buyer", label: "Buyer" }, { key: "buyerPan", label: "Buyer PAN" },
      { key: "taxable", label: "Taxable" }, { key: "vat", label: "VAT" },
      { key: "total", label: "Total" }, { key: "isVoid", label: "Void" },
    ], report.rows);
  }
  res.json(report);
}));

router.get("/purchase-register", asyncHandler(async (req: Request, res: Response) => {
  const report = await reports.purchaseRegister(range(req.query));
  if (req.query.format === "csv") {
    return sendCsv(res, "purchase-register", [
      { key: "billNo", label: "Bill" }, { key: "dateBs", label: "Date (BS)" },
      { key: "supplier", label: "Supplier" }, { key: "supplierPan", label: "Supplier PAN" },
      { key: "taxable", label: "Taxable" }, { key: "vat", label: "VAT" },
      { key: "tds", label: "TDS" }, { key: "total", label: "Total" },
    ], report.rows);
  }
  res.json(report);
}));

router.get("/vat-return", asyncHandler(async (req: Request, res: Response) => {
  res.json(await reports.vatReturn(range(req.query)));
}));

// The cross-check: three routes to revenue, one number.
router.get("/reconciliation", asyncHandler(async (req: Request, res: Response) => {
  res.json(await reports.reconciliation(range(req.query)));
}));

export default router;
