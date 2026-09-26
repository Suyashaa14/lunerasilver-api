import type { Knex } from "knex";
import db from "../../utils/db";
import { computePrice } from "../../utils/pricing";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { stampForDate } from "../../utils/fiscalYear";
import { allocateNumber } from "../../services/numbering/service.numbering";
import { findOrCreateByPhone } from "../customers/provider.customers";
import { getCurrentSilverRatePerGram } from "../settings/provider.settings";
import { postInvoice } from "../ledger/provider.posting";
import { IssueInvoicePayload, InvoiceDTO, InvoiceItemDTO } from "./interface/interface.invoices";


/**
 * A timestamp for a document dated `dateOnly` (YYYY-MM-DD).
 *
 * Today's documents get the actual current instant. Back-dated ones get the
 * start of that day. Never a locally-formatted time string: the connection runs
 * in UTC, so a local clock reading would be stored as though it were UTC and
 * land the document hours in the future.
 */
const timestampFor = (dateOnly: string): Date | string =>
  dateOnly === new Date().toISOString().slice(0, 10) ? new Date() : `${dateOnly} 00:00:00`;

/** Statuses a piece can be sold from. Anything else is already gone. */
const SELLABLE = ["available", "reserved"];

const money = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const itemToDTO = (row: any): InvoiceItemDTO => ({
  id: row.id,
  jewelryId: num(row.jewelry_id),
  name: row.name_snapshot,
  sku: row.sku_snapshot,
  silverWeightGrams: num(row.silver_weight_snapshot),
  silverRatePerGram: num(row.silver_rate_snapshot),
  makingCharge: num(row.making_charge_snapshot),
  stoneWeightGrams: num(row.stone_weight_snapshot),
  stonePrice: num(row.stone_price_snapshot),
  quantity: Number(row.quantity),
  unitPrice: Number(row.unit_price),
  discount: Number(row.discount),
  taxableAmount: Number(row.taxable_amount),
  vatAmount: Number(row.vat_amount),
  lineTotal: Number(row.line_total),
});

const toDTO = (invoice: any, items: any[]): InvoiceDTO => ({
  id: invoice.id,
  invoiceNo: invoice.invoice_no,
  fiscalYear: invoice.fiscal_year,
  series: invoice.series,
  orderId: num(invoice.order_id),
  customerId: Number(invoice.customer_id),
  issuedAt: invoice.issued_at,
  issuedDateBs: invoice.issued_date_bs,
  seller: { name: invoice.seller_name, address: invoice.seller_address, pan: invoice.seller_pan },
  buyer: { name: invoice.buyer_name, address: invoice.buyer_address, pan: invoice.buyer_pan },
  subtotal: Number(invoice.subtotal),
  discount: Number(invoice.discount),
  taxableAmount: Number(invoice.taxable_amount),
  vatAmount: Number(invoice.vat_amount),
  vatRate: Number(invoice.vat_rate),
  totalAmount: Number(invoice.total_amount),
  paymentMethod: invoice.payment_method,
  isVoid: Boolean(invoice.is_void),
  voidReason: invoice.void_reason,
  printCount: Number(invoice.print_count),
  items: items.map(itemToDTO),
});

export const getInvoice = async (id: number): Promise<InvoiceDTO | null> => {
  const invoice = await db("invoices").where({ id }).first();
  if (!invoice) return null;
  const items = await db("invoice_items").where({ invoice_id: id }).orderBy("id");
  return toDTO(invoice, items);
};

/**
 * Issues a tax invoice.
 *
 * Everything happens in one transaction, so the document, the stock movement
 * and the audit row are all present or none of them are. A half-issued invoice
 * is worse than no invoice: it is a number handed out against a sale that did
 * not happen.
 *
 * Every figure written to invoice_items is a snapshot taken now -- weight, rate,
 * making charge, price. The invoice must still read correctly years later, when
 * the silver rate has moved and the piece may have been edited or deleted from
 * the catalogue.
 */
