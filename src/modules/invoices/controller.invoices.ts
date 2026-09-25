import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as issuer from "./provider.issue";
import * as voider from "./provider.void";
import { auditActor } from "../../utils/audit";

export const issueInvoice = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }

  const invoice = await issuer.issueInvoice(req.body, auditActor(req));
  res.status(201).json(invoice);
};

export const getInvoice = async (req: Request, res: Response) => {
  const invoice = await issuer.getInvoice(Number(req.params.id));
  if (!invoice) return res.status(404).json({ status: false, message: "Invoice not found" });
  res.json(invoice);
};

export const voidInvoice = async (req: Request, res: Response) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length === 0) {
    return res.status(400).json({ status: false, message: "A reason is required to void an invoice" });
  }

  const invoice = await voider.voidInvoice(Number(req.params.id), reason, auditActor(req));
  if (!invoice) return res.status(404).json({ status: false, message: "Invoice not found" });
  res.json(invoice);
};

export const printInvoice = async (req: Request, res: Response) => {
  const invoice = await voider.recordPrint(Number(req.params.id), auditActor(req));
  if (!invoice) return res.status(404).json({ status: false, message: "Invoice not found" });
  // The first print is the original; the rest must be marked COPY.
  res.json({ ...invoice, isCopy: invoice.printCount > 1 });
};
