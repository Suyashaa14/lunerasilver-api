import { body, ValidationChain } from "express-validator";

const optionalText = (field: string, max: number) =>
  body(field).optional({ values: "falsy" }).isString().trim().isLength({ max });

export const createCustomerValidator: ValidationChain[] = [
  body("name").isString().trim().notEmpty().withMessage("Name is required").isLength({ max: 120 }),
  optionalText("phone", 20),
  body("email").optional({ values: "falsy" }).isEmail().withMessage("Enter a valid email"),
  // Nepali PAN is nine digits. Kept optional: it is only required when the
  // buyer is VAT-registered.
  body("pan").optional({ values: "falsy" }).isString().trim().matches(/^\d{9}$/).withMessage("PAN must be 9 digits"),
  optionalText("addressLine", 190),
  optionalText("city", 190),
];

export const updateCustomerValidator: ValidationChain[] = [
  body("name").optional().isString().trim().notEmpty().isLength({ max: 120 }),
  optionalText("phone", 20),
  body("email").optional({ values: "falsy" }).isEmail(),
  body("pan").optional({ values: "falsy" }).isString().trim().matches(/^\d{9}$/).withMessage("PAN must be 9 digits"),
  optionalText("addressLine", 190),
  optionalText("city", 190),
];
