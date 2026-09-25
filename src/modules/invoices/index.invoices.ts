import express from "express";
import * as controller from "./controller.invoices";
import { issueInvoiceValidator } from "./validator.invoices";
import { authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.use(authenticateAdmin);

router.post("/", issueInvoiceValidator, asyncHandler(controller.issueInvoice));
router.get("/:id", asyncHandler(controller.getInvoice));
router.post("/:id/void", asyncHandler(controller.voidInvoice));
router.post("/:id/print", asyncHandler(controller.printInvoice));

// No update and no delete. Voiding and counting a print are the only changes
// an issued invoice allows, and src/utils/writeGuards.ts enforces that.

export default router;