export const issueInvoice = async (payload: IssueInvoicePayload, actor: AuditActor): Promise<InvoiceDTO> => {
  if (!payload.items || payload.items.length === 0) {
    throw Object.assign(new Error("An invoice needs at least one item"), { status: 400 });
  }

  const invoiceId = await db.transaction(async (trx) => {
    const business = await trx("business_profile").first();
    if (!business) {
      throw Object.assign(
        new Error("No business profile. Seed business_profile before issuing documents."),
        { status: 400 },
      );
    }

    // Buyer first: the invoice cannot exist without one, and doing it inside
    // this transaction means a failed sale leaves no stray customer behind.
    let customerId = payload.customerId ?? null;
    if (!customerId) {
      if (!payload.customer?.name) {
        throw Object.assign(new Error("A customer is required"), { status: 400 });
      }
      const customer = await findOrCreateByPhone(trx, payload.customer, actor);
      customerId = customer.id;
    }

    const customer = await trx("customers").where({ id: customerId }).first();
    if (!customer) throw Object.assign(new Error("Customer not found"), { status: 404 });

    const issuedAt = payload.issuedAt ?? new Date().toISOString().slice(0, 10);
    // Refuses a closed fiscal year.
    const { fiscalYear, bsDate } = await stampForDate(trx, issuedAt);
    const invoiceNo = await allocateNumber(trx, fiscalYear, "SALES");

    // Locked so two tills cannot sell the same piece. The second request waits
    // here, then finds the piece already sold and is refused.
    const jewelryIds = payload.items.map((i) => i.jewelryId);
    const pieces = await trx("jewelries").whereIn("id", jewelryIds).forUpdate();

    const byId = new Map(pieces.map((p: any) => [Number(p.id), p]));
    for (const line of payload.items) {
      const piece = byId.get(line.jewelryId);
      if (!piece) throw Object.assign(new Error(`Piece ${line.jewelryId} not found`), { status: 404 });
      if (!SELLABLE.includes(piece.status)) {
        throw Object.assign(
          new Error(`${piece.name} is ${piece.status} and cannot be sold`),
          { status: 409 },
        );
      }
    }

    const rate = await getCurrentSilverRatePerGram(trx);
    // VAT columns are written even when not registered -- as zero -- so the
    // shape never changes if registration happens later.
    const vatRate = business.is_vat_registered ? Number(business.default_vat_rate) : 0;

    const lines = payload.items.map((line) => {
      const piece = byId.get(line.jewelryId);
      const unitPrice =
        line.unitPrice !== undefined
          ? money(line.unitPrice)
          : computePrice(Number(piece.silver_weight_grams), Number(piece.making_charge), rate, Number(piece.stone_price ?? 0));
      const discount = money(line.discount ?? 0);
      const lineTotal = money(unitPrice - discount);

      if (lineTotal < 0) {
        throw Object.assign(new Error(`Discount on ${piece.name} is larger than its price`), { status: 400 });
      }

      return {
        piece,
        row: {
          jewelry_id: piece.id,
          name_snapshot: piece.name,
          sku_snapshot: piece.sku,
          category_snapshot: piece.category,
          image_snapshot: piece.image_url,
          silver_weight_snapshot: piece.silver_weight_grams,
          silver_rate_snapshot: rate,
          making_charge_snapshot: piece.making_charge,
          stone_weight_snapshot: piece.stone_weight_grams,
          stone_price_snapshot: piece.stone_price,
          quantity: 1,
          unit_price: unitPrice,
          discount,
          taxable_amount: lineTotal,
          vat_amount: money(lineTotal * (vatRate / 100)),
          line_total: lineTotal,
        },
      };
    });

    // subtotal is the sum of the line totals, so the two always reconcile.
    const subtotal = money(lines.reduce((sum, l) => sum + l.row.line_total, 0));
    const discount = money(lines.reduce((sum, l) => sum + l.row.discount, 0));
    const vatAmount = money(lines.reduce((sum, l) => sum + l.row.vat_amount, 0));

    const [newInvoiceId] = await trx("invoices").insert({
      invoice_no: invoiceNo,
      fiscal_year: fiscalYear,
      series: "SALES",
      order_id: payload.orderId ?? null,
      customer_id: customerId,
      issued_at: timestampFor(issuedAt),
      issued_date_bs: bsDate,
      // Snapshots, not joins: renaming the shop or the buyer later must not
      // rewrite a document already handed over.
      seller_name: business.legal_name,
      seller_address: `${business.address_line}, ${business.city}`,
      seller_pan: business.pan,
      buyer_name: customer.name,
      buyer_address: [customer.address_line, customer.city].filter(Boolean).join(", ") || "-",
      buyer_pan: customer.pan,
      subtotal,
      discount,
      taxable_amount: subtotal,
      vat_amount: vatAmount,
      total_amount: money(subtotal + vatAmount),
      vat_rate: vatRate,
      payment_method: payload.paymentMethod,
      created_by: actor.userId ?? null,
    });

    await trx("invoice_items").insert(lines.map((l) => ({ ...l.row, invoice_id: newInvoiceId })));

    await trx("jewelries").whereIn("id", jewelryIds).update({ status: "sold", reserved_until: null });

    // One outbound stock row per piece, carrying the cost it was bought at.
    // This is what makes cost of goods real rather than a guess.
    await trx("inventory_transactions").insert(
      lines.map((l) => ({
        jewelry_id: l.piece.id,
        type: "sale",
        direction: "out",
        quantity: 1,
        cost_amount: l.piece.cost_price ?? null,
        reference_type: "invoice",
        reference_id: newInvoiceId,
        created_by: actor.userId ?? null,
      })),
    );

    // The ledger entry is written inside this same transaction: a sale and its
    // posting are one event. If either fails, neither happened.
    await postInvoice(
      trx,
      {
        id: newInvoiceId,
        invoice_no: invoiceNo,
        issued_at: issuedAt,
        taxable_amount: subtotal,
        vat_amount: vatAmount,
        total_amount: money(subtotal + vatAmount),
      },
      lines.reduce((sum, l) => sum + Number(l.piece.cost_price ?? 0), 0),
      actor,
    );

    await writeAuditLog(trx, {
      ...actor,
      action: "create",
      entityType: "invoices",
      entityId: newInvoiceId,
      newValues: { invoice_no: invoiceNo, customer_id: customerId, total_amount: money(subtotal + vatAmount) },
    });

    return newInvoiceId;
  });

  return (await getInvoice(invoiceId))!;
};

