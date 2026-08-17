import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as provider from "./provider.settings";
import { syncSilverRateFromFenegosida } from "./silverRateSync";

export const getSettings = async (_req: Request, res: Response) => {
  res.json(await provider.getSettings());
};

export const updateSilverRate = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }
  res.json(await provider.updateSilverRate(Number(req.body.silverRatePerGram)));
};

export const syncSilverRate = async (_req: Request, res: Response) => {
  try {
    res.json(await syncSilverRateFromFenegosida());
  } catch (err) {
    res.status(502).json({ status: false, message: err instanceof Error ? err.message : "Silver rate sync failed" });
  }
};

export const updateEsewaQr = async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ status: false, message: "QR image file is required" });
  res.json(await provider.updateEsewaQr(req.file));
};
