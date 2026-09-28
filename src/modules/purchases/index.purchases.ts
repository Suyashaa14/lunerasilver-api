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
  // Optional: a line that books a piece and states the rate paid has its cost
  // worked out from the parts. The provider refuses a line with neither.
  body("items.*.unitCost").optional({ values: "null" }).isFloat({ min: 0 }),
  body("items.*.stockIn.ratePerGram").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("items.*.stockIn.stoneWeightGrams").optional({ values: "null" }).isFloat({ min: 0 }),
  body("items.*.stockIn.stonePrice").optional({ values: "null" }).isFloat({ min: 0 }),
  body("items.*.stockIn.profitAmount").optional({ values: "null" }).isFloat({ min: 0 }),
  body("items.*.stockIn.name").optional({ values: "falsy" }).isString().trim().notEmpty(),
  body("items.*.stockIn.category").optional({ values: "falsy" }).isString().trim().notEmpty(),
  body("items.*.stockIn.silverWeightGrams").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("items.*.stockIn.makingCharge").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("addToExisting").optional().isBoolean(),
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

// Only the parts that carry no money: the note and the payment. A figure that
// was wrong is corrected by voiding the bill and entering it again.
const detailsValidator = [
  body("notes").optional({ values: "null" }).isString().isLength({ max: 2000 }),
  body("paymentStatus").optional().isIn(["unpaid", "partial", "paid"]),
  body("paymentMethod").optional({ values: "falsy" }).isIn(["cash", "cod", "esewa_qr", "bank_transfer", "card"]),
];

router.patch("/:id", detailsValidator, asyncHandler(async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ status: false, errors: errors.array() });
  const purchase = await provider.updatePurchaseDetails(Number(req.params.id), req.body, auditActor(req));
  if (!purchase) return res.status(404).json({ status: false, message: "Purchase not found" });
  res.json(purchase);
}));

// Never deleted. Voiding keeps the bill, reverses its books and takes its
// pieces off the shelf -- owner only, like the other cancellations.
router.post("/:id/void", authenticateAdmin, asyncHandler(async (req: Request, res: Response) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length === 0) {
    return res.status(400).json({ status: false, message: "A reason is required to void a bill" });
  }
  const purchase = await provider.voidPurchase(Number(req.params.id), reason, auditActor(req));
  if (!purchase) return res.status(404).json({ status: false, message: "Purchase not found" });
  res.json(purchase);
}));

export default router;
