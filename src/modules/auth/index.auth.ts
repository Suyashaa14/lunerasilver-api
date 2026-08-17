import express from "express";
import * as controller from "./controller.auth";
import { signupValidator, loginValidator } from "./validator.auth";
import { authenticateUser } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.post("/signup", signupValidator, asyncHandler(controller.signup));
router.post("/login", loginValidator, asyncHandler(controller.login));
router.post("/logout", controller.logout);
router.get("/me", authenticateUser, asyncHandler(controller.me));

export default router;
