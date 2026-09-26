import express from "express";
import * as controller from "./controller.orders";
import { createOrderValidator, createCounterOrderValidator, updateOrderStatusValidator } from "./validator.orders";
import { authenticateAdmin, authenticateStaff } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.post("/", createOrderValidator, asyncHandler(controller.createOrder));

// Taken by the shop. Staff may take an order; only an owner turns one into a
// sale, because that is the point where the books move.
router.post(
  "/counter",
  authenticateStaff,
  createCounterOrderValidator,
  asyncHandler(controller.createCounterOrder),
);
router.post("/:id/invoice", authenticateAdmin, asyncHandler(controller.invoiceOrder));
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
