import express from "express";
import * as controller from "./controller.invoices";
import { issueInvoiceValidator, creditNoteValidator } from "./validator.invoices";
import { authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.use(authenticateAdmin);

router.get("/", asyncHandler(controller.listInvoices));

// Analytics, from issued invoices rather than the retired sales table.
// Declared before /:id so the words are not read as invoice ids.
router.get("/summary", asyncHandler(controller.getSummary));
router.get("/monthly", asyncHandler(controller.getMonthlySeries));
router.get("/by-category", asyncHandler(controller.getByCategory));
router.get("/by-product", asyncHandler(controller.getByProduct));
router.post("/", issueInvoiceValidator, asyncHandler(controller.issueInvoice));
router.get("/:id", asyncHandler(controller.getInvoice));
router.post("/:id/void", asyncHandler(controller.voidInvoice));
router.post("/:id/print", asyncHandler(controller.printInvoice));
router.post("/:id/credit-note", creditNoteValidator, asyncHandler(controller.issueCreditNote));
router.get("/credit-notes/:id", asyncHandler(controller.getCreditNote));

// No update and no delete. Voiding and counting a print are the only changes
// an issued invoice allows, and src/utils/writeGuards.ts enforces that.

export default router;
