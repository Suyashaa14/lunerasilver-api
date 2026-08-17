import { body } from "express-validator";

export const updateSilverRateValidator = [
  body("silverRatePerGram").isFloat({ gt: 0 }).withMessage("silverRatePerGram must be a positive number"),
];
