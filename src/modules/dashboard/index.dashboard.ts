import express from "express";
import * as controller from "./controller.dashboard";
import { authenticateUser, authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.get("/stats", authenticateUser, authenticateAdmin, asyncHandler(controller.getStats));
router.get("/alerts", authenticateUser, authenticateAdmin, asyncHandler(controller.getAlerts));

export default router;
