import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as provider from "./provider.jewelries";

const parsePayload = (body: any) => ({
  name: body.name,
  category: body.category,
  silverWeightGrams: body.silverWeightGrams !== undefined ? Number(body.silverWeightGrams) : undefined,
  pricingMode: body.pricingMode,
  makingCharge: body.makingCharge !== undefined ? Number(body.makingCharge) : undefined,
  totalCost: body.totalCost !== undefined ? Number(body.totalCost) : undefined,
  stoneWeightGrams: body.stoneWeightGrams !== undefined && body.stoneWeightGrams !== "" ? Number(body.stoneWeightGrams) : undefined,
  stonePrice: body.stonePrice !== undefined && body.stonePrice !== "" ? Number(body.stonePrice) : undefined,
});

export const listJewelries = async (req: Request, res: Response) => {
  const { category, status, page, pageSize } = req.query;
  const result = await provider.listJewelries({
    category: category ? String(category) : undefined,
    status: status ? String(status) : undefined,
    page: page ? Math.max(1, Number(page)) : 1,
    pageSize: pageSize ? Math.max(1, Number(pageSize)) : 20,
  });
  res.json(result);
};

export const getJewelry = async (req: Request, res: Response) => {
  const jewelry = await provider.getJewelry(Number(req.params.id));
  if (!jewelry) return res.status(404).json({ status: false, message: "Jewelry not found" });
  res.json(jewelry);
};

export const createJewelry = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }

  const jewelry = await provider.createJewelry(parsePayload(req.body) as any, req.file);
  res.status(201).json(jewelry);
};

export const updateJewelry = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }

  const jewelry = await provider.updateJewelry(Number(req.params.id), parsePayload(req.body) as any, req.file);
  if (!jewelry) return res.status(404).json({ status: false, message: "Jewelry not found" });
  res.json(jewelry);
};

export const deleteJewelry = async (req: Request, res: Response) => {
  const deleted = await provider.deleteJewelry(Number(req.params.id));
  if (!deleted) return res.status(404).json({ status: false, message: "Jewelry not found" });
  res.json({ status: true });
};
