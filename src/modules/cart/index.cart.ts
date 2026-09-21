import express from "express";
import * as controller from "./controller.cart";
import { addToCartValidator } from "./validator.cart";
import { asyncHandler } from "../../utils/asyncHandler";

const router = express.Router();

router.get("/", asyncHandler(controller.getCart));
router.post("/", addToCartValidator, asyncHandler(controller.addToCart));
router.delete("/:jewelryId", asyncHandler(controller.removeFromCart));

export default router;
