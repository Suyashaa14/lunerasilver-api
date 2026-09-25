import express from "express";
import * as controller from "./controller.payments";
import { recordPaymentValidator, refundPaymentValidator } from "./validator.payments";
import { authenticateAdmin, authenticateStaff } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.use(authenticateStaff);

router.get("/", asyncHandler(controller.listPayments));
router.post("/", recordPaymentValidator, asyncHandler(controller.recordPayment));
router.post("/refund", refundPaymentValidator, asyncHandler(controller.refundPayment));
router.get("/balance/:invoiceId", asyncHandler(controller.getInvoiceBalance));
router.post("/:id/verify", asyncHandler(controller.verifyPayment));
router.post("/:id/reject", asyncHandler(controller.rejectPayment));

// No delete. Money that came in and went back out are two rows, not one edit.

export default router;
