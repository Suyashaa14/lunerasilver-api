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

/** A sale from before the system, typed in from its paper bill. */
export const oldSaleValidator: ValidationChain[] = [
  body("billNo").isString().trim().notEmpty().withMessage("The old bill number is required")
    .isLength({ max: 32 }).withMessage("Bill number is too long"),
  body("date").isISO8601().withMessage("The bill date is required"),
  body("paymentMethod").isIn(["cash", "cod", "esewa_qr", "bank_transfer"]),
  body("paid").optional().isBoolean(),
  body("discount").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("customer.name").optional({ values: "falsy" }).isString().trim(),
  body("customer.phone").optional({ values: "falsy" }).isString().trim(),
  body("location").optional({ values: "falsy" }).isString().trim().isLength({ max: 190 }),
  body("silverRatePerGram").optional({ values: "falsy" }).isFloat({ min: 0 }),
  body("items").isArray({ min: 1 }).withMessage("At least one line is required"),
  body("items.*.name").isString().trim().notEmpty().withMessage("Each line needs a piece name"),
  body("items.*.category").optional({ values: "falsy" }).isString(),
  body("items.*.quantity").isInt({ min: 1 }).withMessage("Quantity must be at least 1"),
  body("items.*.weightGrams").isFloat({ min: 0 }).withMessage("Each line needs a weight"),
  body("items.*.amount").isFloat({ gt: 0 }).withMessage("Each line needs an amount"),
  body("items.*.makingCharge").optional({ values: "null" }).isFloat({ min: 0 }).withMessage("Making charge must be a number"),
  body("finalTotal").optional({ values: "null" }).isFloat({ gt: 0 }),
];
