import { body } from "express-validator";

export const addToCartValidator = [
  body("jewelryId").isInt({ min: 1 }).withMessage("jewelryId is required and must be a positive integer"),
];
