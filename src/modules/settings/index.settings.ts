import express from "express";
import * as controller from "./controller.settings";
import { updateSilverRateValidator } from "./validator.settings";
import { authenticateAdmin } from "../../middleware/auth";
import { upload } from "../../middleware/upload";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.get("/", asyncHandler(controller.getSettings));
router.put(
  "/silver-rate",
  authenticateAdmin,
  updateSilverRateValidator,
  asyncHandler(controller.updateSilverRate),
);
router.post(
  "/silver-rate/sync",
  authenticateAdmin,
  asyncHandler(controller.syncSilverRate),
);
router.post(
  "/esewa-qr",
  authenticateAdmin,
  upload.single("image"),
  asyncHandler(controller.updateEsewaQr),
);

export default router;
