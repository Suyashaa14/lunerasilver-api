import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as provider from "./provider.expenses";
import { auditActor } from "../../utils/audit";

const parsePayload = (body: any) => ({
  category: body.category,
  amount: body.amount !== undefined ? Number(body.amount) : undefined,
  spentAt: body.spentAt,
  note: body.note,
});

const parseDateRange = (query: any) => ({
  from: query.from ? String(query.from) : undefined,
  to: query.to ? String(query.to) : undefined,
});

const parseListQuery = (query: any) => ({
  ...parseDateRange(query),
  page: query.page ? Math.max(1, Number(query.page)) : 1,
  pageSize: query.pageSize ? Math.max(1, Number(query.pageSize)) : 20,
});

export const listExpenses = async (req: Request, res: Response) => {
  const result = await provider.listExpenses(parseListQuery(req.query));
  res.json(result);
};

export const getSummary = async (req: Request, res: Response) => {
  const result = await provider.getSummary(parseDateRange(req.query));
  res.json(result);
};

export const getMonthlySeries = async (req: Request, res: Response) => {
  const result = await provider.getMonthlySeries(parseDateRange(req.query));
  res.json(result);
};

export const getByCategory = async (req: Request, res: Response) => {
  const result = await provider.getByCategory(parseDateRange(req.query));
  res.json(result);
};

export const getExpense = async (req: Request, res: Response) => {
  const expense = await provider.getExpense(Number(req.params.id));
  if (!expense) return res.status(404).json({ status: false, message: "Expense not found" });
  res.json(expense);
};

export const createExpense = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }

  const expense = await provider.createExpense(parsePayload(req.body) as any);
  res.status(201).json(expense);
};

export const updateExpense = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }

  const expense = await provider.updateExpense(Number(req.params.id), parsePayload(req.body) as any);
  if (!expense) return res.status(404).json({ status: false, message: "Expense not found" });
  res.json(expense);
};

export const voidExpense = async (req: Request, res: Response) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length === 0) {
    return res.status(400).json({ status: false, message: "A reason is required to void an expense" });
  }

  const expense = await provider.voidExpense(Number(req.params.id), reason, auditActor(req));
  if (!expense) return res.status(404).json({ status: false, message: "Expense not found" });
  res.json(expense);
};
