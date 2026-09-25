import express from "express";
import * as controller from "./controller.customers";
import { createCustomerValidator, updateCustomerValidator } from "./validator.customers";
import { authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

// Staff-facing. Customers appear on tax documents, so only admins touch them.
router.use(authenticateAdmin);

router.get("/", asyncHandler(controller.listCustomers));
router.post("/", createCustomerValidator, asyncHandler(controller.createCustomer));
router.post("/find-or-create", createCustomerValidator, asyncHandler(controller.findOrCreateCustomer));
router.get("/:id", asyncHandler(controller.getCustomer));
router.put("/:id", updateCustomerValidator, asyncHandler(controller.updateCustomer));

// No delete route. A customer named on an invoice has to stay for the document
// to keep reading correctly; the foreign keys are RESTRICT for the same reason.

export default router;
