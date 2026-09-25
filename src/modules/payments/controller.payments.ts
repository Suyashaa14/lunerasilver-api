import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as provider from "./provider.payments";
import db from "../../utils/db";
import { auditActor } from "../../utils/audit";

const rejectInvalid = (req: Request, res: Response): boolean => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ status: false, errors: errors.array() });
  return true;
};

export const recordPayment = async (req: Request, res: Response) => {
  if (rejectInvalid(req, res)) return;
  res.status(201).json(await provider.recordPayment(req.body, auditActor(req)));
};

export const refundPayment = async (req: Request, res: Response) => {
  if (rejectInvalid(req, res)) return;
  res.status(201).json(await provider.refundPayment(req.body, auditActor(req)));
};

export const verifyPayment = async (req: Request, res: Response) => {
  const payment = await provider.verifyPayment(Number(req.params.id), auditActor(req));
  if (!payment) return res.status(404).json({ status: false, message: "Payment not found" });
  res.json(payment);
};

export const rejectPayment = async (req: Request, res: Response) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length === 0) {
    return res.status(400).json({ status: false, message: "A reason is required to reject a payment" });
  }
  const payment = await provider.rejectPayment(Number(req.params.id), auditActor(req), reason);
  if (!payment) return res.status(404).json({ status: false, message: "Payment not found" });
  res.json(payment);
};

export const listPayments = async (req: Request, res: Response) => {
  res.json(
    await provider.listPayments({
      invoiceId: req.query.invoiceId ? Number(req.query.invoiceId) : undefined,
      orderId: req.query.orderId ? Number(req.query.orderId) : undefined,
    }),
  );
};

export const getInvoiceBalance = async (req: Request, res: Response) => {
  const balance = await provider.getInvoiceBalance(db, Number(req.params.invoiceId));
  if (!balance) return res.status(404).json({ status: false, message: "Invoice not found" });
  res.json(balance);
};
