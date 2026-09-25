import express, { Request, Response } from "express";
import { body, validationResult } from "express-validator";
import * as provider from "./provider.suppliers";
import { authenticateAdmin, authenticateStaff } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { auditActor } from "../../utils/audit";

const router = express.Router();
router.use(authenticateStaff);

const validator = [
  body("name").isString().trim().notEmpty().withMessage("Name is required").isLength({ max: 120 }),
  body("pan").optional({ values: "falsy" }).isString().trim().matches(/^\d{9}$/).withMessage("PAN must be 9 digits"),
  body("phone").optional({ values: "falsy" }).isString().trim().isLength({ max: 20 }),
  body("email").optional({ values: "falsy" }).isEmail(),
];

const reject = (req: Request, res: Response): boolean => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ status: false, errors: errors.array() });
  return true;
};

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  res.json(await provider.listSuppliers({
    search: req.query.search ? String(req.query.search) : undefined,
    includeInactive: req.query.includeInactive === "true",
  }));
}));

router.post("/", validator, asyncHandler(async (req: Request, res: Response) => {
  if (reject(req, res)) return;
  res.status(201).json(await provider.createSupplier(req.body, auditActor(req)));
}));

router.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const supplier = await provider.getSupplier(Number(req.params.id));
  if (!supplier) return res.status(404).json({ status: false, message: "Supplier not found" });
  res.json(supplier);
}));

router.put("/:id", validator, asyncHandler(async (req: Request, res: Response) => {
  if (reject(req, res)) return;
  const supplier = await provider.updateSupplier(Number(req.params.id), req.body, auditActor(req));
  if (!supplier) return res.status(404).json({ status: false, message: "Supplier not found" });
  res.json(supplier);
}));

// No delete. A supplier named on a purchase bill has to stay; deactivate instead.

export default router;
