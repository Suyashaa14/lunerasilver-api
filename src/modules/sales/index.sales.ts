import express from "express";
import * as controller from "./controller.sales";
import { authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

// Read-only. The sales table is retired (now sales_legacy); a counter sale is
// customers -> invoices -> payments -> inventory_transactions.
const router = express.Router();

router.use(authenticateAdmin);

router.get("/", asyncHandler(controller.listSales));
router.get("/summary", asyncHandler(controller.getSummary));
router.get("/monthly", asyncHandler(controller.getMonthlySeries));
router.get("/by-category", asyncHandler(controller.getByCategory));
router.get("/by-product", asyncHandler(controller.getByProduct));
router.get("/:id", asyncHandler(controller.getSale));

export default router;
