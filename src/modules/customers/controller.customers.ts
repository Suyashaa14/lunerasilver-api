import { Request, Response } from "express";
import { validationResult } from "express-validator";
import * as provider from "./provider.customers";
import db from "../../utils/db";
import { auditActor } from "../../utils/audit";

const rejectInvalid = (req: Request, res: Response): boolean => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ status: false, errors: errors.array() });
  return true;
};

const parse = (body: any) => ({
  name: body.name,
  phone: body.phone,
  email: body.email,
  pan: body.pan,
  addressLine: body.addressLine,
  city: body.city,
});

export const listCustomers = async (req: Request, res: Response) => {
  res.json(
    await provider.listCustomers({
      search: req.query.search ? String(req.query.search) : undefined,
      page: req.query.page ? Math.max(1, Number(req.query.page)) : 1,
      pageSize: req.query.pageSize ? Math.max(1, Number(req.query.pageSize)) : 20,
    }),
  );
};

export const getCustomer = async (req: Request, res: Response) => {
  const customer = await provider.getCustomer(Number(req.params.id));
  if (!customer) return res.status(404).json({ status: false, message: "Customer not found" });
  res.json(customer);
};

export const createCustomer = async (req: Request, res: Response) => {
  if (rejectInvalid(req, res)) return;
  res.status(201).json(await provider.createCustomer(parse(req.body), auditActor(req)));
};

export const updateCustomer = async (req: Request, res: Response) => {
  if (rejectInvalid(req, res)) return;
  const customer = await provider.updateCustomer(Number(req.params.id), parse(req.body), auditActor(req));
  if (!customer) return res.status(404).json({ status: false, message: "Customer not found" });
  res.json(customer);
};

// One call for the counter: reuse the buyer if their number is known, create
// them if not. Wrapped in a transaction so the audit row travels with it.
export const findOrCreateCustomer = async (req: Request, res: Response) => {
  if (rejectInvalid(req, res)) return;
  const actor = auditActor(req);
  const customer = await db.transaction((trx) => provider.findOrCreateByPhone(trx, parse(req.body), actor));
  res.json(customer);
};
