import express, { Request, Response } from "express";
import { body, validationResult } from "express-validator";
import db from "../../utils/db";
import * as provider from "./provider.ledger";
import * as periods from "./provider.periods";
import { authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { auditActor } from "../../utils/audit";

const router = express.Router();
router.use(authenticateAdmin);

const range = (q: any) => ({
  from: q.from ? String(q.from) : undefined,
  to: q.to ? String(q.to) : undefined,
  fiscalYear: q.fiscalYear ? String(q.fiscalYear) : undefined,
});

router.get("/accounts", asyncHandler(async (_req: Request, res: Response) => {
  res.json(await db("accounts").orderBy("code").select("id", "code", "name", "type", "is_active"));
}));

router.get("/trial-balance", asyncHandler(async (req: Request, res: Response) => {
  res.json(await provider.trialBalance(range(req.query)));
}));

router.get("/entries", asyncHandler(async (req: Request, res: Response) => {
  res.json(await provider.listEntries({ ...range(req.query), limit: req.query.limit ? Number(req.query.limit) : undefined }));
}));

router.get("/entries/:id", asyncHandler(async (req: Request, res: Response) => {
  const entry = await provider.getEntry(Number(req.params.id));
  if (!entry) return res.status(404).json({ status: false, message: "Entry not found" });
  res.json(entry);
}));

// A manual entry, for the corrections a document cannot express -- an opening
// balance, a bank charge, the accountant's year-end adjustment.
router.post(
  "/entries",
  [
    body("date").isISO8601().withMessage("A date is required"),
    body("narration").isString().trim().notEmpty().withMessage("A narration is required"),
    body("lines").isArray({ min: 2 }).withMessage("An entry needs at least two lines"),
    body("lines.*.account").isString().trim().notEmpty(),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: false, errors: errors.array() });

    const id = await db.transaction((trx) => provider.postEntry(trx, req.body, auditActor(req)));
    res.status(201).json(await provider.getEntry(id));
  }),
);

router.get("/periods", asyncHandler(async (_req: Request, res: Response) => {
  res.json(await periods.listPeriods());
}));

router.post("/periods/:name/close", asyncHandler(async (req: Request, res: Response) => {
  res.json(await periods.closePeriod(decodeURIComponent(req.params.name), auditActor(req)));
}));

router.post("/periods/:name/reopen", asyncHandler(async (req: Request, res: Response) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length === 0) {
    return res.status(400).json({ status: false, message: "Reopening a closed year needs a reason" });
  }
  res.json(await periods.reopenPeriod(decodeURIComponent(req.params.name), reason, auditActor(req)));
}));

export default router;
