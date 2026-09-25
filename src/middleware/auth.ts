import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/auth";

// Paths under /api that must answer without a token. Everything else is
// rejected by authGate before it reaches a route handler. Login and signup are
// not listed because they no longer live under /api at all -- they are mounted
// at the base level, ahead of this gate.
const PUBLIC_ROUTES: { method: string; pattern: RegExp }[] = [
  { method: "GET", pattern: /^\/hello\/?$/ },
  { method: "GET", pattern: /^\/jewelries\/?$/ },
  { method: "GET", pattern: /^\/jewelries\/[^/]+\/?$/ },
  { method: "GET", pattern: /^\/settings\/?$/ },
];

const isPublic = (method: string, path: string): boolean =>
  PUBLIC_ROUTES.some((route) => route.method === method && route.pattern.test(path));

const readBearerToken = (req: Request): string | undefined => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
};

/**
 * Mounted once at /api. Every request is checked for a valid, unexpired token
 * before any route handler runs.
 *
 * Public routes stay reachable: with no token they pass straight through, and a
 * token that fails to verify is discarded rather than rejected, so a visitor
 * holding a stale token can still browse the storefront as a guest.
 */
export const authGate = (req: Request, res: Response, next: NextFunction) => {
  const token = readBearerToken(req);
  const publicRoute = isPublic(req.method, req.path);

  if (!token) {
    if (publicRoute) return next();
    return res.status(401).json({ status: false, message: "Not authenticated" });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    if (publicRoute) return next();
    return res.status(401).json({ status: false, message: "Invalid or expired session" });
  }
};

// Authorization. Authentication already ran in authGate, so req.user is set for
// every non-public route by the time this is reached.
export const authenticateAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ status: false, message: "Admin access required" });
  }
  next();
};

/**
 * Staff can run the shop: sell, take payment, add stock, look things up.
 *
 * What stays with the owner is anything that rewrites history or changes what
 * the business is -- voiding an invoice, issuing a credit note, closing a year,
 * posting a manual journal, changing who has access. Those are the entries an
 * auditor asks about, and they should carry the owner's name.
 */
export const authenticateStaff = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || (req.user.role !== "admin" && req.user.role !== "staff")) {
    return res.status(403).json({ status: false, message: "Staff access required" });
  }
  next();
};
