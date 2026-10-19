import express from "express";
import * as controller from "./controller.invoices";
import { issueInvoiceValidator, creditNoteValidator, oldSaleValidator } from "./validator.invoices";
import { authenticateAdmin, authenticateStaff } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

// Selling is staff work. Voiding, crediting and reprinting are not -- those
// change what the books already say.
router.use(authenticateStaff);

router.get("/", asyncHandler(controller.listInvoices));

// Analytics, from issued invoices rather than the retired sales table.
// Declared before /:id so the words are not read as invoice ids.
router.get("/summary", asyncHandler(controller.getSummary));
router.get("/monthly", asyncHandler(controller.getMonthlySeries));
router.get("/by-category", asyncHandler(controller.getByCategory));
router.get("/by-product", asyncHandler(controller.getByProduct));
router.post("/", issueInvoiceValidator, asyncHandler(controller.issueInvoice));
// Back-dated and outside the numbered series, so the owner's call, not the till's.
router.post("/old", authenticateAdmin, oldSaleValidator, asyncHandler(controller.logOldSale));
// Old bills are typed from paper, so unlike issued invoices they can be corrected
// or removed. See provider.oldSale.ts for what that does to the books.
router.get("/:id/old", authenticateAdmin, asyncHandler(controller.getOldSale));
router.put("/:id/old", authenticateAdmin, oldSaleValidator, asyncHandler(controller.updateOldSale));
router.delete("/:id/old", authenticateAdmin, asyncHandler(controller.deleteOldSale));
router.get("/:id/edit", authenticateAdmin, asyncHandler(controller.getSaleForEdit));
router.put("/:id", authenticateAdmin, issueInvoiceValidator, asyncHandler(controller.updateInvoice));
router.delete("/:id", authenticateAdmin, asyncHandler(controller.deleteInvoice));
router.get("/:id", asyncHandler(controller.getInvoice));
router.post("/:id/void", authenticateAdmin, asyncHandler(controller.voidInvoice));
router.post("/:id/print", asyncHandler(controller.printInvoice));
router.post("/:id/credit-note", authenticateAdmin, creditNoteValidator, asyncHandler(controller.issueCreditNote));
router.get("/credit-notes/:id", asyncHandler(controller.getCreditNote));

// Editing or deleting a sale replaces it through provider.amend.ts, which
// reverses what it posted and keeps an audit copy. The write guards still stop
// every other path from touching an issued invoice.

export default router;
