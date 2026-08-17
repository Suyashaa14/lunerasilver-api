import express from "express";
import * as controller from "./controller.cart";
import { addToCartValidator } from "./validator.cart";
import { authenticateUser } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.use(authenticateUser);
router.get("/", asyncHandler(controller.getCart));
router.post("/", addToCartValidator, asyncHandler(controller.addToCart));
router.delete("/:jewelryId", asyncHandler(controller.removeFromCart));

export default router;
