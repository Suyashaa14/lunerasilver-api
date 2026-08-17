import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as provider from "./provider.cart";

export const getCart = async (req: Request, res: Response) => {
  res.json(await provider.getCart(req.user!.id));
};

export const addToCart = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }
  await provider.addToCart(req.user!.id, Number(req.body.jewelryId));
  res.status(201).json({ status: true });
};

export const removeFromCart = async (req: Request, res: Response) => {
  await provider.removeFromCart(req.user!.id, Number(req.params.jewelryId));
  res.json({ status: true });
};
