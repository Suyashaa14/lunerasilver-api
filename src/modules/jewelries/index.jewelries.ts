import express from "express";
import * as controller from "./controller.jewelries";
import { createJewelryValidator, updateJewelryValidator } from "./validator.jewelries";
import { authenticateAdmin } from "../../middleware/auth";
import { upload } from "../../middleware/upload";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.get("/", asyncHandler(controller.listJewelries));
router.get("/:id", asyncHandler(controller.getJewelry));

router.post(
  "/",
  authenticateAdmin,
  upload.single("image"),
  createJewelryValidator,
  asyncHandler(controller.createJewelry),
);
router.put(
  "/:id",
  authenticateAdmin,
  upload.single("image"),
  updateJewelryValidator,
  asyncHandler(controller.updateJewelry),
);
// Pieces are never deleted -- they are retired with a reason, which writes a
// stock-ledger row. See src/utils/noDelete.ts.
router.post("/:id/retire", authenticateAdmin, asyncHandler(controller.retireJewelry));

export default router;
