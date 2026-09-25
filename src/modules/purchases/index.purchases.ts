import express, { Request, Response } from "express";
import { body, validationResult } from "express-validator";
import * as provider from "./provider.purchases";
import { authenticateAdmin, authenticateStaff } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { auditActor } from "../../utils/audit";

const router = express.Router();
router.use(authenticateStaff);

const createValidator = [
  body("supplierId").isInt({ min: 1 }).withMessage("A supplier is required"),
  body("billNo").isString().trim().notEmpty().withMessage("Bill number is required").isLength({ max: 60 }),
  body("billDate").isISO8601().withMessage("Bill date is required"),
  body("discount").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("tdsAmount").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("items").isArray({ min: 1 }).withMessage("At least one line is required"),
  body("items.*.description").isString().trim().notEmpty(),
  body("items.*.unitCost").isFloat({ min: 0 }).withMessage("Each line needs a cost"),
  body("items.*.stockIn.name").optional({ values: "falsy" }).isString().trim().notEmpty(),
  body("items.*.stockIn.category").optional({ values: "falsy" }).isString().trim().notEmpty(),
  body("items.*.stockIn.silverWeightGrams").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("items.*.stockIn.makingCharge").optional({ values: "falsy" }).isFloat({ min: 0 }),
];

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  res.json(await provider.listPurchases({
    supplierId: req.query.supplierId ? Number(req.query.supplierId) : undefined,
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
  }));
}));

router.post("/", createValidator, asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ status: false, errors: errors.array() });
  res.status(201).json(await provider.createPurchase(req.body, auditActor(req)));
}));

router.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const purchase = await provider.getPurchase(Number(req.params.id));
  if (!purchase) return res.status(404).json({ status: false, message: "Purchase not found" });
  res.json(purchase);
}));

// No update and no delete: a supplier bill is evidence. Correct it with a
// further bill or a note from the supplier.

export default router;
