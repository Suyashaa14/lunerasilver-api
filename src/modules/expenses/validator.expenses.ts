import { body, ValidationChain } from "express-validator";

export const createExpenseValidator: ValidationChain[] = [
  body("category").isString().trim().notEmpty().withMessage("Category is required"),
  body("amount").isFloat({ min: 0 }).withMessage("Amount must be a positive number"),
  body("spentAt").isISO8601().withMessage("Date is required"),
  body("note").optional({ values: "null" }).isString(),
];

export const updateExpenseValidator: ValidationChain[] = [
  body("category").optional().isString().trim().notEmpty(),
  body("amount").optional().isFloat({ min: 0 }),
  body("spentAt").optional().isISO8601(),
  body("note").optional({ values: "null" }).isString(),
];