export interface InvoiceListFilters {
  search?: string;
  customerId?: number;
  from?: string;
  to?: string;
  includeVoid?: boolean;
  page: number;
  pageSize: number;
}

/** The counter's day book: what was sold, to whom, and what is still owed. */
export const listInvoices = async (filters: InvoiceListFilters) => {
  const base = db("invoices as i").where("i.series", "SALES");

  if (!filters.includeVoid) base.where("i.is_void", false);
  if (filters.customerId) base.where("i.customer_id", filters.customerId);
  if (filters.from) base.where("i.issued_at", ">=", filters.from);
  if (filters.to) base.where("i.issued_at", "<=", `${filters.to} 23:59:59`);
  if (filters.search) {
    const term = `%${filters.search.trim()}%`;
    base.where((q) => q.where("i.invoice_no", "like", term).orWhere("i.buyer_name", "like", term));
  }

  const countRow = await base.clone().count({ c: "*" }).first();
  const rows = await base
    .clone()
    .select("i.*")
    .select(
      db.raw(
        `COALESCE((SELECT SUM(p.amount) FROM payments p
                   WHERE p.invoice_id = i.id AND p.status = 'verified'), 0) AS paid`,
      ),
    )
    .orderBy("i.issued_at", "desc")
    .orderBy("i.id", "desc")
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  return {
    data: rows.map((r: any) => ({
      id: r.id,
      invoiceNo: r.invoice_no,
      issuedAt: r.issued_at,
      issuedDateBs: r.issued_date_bs,
      buyerName: r.buyer_name,
      totalAmount: Number(r.total_amount),
      paid: Number(r.paid),
      outstanding: r.is_void ? 0 : Math.round((Number(r.total_amount) - Number(r.paid)) * 100) / 100,
      paymentMethod: r.payment_method,
      isVoid: Boolean(r.is_void),
    })),
    total: Number((countRow as { c: number | string }).c),
    page: filters.page,
    pageSize: filters.pageSize,
  };
};
