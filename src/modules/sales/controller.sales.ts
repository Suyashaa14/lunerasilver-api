import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as provider from "./provider.sales";

const parsePayload = (body: any) => ({
  ringName: body.ringName,
  category: body.category,
  jewelryId: body.jewelryId === null ? null : (body.jewelryId !== undefined && body.jewelryId !== "" ? Number(body.jewelryId) : undefined),
  source: body.source,
  silverWeightGrams: body.silverWeightGrams !== undefined ? Number(body.silverWeightGrams) : undefined,
  silverRatePerGram: body.silverRatePerGram !== undefined ? Number(body.silverRatePerGram) : undefined,
  stoneWeightGrams: body.stoneWeightGrams !== undefined && body.stoneWeightGrams !== "" ? Number(body.stoneWeightGrams) : undefined,
  stonePrice: body.stonePrice !== undefined && body.stonePrice !== "" ? Number(body.stonePrice) : undefined,
  makingCharge: body.makingCharge !== undefined && body.makingCharge !== "" ? Number(body.makingCharge) : undefined,
  soldPrice: body.soldPrice !== undefined ? Number(body.soldPrice) : undefined,
  soldAt: body.soldAt,
  notes: body.notes,
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

export const listSales = async (req: Request, res: Response) => {
  const result = await provider.listSales(parseListQuery(req.query));
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

export const getByProduct = async (req: Request, res: Response) => {
  const result = await provider.getByProduct(parseDateRange(req.query));
  res.json(result);
};

export const getSale = async (req: Request, res: Response) => {
  const sale = await provider.getSale(Number(req.params.id));
  if (!sale) return res.status(404).json({ status: false, message: "Sale not found" });
  res.json(sale);
};

export const createSale = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }

  const sale = await provider.createSale(parsePayload(req.body) as any);
  res.status(201).json(sale);
};

export const updateSale = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }

  const sale = await provider.updateSale(Number(req.params.id), parsePayload(req.body) as any);
  if (!sale) return res.status(404).json({ status: false, message: "Sale not found" });
  res.json(sale);
};

export const deleteSale = async (req: Request, res: Response) => {
  const deleted = await provider.deleteSale(Number(req.params.id));
  if (!deleted) return res.status(404).json({ status: false, message: "Sale not found" });
  res.json({ status: true });
};
