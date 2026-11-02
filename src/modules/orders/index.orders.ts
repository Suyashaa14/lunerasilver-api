import express, { NextFunction, Request, Response } from "express";
import { upload } from "../../middleware/upload";
import * as controller from "./controller.orders";
import { createOrderValidator, createCounterOrderValidator, updateOrderStatusValidator, updateOrderDetailsValidator, linkCustomPieceValidator } from "./validator.orders";
import { authenticateAdmin, authenticateStaff } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

const parseMultipartPayload = (req: Request, res: Response, next: NextFunction) => {
  if (typeof req.body?.payload !== "string") return next();
  try {
    req.body = JSON.parse(req.body.payload);
    next();
  } catch {
    res.status(400).json({ status: false, message: "The order could not be read" });
  }
};

router.post("/", createOrderValidator, asyncHandler(controller.createOrder));

// Taken by the shop. Staff may take an order; only an owner turns one into a
// sale, because that is the point where the books move.
// Sent as multipart when a custom piece carries an inspiration image: the order
// is a JSON `payload` field and each image is `inspo_<line index>`.
router.post(
  "/counter",
  authenticateStaff,
  upload.any(),
  parseMultipartPayload,
  createCounterOrderValidator,
  asyncHandler(controller.createCounterOrder),
);
router.patch(
  "/:id",
  authenticateStaff,
  updateOrderDetailsValidator,
  asyncHandler(controller.updateOrderDetails),
);
router.post(
  "/:id/items/:itemId/piece",
  authenticateStaff,
  linkCustomPieceValidator,
  asyncHandler(controller.linkCustomPiece),
);
router.delete("/:id", authenticateAdmin, asyncHandler(controller.deleteOrder));
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
