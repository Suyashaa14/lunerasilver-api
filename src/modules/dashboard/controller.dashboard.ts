import { Request, Response } from "express";
import * as provider from "./provider.dashboard";
import { parsePeriodKey } from "../../utils/period";

export const getStats = async (_req: Request, res: Response) => {
  res.json(await provider.getStats());
};

export const getOverview = async (req: Request, res: Response) => {
  res.json(await provider.getOverview(parsePeriodKey(req.query.period)));
};

export const getAlerts = async (_req: Request, res: Response) => {
  res.json(await provider.getAlerts());
};
