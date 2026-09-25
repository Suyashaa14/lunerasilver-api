import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as issuer from "./provider.issue";
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
