import { Request, Response } from "express";
import * as provider from "./provider.dashboard";

export const getStats = async (_req: Request, res: Response) => {
  res.json(await provider.getStats());
};

export const getOverview = async (_req: Request, res: Response) => {
  res.json(await provider.getOverview());
};

export const getAlerts = async (_req: Request, res: Response) => {
  res.json(await provider.getAlerts());
};
