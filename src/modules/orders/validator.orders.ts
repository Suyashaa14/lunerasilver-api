import { body } from "express-validator";

export const createOrderValidator = [
  body("recipientName").isString().trim().notEmpty().withMessage("Recipient name is required"),
  body("phone").isString().trim().notEmpty().withMessage("Phone is required"),
  body("addressLine").isString().trim().notEmpty().withMessage("Delivery address is required"),
  body("city").isString().trim().notEmpty().withMessage("City is required"),
  body("notes").optional().isString().isLength({ max: 500 }),
  body("paymentMethod").isIn(["cod", "esewa_qr"]).withMessage("paymentMethod must be 'cod' or 'esewa_qr'"),
];

const CUSTOM_CATEGORIES = ["rings", "necklaces", "earrings", "bangles", "pendants", "other"];

export const createCounterOrderValidator = [
  ...createOrderValidator,
  body("items").isArray({ min: 1 }).withMessage("Pick at least one piece"),
  // A line is an existing piece or a custom one, never neither.
  body("items.*").custom((item) => {
    const custom = item?.custom;
    if (!custom) {
      if (Number.isInteger(Number(item?.jewelryId)) && Number(item.jewelryId) >= 1) return true;
      throw new Error("Each line needs a jewelryId or a custom piece");
    }
    if (typeof custom.name !== "string" || custom.name.trim() === "") throw new Error("A custom piece needs a name");
    if (!CUSTOM_CATEGORIES.includes(custom.category)) throw new Error("A custom piece needs a category");
    if (custom.description != null && (typeof custom.description !== "string" || custom.description.length > 1000)) {
      throw new Error("A custom piece's description is too long");
    }
    if (custom.size != null && (typeof custom.size !== "string" || custom.size.length > 60)) {
      throw new Error("A custom piece's size is too long");
    }
    return true;
  }),
];

export const updateOrderStatusValidator = [
  body("status").optional().isIn(["pending", "confirmed", "completed", "cancelled"]),
  body("paymentStatus").optional().isIn(["unpaid", "awaiting_verification", "paid"]),
];

export const updateOrderDetailsValidator = [
  body("recipientName").optional().isString().trim().notEmpty().withMessage("Recipient name is required"),
  body("phone").optional().isString().trim().notEmpty().withMessage("Phone is required"),
  body("addressLine").optional().isString().trim().notEmpty().withMessage("Delivery address is required"),
  body("city").optional().isString().trim().notEmpty().withMessage("City is required"),
  body("notes").optional({ nullable: true }).isString().isLength({ max: 500 }),
  body("paymentMethod").optional().isIn(["cod", "esewa_qr"]),
  body("items").optional().isArray(),
  body("items.*").custom((item) => {
    if (!Number.isInteger(Number(item?.id))) throw new Error("Each edited line needs an id");
    if (typeof item.name !== "string" || item.name.trim() === "") throw new Error("A custom piece needs a name");
    if (!CUSTOM_CATEGORIES.includes(item.category)) throw new Error("A custom piece needs a category");
    return true;
  }),
];

export const linkCustomPieceValidator = [
  body("jewelryId").isInt({ min: 1 }).withMessage("Choose the finished piece"),
];
