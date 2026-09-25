import { body, ValidationChain } from "express-validator";

const METHODS = ["cash", "cod", "esewa_qr", "bank_transfer", "card"];

export const recordPaymentValidator: ValidationChain[] = [
  body("invoiceId").optional({ values: "falsy" }).isInt({ min: 1 }),
  body("orderId").optional({ values: "falsy" }).isInt({ min: 1 }),
  body("amount").isFloat({ gt: 0 }).withMessage("Amount must be more than zero"),
  body("method").isIn(METHODS).withMessage(`method must be one of: ${METHODS.join(", ")}`),
  body("referenceNo").optional({ values: "falsy" }).isString().trim().isLength({ max: 80 }),
  body("receivedAt").optional({ values: "falsy" }).isISO8601(),
  body("note").optional({ values: "falsy" }).isString(),
];

export const refundPaymentValidator: ValidationChain[] = [
  body("invoiceId").optional({ values: "falsy" }).isInt({ min: 1 }),
  body("orderId").optional({ values: "falsy" }).isInt({ min: 1 }),
  body("amount").isFloat({ gt: 0 }).withMessage("Refund amount must be more than zero"),
  body("method").isIn(METHODS),
  body("reason").isString().trim().notEmpty().withMessage("A reason is required for a refund"),
  body("receivedAt").optional({ values: "falsy" }).isISO8601(),
];
