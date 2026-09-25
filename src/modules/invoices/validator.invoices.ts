import { body, ValidationChain } from "express-validator";

export const issueInvoiceValidator: ValidationChain[] = [
  body("paymentMethod")
    .isIn(["cash", "cod", "esewa_qr", "bank_transfer"])
    .withMessage("paymentMethod must be cash, cod, esewa_qr or bank_transfer"),
  body("issuedAt").optional({ values: "falsy" }).isISO8601().withMessage("issuedAt must be a date"),
  body("orderId").optional({ values: "null" }).isInt({ min: 1 }),
  body("customerId").optional({ values: "falsy" }).isInt({ min: 1 }),
  body("customer.name").optional({ values: "falsy" }).isString().trim().notEmpty(),
  body("items").isArray({ min: 1 }).withMessage("At least one item is required"),
  body("items.*.jewelryId").isInt({ min: 1 }).withMessage("Each item needs a jewelryId"),
  body("items.*.unitPrice").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("items.*.discount").optional({ values: "falsy" }).isFloat({ min: 0 }),
];

export const creditNoteValidator: ValidationChain[] = [
  body("reason").isString().trim().notEmpty().withMessage("A reason is required for a credit note"),
  body("issuedAt").optional({ values: "falsy" }).isISO8601(),
  body("items").optional({ values: "falsy" }).isArray(),
  body("items.*.invoiceItemId").optional().isInt({ min: 1 }),
  body("items.*.amount").optional({ values: "falsy" }).isFloat({ gt: 0 }),
  body("refund.amount").optional({ values: "falsy" }).isFloat({ gt: 0 }),
  body("refund.method").optional({ values: "falsy" }).isIn(["cash", "esewa_qr", "bank_transfer", "card"]),
];
