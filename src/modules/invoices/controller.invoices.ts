import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as issuer from "./provider.issue";
import * as voider from "./provider.void";
import * as creditNotes from "./provider.creditNote";
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

export const issueCreditNote = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ status: false, errors: errors.array() });
  }

  const note = await creditNotes.issueCreditNote(
    { ...req.body, invoiceId: Number(req.params.id) },
    auditActor(req),
  );
  res.status(201).json(note);
};

export const getCreditNote = async (req: Request, res: Response) => {
  const note = await creditNotes.getCreditNote(Number(req.params.id));
  if (!note) return res.status(404).json({ status: false, message: "Credit note not found" });
  res.json(note);
};

export const listInvoices = async (req: Request, res: Response) => {
  res.json(
    await issuer.listInvoices({
      search: req.query.search ? String(req.query.search) : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      includeVoid: req.query.includeVoid === "true",
      page: req.query.page ? Math.max(1, Number(req.query.page)) : 1,
      pageSize: req.query.pageSize ? Math.max(1, Number(req.query.pageSize)) : 20,
    }),
  );
};
