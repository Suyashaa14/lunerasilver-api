import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/auth";

export const authenticateUser = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ status: false, message: "Not authenticated" });
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ status: false, message: "Invalid or expired session" });
  }
};

export const attachUserIfPresent = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const token = req.cookies?.token;
  if (token) {
    try {
      req.user = verifyToken(token);
    } catch {
      // optional auth: ignore invalid/expired token
    }
  }
  next();
};

export const authenticateAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ status: false, message: "Admin access required" });
  }
  next();
};
