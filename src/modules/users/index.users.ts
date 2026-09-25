import express, { Request, Response } from "express";
import { body, validationResult } from "express-validator";
import * as provider from "./provider.users";
import { authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { auditActor } from "../../utils/audit";

const router = express.Router();

// Who has access is the owner's call, never staff's.
router.use(authenticateAdmin);

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  res.json(await provider.listUsers(req.query.includeInactive === "true"));
}));

router.post("/:id/deactivate", asyncHandler(async (req: Request, res: Response) => {
  const user = await provider.setActive(Number(req.params.id), false, auditActor(req));
  if (!user) return res.status(404).json({ status: false, message: "User not found" });
  res.json(user);
}));

router.post("/:id/activate", asyncHandler(async (req: Request, res: Response) => {
  const user = await provider.setActive(Number(req.params.id), true, auditActor(req));
  if (!user) return res.status(404).json({ status: false, message: "User not found" });
  res.json(user);
}));

router.post(
  "/:id/role",
  [body("role").isIn(["admin", "staff", "customer"]).withMessage("role must be admin, staff or customer")],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: false, errors: errors.array() });
    const user = await provider.setRole(Number(req.params.id), req.body.role, auditActor(req));
    if (!user) return res.status(404).json({ status: false, message: "User not found" });
    res.json(user);
  }),
);

router.post("/:id/anonymise", asyncHandler(async (req: Request, res: Response) => {
  const user = await provider.anonymise(Number(req.params.id), auditActor(req));
  if (!user) return res.status(404).json({ status: false, message: "User not found" });
  res.json(user);
}));

// No delete. A user is named on invoices and audit rows; deactivate or
// anonymise instead. src/utils/writeGuards.ts enforces this.

export default router;
