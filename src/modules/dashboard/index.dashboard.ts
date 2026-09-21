import express from "express";
import * as controller from "./controller.dashboard";
import { authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.get("/overview", authenticateAdmin, asyncHandler(controller.getOverview));
router.get("/stats", authenticateAdmin, asyncHandler(controller.getStats));
router.get("/alerts", authenticateAdmin, asyncHandler(controller.getAlerts));

export default router;
