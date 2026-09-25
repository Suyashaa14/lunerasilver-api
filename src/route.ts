import express, { Request, Response } from "express";
import customersRouter from "./modules/customers/index.customers";
import invoicesRouter from "./modules/invoices/index.invoices";
import paymentsRouter from "./modules/payments/index.payments";
import jewelriesRouter from "./modules/jewelries/index.jewelries";
import settingsRouter from "./modules/settings/index.settings";
import cartRouter from "./modules/cart/index.cart";
import ordersRouter from "./modules/orders/index.orders";
import dashboardRouter from "./modules/dashboard/index.dashboard";
import salesRouter from "./modules/sales/index.sales";
import expensesRouter from "./modules/expenses/index.expenses";

const router = express.Router();

router.use("/hello", (_req: Request, res: Response) => {
  res.status(200).json({ status: true, message: "Hello! This is the Lunera Silver API" });
});

router.use("/customers", customersRouter);
router.use("/invoices", invoicesRouter);
router.use("/payments", paymentsRouter);
router.use("/jewelries", jewelriesRouter);
router.use("/settings", settingsRouter);
router.use("/cart", cartRouter);
router.use("/orders", ordersRouter);
router.use("/dashboard", dashboardRouter);
router.use("/sales", salesRouter);
router.use("/expenses", expensesRouter);

// 404 catch-all for anything under /api not matched above
router.use((_req: Request, res: Response) => {
  res.status(404).json({ status: false, message: "Route not found" });
});

export default router;
