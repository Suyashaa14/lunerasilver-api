import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as provider from "./provider.orders";
import { auditActor } from "../../utils/audit";

export const createOrder = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }
  const order = await provider.createOrder(req.user!.id, req.body);
  res.status(201).json(order);
};

/** The shop taking an order itself, rather than one arriving from the website. */
export const createCounterOrder = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }
  res.status(201).json(await provider.createCounterOrder(req.body, auditActor(req)));
};

export const invoiceOrder = async (req: Request, res: Response) => {
  res.status(201).json(await provider.invoiceOrder(Number(req.params.id), auditActor(req)));
};

export const myOrders = async (req: Request, res: Response) => {
  res.json(await provider.getMyOrders(req.user!.id));
};

export const listOrders = async (req: Request, res: Response) => {
  const { page, pageSize, status } = req.query;
  res.json(
    await provider.listOrders({
      page: page ? Math.max(1, Number(page)) : 1,
      pageSize: pageSize ? Math.max(1, Number(pageSize)) : 20,
      status: status ? String(status) : undefined,
    }),
  );
};

export const getOrder = async (req: Request, res: Response) => {
  const order = await provider.getOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ status: false, message: "Order not found" });
  if (req.user!.role !== "admin" && order.userId !== req.user!.id) {
    return res.status(403).json({ status: false, message: "Forbidden" });
  }
  res.json(order);
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }
  const order = await provider.updateOrderStatus(Number(req.params.id), req.body);
  if (!order) return res.status(404).json({ status: false, message: "Order not found" });
  res.json(order);
};
