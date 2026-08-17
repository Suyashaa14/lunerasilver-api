import express from "express";
import * as controller from "./controller.expenses";
import { createExpenseValidator, updateExpenseValidator } from "./validator.expenses";
import { authenticateUser, authenticateAdmin } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.use(authenticateUser, authenticateAdmin);

router.get("/", asyncHandler(controller.listExpenses));
router.get("/summary", asyncHandler(controller.getSummary));
router.get("/monthly", asyncHandler(controller.getMonthlySeries));
router.get("/by-category", asyncHandler(controller.getByCategory));
router.get("/:id", asyncHandler(controller.getExpense));
router.post("/", createExpenseValidator, asyncHandler(controller.createExpense));
router.put("/:id", updateExpenseValidator, asyncHandler(controller.updateExpense));
router.delete("/:id", asyncHandler(controller.deleteExpense));

export default router;
