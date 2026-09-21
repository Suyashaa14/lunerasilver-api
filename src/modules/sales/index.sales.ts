import express from "express";
import * as controller from "./controller.sales";
import { createSaleValidator, updateSaleValidator } from "./validator.sales";
import { authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.use(authenticateAdmin);

router.get("/", asyncHandler(controller.listSales));
router.get("/summary", asyncHandler(controller.getSummary));
router.get("/monthly", asyncHandler(controller.getMonthlySeries));
router.get("/by-category", asyncHandler(controller.getByCategory));
router.get("/by-product", asyncHandler(controller.getByProduct));
router.get("/:id", asyncHandler(controller.getSale));
router.post("/", createSaleValidator, asyncHandler(controller.createSale));
router.put("/:id", updateSaleValidator, asyncHandler(controller.updateSale));
router.delete("/:id", asyncHandler(controller.deleteSale));

export default router;
