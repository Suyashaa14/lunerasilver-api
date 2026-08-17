import { body } from "express-validator";

export const createOrderValidator = [
  body("recipientName").isString().trim().notEmpty().withMessage("Recipient name is required"),
  body("phone").isString().trim().notEmpty().withMessage("Phone is required"),
  body("addressLine").isString().trim().notEmpty().withMessage("Delivery address is required"),
  body("city").isString().trim().notEmpty().withMessage("City is required"),
  body("notes").optional().isString().isLength({ max: 500 }),
  body("paymentMethod").isIn(["cod", "esewa_qr"]).withMessage("paymentMethod must be 'cod' or 'esewa_qr'"),
];

export const updateOrderStatusValidator = [
  body("status").optional().isIn(["pending", "confirmed", "completed", "cancelled"]),
  body("paymentStatus").optional().isIn(["unpaid", "awaiting_verification", "paid"]),
];
