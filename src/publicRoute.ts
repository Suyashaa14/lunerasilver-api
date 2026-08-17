import express, { Request, Response } from "express";

// Kept for structural parity with the reference project's public/admin route
// split. Not needed yet here: GET /jewelries and GET /settings are already
// unauthenticated under /api. Add routes here if a separate public-facing
// surface (e.g. a marketing site feed) is ever needed.
const router = express.Router();

router.use("/hello", (_req: Request, res: Response) => {
  res.status(200).json({ status: true, message: "Lunera Silver public API" });
});

export default router;
