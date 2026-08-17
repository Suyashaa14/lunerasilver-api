import { body, ValidationChain } from "express-validator";

export const createSaleValidator: ValidationChain[] = [
  body("ringName").isString().trim().notEmpty().withMessage("Ring name is required"),
  body("category").optional({ values: "falsy" }).isString().trim(),
  body("jewelryId").optional({ values: "null" }).isInt({ min: 1 }),
  body("source").isIn(["homemade", "bought"]).withMessage("source must be 'homemade' or 'bought'"),
  body("silverWeightGrams").isFloat({ min: 0 }).withMessage("Silver weight must be a positive number"),
  body("silverRatePerGram").isFloat({ min: 0 }).withMessage("Silver rate must be a positive number"),
  body("stoneWeightGrams").optional({ values: "null" }).isFloat({ min: 0 }),
  body("stonePrice").optional({ values: "null" }).isFloat({ min: 0 }),
  body("makingCharge").optional({ values: "null" }).isFloat({ min: 0 }),
  body("soldPrice").isFloat({ min: 0 }).withMessage("Sold price must be a positive number"),
  body("soldAt").isISO8601().withMessage("Sold date is required"),
  body("notes").optional({ values: "null" }).isString(),
];

export const updateSaleValidator: ValidationChain[] = [
  body("ringName").optional().isString().trim().notEmpty(),
  body("category").optional({ values: "falsy" }).isString().trim(),
  body("jewelryId").optional({ values: "null" }).isInt({ min: 1 }),
  body("source").optional().isIn(["homemade", "bought"]),
  body("silverWeightGrams").optional().isFloat({ min: 0 }),
  body("silverRatePerGram").optional().isFloat({ min: 0 }),
  body("stoneWeightGrams").optional({ values: "null" }).isFloat({ min: 0 }),
  body("stonePrice").optional({ values: "null" }).isFloat({ min: 0 }),
  body("makingCharge").optional({ values: "null" }).isFloat({ min: 0 }),
  body("soldPrice").optional().isFloat({ min: 0 }),
  body("soldAt").optional().isISO8601(),
  body("notes").optional({ values: "null" }).isString(),
];
