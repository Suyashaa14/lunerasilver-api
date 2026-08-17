import { body, ValidationChain } from "express-validator";

const pricingFieldsValidator: ValidationChain[] = [
  body("pricingMode").isIn(["makingCharge", "totalCost"]).withMessage("pricingMode must be 'makingCharge' or 'totalCost'"),
  body("makingCharge")
    .if(body("pricingMode").equals("makingCharge"))
    .isFloat({ min: 0 })
    .withMessage("makingCharge is required and must be a positive number"),
  body("totalCost")
    .if(body("pricingMode").equals("totalCost"))
    .isFloat({ min: 0 })
    .withMessage("totalCost is required and must be a positive number"),
];

export const createJewelryValidator: ValidationChain[] = [
  body("name").isString().trim().notEmpty().withMessage("Name is required"),
  body("category").isString().trim().notEmpty().withMessage("Category is required"),
  body("silverWeightGrams").isFloat({ min: 0 }).withMessage("Silver weight must be a positive number"),
  ...pricingFieldsValidator,
  body("stoneWeightGrams").optional({ values: "null" }).isFloat({ min: 0 }),
  body("stonePrice").optional({ values: "null" }).isFloat({ min: 0 }),
];

export const updateJewelryValidator: ValidationChain[] = [
  body("name").optional().isString().trim().notEmpty(),
  body("category").optional().isString().trim().notEmpty(),
  body("silverWeightGrams").optional().isFloat({ min: 0 }),
  body("pricingMode").optional().isIn(["makingCharge", "totalCost"]),
  body("makingCharge").optional().isFloat({ min: 0 }),
  body("totalCost").optional().isFloat({ min: 0 }),
  body("stoneWeightGrams").optional({ values: "null" }).isFloat({ min: 0 }),
  body("stonePrice").optional({ values: "null" }).isFloat({ min: 0 }),
];
