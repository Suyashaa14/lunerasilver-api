import express from "express";
import * as controller from "./controller.orders";
import { createOrderValidator, updateOrderStatusValidator } from "./validator.orders";
import { authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.post("/", createOrderValidator, asyncHandler(controller.createOrder));
router.get("/mine", asyncHandler(controller.myOrders));
router.get("/", authenticateAdmin, asyncHandler(controller.listOrders));
router.get("/:id", asyncHandler(controller.getOrder));
router.patch(
  "/:id/status",
  authenticateAdmin,
  updateOrderStatusValidator,
  asyncHandler(controller.updateOrderStatus),
);

export default router;
