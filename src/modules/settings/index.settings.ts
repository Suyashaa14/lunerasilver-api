import express from "express";
import * as controller from "./controller.settings";
import { updateSilverRateValidator } from "./validator.settings";
import { authenticateUser, authenticateAdmin } from "../../middleware/auth";
import { upload } from "../../middleware/upload";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.get("/", asyncHandler(controller.getSettings));
router.put(
  "/silver-rate",
  authenticateUser,
  authenticateAdmin,
  updateSilverRateValidator,
  asyncHandler(controller.updateSilverRate),
);
router.post(
  "/silver-rate/sync",
  authenticateUser,
  authenticateAdmin,
  asyncHandler(controller.syncSilverRate),
);
router.post(
  "/esewa-qr",
  authenticateUser,
  authenticateAdmin,
  upload.single("image"),
  asyncHandler(controller.updateEsewaQr),
);

export default router;
