import express, { Request, Response } from "express";
import { body, validationResult } from "express-validator";
import * as provider from "./provider.inventory";
import { authenticateAdmin, authenticateStaff } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { auditActor } from "../../utils/audit";

const router = express.Router();
router.use(authenticateStaff);

router.get("/reconcile", asyncHandler(async (_req: Request, res: Response) => {
  const rows = await provider.reconcileStock();
  res.json({ data: rows, disagreements: rows.filter((r) => !r.agrees) });
}));

router.get("/:jewelryId", asyncHandler(async (req: Request, res: Response) => {
  res.json(await provider.getMovements(Number(req.params.jewelryId)));
}));

router.post(
  "/adjustment",
  [
    body("jewelryId").isInt({ min: 1 }),
    body("direction").isIn(["in", "out"]).withMessage("direction must be in or out"),
    body("note").isString().trim().notEmpty().withMessage("A note is required for a manual adjustment"),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: false, errors: errors.array() });
    res.status(201).json(await provider.recordAdjustment(req.body, auditActor(req)));
  }),
);

// Append-only: no update, no delete. A wrong movement is corrected by another
// movement, never by editing history.

export default router;
