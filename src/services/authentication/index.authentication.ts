import express, { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as service from "./service.authentication";
import { signupValidator, loginValidator } from "./validator.authentication";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

const rejectInvalid = (req: Request, res: Response): boolean => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ status: false, errors: errors.array() });
  return true;
};

router.post(
  "/signup",
  signupValidator,
  asyncHandler(async (req: Request, res: Response) => {
    if (rejectInvalid(req, res)) return;
    const { user, token } = await service.signup(req.body);
    res.status(201).json({ ...user, token });
  }),
);

router.post(
  "/login",
  loginValidator,
  asyncHandler(async (req: Request, res: Response) => {
    if (rejectInvalid(req, res)) return;
    const { user, token } = await service.login(req.body);
    res.json({ ...user, token });
  }),
);

// Logout is client-side now: the token lives in the browser, so there is no
// server session to tear down. Kept so the frontend has a single place to call
// if token revocation (a denylist) is ever added.
router.post("/logout", (_req: Request, res: Response) => {
  res.json({ status: true });
});

export default router;
