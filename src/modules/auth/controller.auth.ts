import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as provider from "./provider.auth";
import { signToken } from "../../utils/auth";
import { config } from "../../../config/config";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: config.currentEnv === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const signup = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }

  const user = await provider.signup(req.body);
  const token = signToken({ id: user.id, role: user.role });
  res.cookie("token", token, COOKIE_OPTS);
  res.status(201).json(user);
};

export const login = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }

  const user = await provider.login(req.body);
  const token = signToken({ id: user.id, role: user.role });
  res.cookie("token", token, COOKIE_OPTS);
  res.json(user);
};

export const logout = (_req: Request, res: Response) => {
  res.clearCookie("token", { httpOnly: true, sameSite: "lax", secure: config.currentEnv === "production" });
  res.json({ status: true });
};

export const me = async (req: Request, res: Response) => {
  const user = await provider.getUserById(req.user!.id);
  if (!user) return res.status(401).json({ status: false, message: "Not authenticated" });
  res.json(user);
};
