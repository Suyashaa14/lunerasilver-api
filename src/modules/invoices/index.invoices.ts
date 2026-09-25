import express from "express";
import * as controller from "./controller.invoices";
import { issueInvoiceValidator } from "./validator.invoices";
import { authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.use(authenticateAdmin);

router.post("/", issueInvoiceValidator, asyncHandler(controller.issueInvoice));
router.get("/:id", asyncHandler(controller.getInvoice));

// No update and no delete. An issued invoice is immutable -- Step 1.3 adds the
// only permitted change, which is voiding it.

export default router;
