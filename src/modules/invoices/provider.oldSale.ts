import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { stampForDate } from "../../utils/fiscalYear";
import { findOrCreateByPhone } from "../customers/provider.customers";
import { ACCOUNTS, postInvoice } from "../ledger/provider.posting";
import { postEntry } from "../ledger/provider.ledger";
import { recordPayment } from "../payments/provider.payments";
import { getInvoice } from "./provider.issue";

const money = (n: number) => Math.round(n * 100) / 100;

/** Owner's equity: stock the shop held before its books began came from here. */
const OWNER_EQUITY = "3000";

export interface OldSaleLine {
  name: string;
  category?: string;
  quantity: number;
  /** As written on the bill: the weight of the whole line. */
  weightGrams: number;
  /** What the line was sold for, before the bill's discount. */
  amount: number;
  /** The making charge the shop paid its supplier for the line. With the
      silver at that day's rate it gives the line's cost. */
  makingCharge?: number | null;
}

export interface OldSalePayload {
  /** The number on the paper bill, kept exactly as written. */
  billNo: string;
  date: string;
  customer?: { name?: string; phone?: string | null; addressLine?: string | null };
  /** Where the sale was made or the buyer is from, as on the bill. */
  location?: string | null;
  /** The silver rate on the bill date, kept on each line as a snapshot. */
  silverRatePerGram?: number | null;
  paymentMethod: "cash" | "cod" | "esewa_qr" | "bank_transfer";
  /** Whether the buyer paid the final total then. Usually yes. */
  paid?: boolean;
  discount?: number;
  /** The final figure on the bill, as the screen showed it. When given, the
      saved total is held to it exactly; a rounding cent lands in the levy. */
  finalTotal?: number | null;
  items: OldSaleLine[];
}


/**
 * The bill-level discount split over the lines by amount; the last line takes
 * the rounding, so the shares add back to exactly what was typed.
 */
const splitDiscount = (amounts: number[], discount: number): number[] => {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (discount <= 0 || total <= 0) return amounts.map(() => 0);
  const shares = amounts.map((a) => money((a / total) * discount));
  const drift = money(discount - shares.reduce((a, b) => a + b, 0));
  shares[shares.length - 1] = money(shares[shares.length - 1] + drift);
  return shares;
};

/**
 * Logs a sale made before the system, from its paper bill.
 *
 * The old bill knows what was sold, the weight, the amount, the discount and
 * what the buyer paid. The cost of a line is its silver at that day's rate plus
 * the making charge the shop paid, when the making charge is typed in; without
 * it the piece has no cost price, which every margin report already shows as
 * "not set" rather than a guess. Each line becomes a piece that arrives and
 * leaves at once.
 *
 * A known cost is booked twice, both against this invoice so a void reverses
 * both: the piece coming into stock as opening stock the owner already held
 * (it was bought before the books began), and leaving as cost of goods sold.
 * Without the first, the cost would come out of a stock account that never
 * had it.
 *
 * The invoice keeps the paper bill's own number, exactly as written: the paper
 * bills are serial, and handing one the next number in the system's series
 * would put an old sale out of date order in a sequence that must have no gaps.
 * The two never collide -- the system's numbers carry the INV-<year>- prefix.
 * is_old_bill marks it.
 *
 * The skill-promotion levy is charged on old bills the same way as on a sale
 * today, on top of the goods after discount:
 *
 *   final = (lines - discount) + levy%   (+ VAT%, once registered)
 *
 * One transaction for the pieces, the invoice, its lines, the stock rows and
 * the ledger entry.
 */
export const logOldSale = async (payload: OldSalePayload, actor: AuditActor) => {
  const billNo = payload.billNo.trim();
  const invoiceNo = billNo;
  const location = payload.location?.trim() || null;
  const rate = payload.silverRatePerGram && payload.silverRatePerGram > 0 ? money(payload.silverRatePerGram) : null;
  if (!payload.items || payload.items.length === 0) {
    throw Object.assign(new Error("An old bill needs at least one line"), { status: 400 });
  }

  const amounts = payload.items.map((i) => money(i.amount));
  const subtotalBefore = money(amounts.reduce((a, b) => a + b, 0));
  const discountTotal = money(payload.discount ?? 0);
  if (discountTotal > subtotalBefore) {
    throw Object.assign(new Error("The discount is larger than the bill"), { status: 400 });
  }
  const shares = splitDiscount(amounts, discountTotal);

  const invoiceId = await db.transaction(async (trx) => {
    const taken = await trx("invoices").where({ invoice_no: invoiceNo }).first("id");
    if (taken) {
      throw Object.assign(new Error(`Bill ${billNo} is already entered`), { status: 409 });
    }

    const business = await trx("business_profile").first();
    if (!business) {
      throw Object.assign(new Error("No business profile. Seed business_profile first."), { status: 400 });
    }

    // Old bills often carry no buyer. They all go to one walk-in record rather
    // than a new nameless customer per bill.
    const name = payload.customer?.name?.trim();
    const customer = name
      ? await findOrCreateByPhone(trx, { name, phone: payload.customer?.phone ?? null, addressLine: location } as any, actor)
      : await (async () => {
          const walkIn = await trx("customers").where({ name: "Walk-in customer" }).whereNull("phone").first();
          if (walkIn) return { id: walkIn.id };
          const [id] = await trx("customers").insert({ name: "Walk-in customer" });
          return { id };
        })();
    const buyer = await trx("customers").where({ id: customer.id }).first();

    const { fiscalYear, bsDate } = await stampForDate(trx, payload.date);

    // On top of the goods, as on any sale.
    const vatRate = business.is_vat_registered ? Number(business.default_vat_rate) : 0;
    const levyRate = Number(business.skill_promo_rate ?? 0);

    const goodsPerLine = amounts.map((a, i) => money(a - shares[i]));
    const goodsTotal = money(goodsPerLine.reduce((a, b) => a + b, 0));
    const vatPerLine = goodsPerLine.map((g) => money((g * vatRate) / 100));
    const vatTotal = money(vatPerLine.reduce((a, b) => a + b, 0));
    let levyAmount = money((goodsTotal * levyRate) / 100);

    // A line amount worked back from the final total can leave the sum a cent
    // off it. The bill's figure is the one the buyer paid, so the cent goes to
    // the levy; anything bigger is a real disagreement and is refused.
    if (payload.finalTotal) {
      const drift = money(money(payload.finalTotal) - (goodsTotal + vatTotal + levyAmount));
      if (Math.abs(drift) > 0.05) {
        throw Object.assign(
          new Error(`The final total ${money(payload.finalTotal)} does not match the lines less discount plus levy (${money(goodsTotal + vatTotal + levyAmount)}).`),
          { status: 400 },
        );
      }
      levyAmount = money(levyAmount + drift);
    }

    // Cost is the silver at that day's rate plus the making charge paid.
    const costs = payload.items.map((i) => {
      if (!i.makingCharge || i.makingCharge <= 0) return null;
      if (!rate) {
        throw Object.assign(
          new Error(`${i.name}: enter the silver rate for that day, so its cost can be worked out.`),
          { status: 400 },
        );
      }
      return money(i.weightGrams * rate + i.makingCharge);
    });

    const rows: any[] = [];
    for (const [index, line] of payload.items.entries()) {
      const qty = Math.max(1, Math.floor(line.quantity || 1));
      const taxable = goodsPerLine[index];
      const vat = vatPerLine[index];
      const sku = `OLD-${invoiceNo}-${index + 1}`.slice(0, 40);

      const [pieceId] = await trx("jewelries").insert({
        sku,
        name: line.name.trim(),
        category: line.category || "other",
        material: "silver",
        silver_weight_grams: line.weightGrams,
        making_charge: line.makingCharge && line.makingCharge > 0 ? money(line.makingCharge) : 0,
        // The rate the cost was worked at, so the piece can explain it.
        cost_rate_per_gram: costs[index] !== null ? rate : null,
        // Left empty when the bill does not say, never a made-up figure.
        cost_price: costs[index],
        profit_amount: 0,
        status: "sold",
      });

      // It arrived and left on the same bill: both movements, so the stock
      // history of the piece still reads in and out like every other.
      const note = `Logged from old bill ${billNo}`;
      await trx("inventory_transactions").insert({
        jewelry_id: pieceId, type: "adjustment", direction: "in", quantity: qty,
        cost_amount: costs[index], reference_type: "manual", reference_id: null, note,
        created_by: actor.userId ?? null,
      });

      rows.push({
        pieceId,
        qty,
        cost: costs[index],
        item: {
          jewelry_id: pieceId,
          name_snapshot: line.name.trim(),
          sku_snapshot: sku,
          category_snapshot: line.category || "other",
          image_snapshot: null,
          silver_weight_snapshot: line.weightGrams,
          silver_rate_snapshot: rate,
          making_charge_snapshot: line.makingCharge && line.makingCharge > 0 ? money(line.makingCharge) : null,
          stone_weight_snapshot: null,
          stone_price_snapshot: null,
          quantity: qty,
          unit_price: money(amounts[index] / qty),
          discount: shares[index],
          taxable_amount: taxable,
          vat_amount: vat,
          line_total: taxable,
        },
      });
    }

    const subtotal = goodsTotal;
    const vatAmount = vatTotal;
    const totalAmount = money(goodsTotal + vatTotal + levyAmount);

    const [newId] = await trx("invoices").insert({
      invoice_no: invoiceNo,
      fiscal_year: fiscalYear,
      series: "SALES",
      is_old_bill: true,
      order_id: null,
      customer_id: customer.id,
      issued_at: `${payload.date} 00:00:00`,
      issued_date_bs: bsDate,
      seller_name: business.legal_name,
      seller_address: `${business.address_line}, ${business.city}`,
      seller_pan: business.pan,
      buyer_name: buyer.name,
      // The bill's own location first: a walk-in has no address of its own.
      buyer_address: location ?? ([buyer.address_line, buyer.city].filter(Boolean).join(", ") || "-"),
      buyer_pan: buyer.pan,
      subtotal,
      discount: discountTotal,
      taxable_amount: subtotal,
      vat_amount: vatAmount,
      vat_rate: vatRate,
      skill_promo_rate: levyRate,
      skill_promo_amount: levyAmount,
      total_amount: totalAmount,
      payment_method: payload.paymentMethod,
      created_by: actor.userId ?? null,
    });

    await trx("invoice_items").insert(rows.map((r) => ({ ...r.item, invoice_id: newId })));

    await trx("inventory_transactions").insert(
      rows.map((r) => ({
        jewelry_id: r.pieceId, type: "sale", direction: "out", quantity: r.qty,
        cost_amount: r.cost, reference_type: "invoice", reference_id: newId,
        created_by: actor.userId ?? null,
      })),
    );

    // Only the known costs. A line without one books no cost of goods: its
    // margin stays unknown rather than being counted as a hundred per cent.
    const knownCost = money(rows.reduce((s, r) => s + (r.cost ?? 0), 0));
    if (knownCost > 0) {
      await postEntry(trx, {
        date: payload.date,
        narration: `Opening stock sold on old bill ${billNo}`,
        referenceType: "invoice",
        referenceId: newId,
        lines: [
          { account: ACCOUNTS.inventory, debit: knownCost },
          { account: OWNER_EQUITY, credit: knownCost },
        ],
      }, actor);
    }

    await postInvoice(trx, {
      id: newId, invoice_no: invoiceNo, issued_at: payload.date,
      taxable_amount: subtotal, vat_amount: vatAmount, skill_promo_amount: levyAmount, total_amount: totalAmount,
    }, knownCost, actor);

    await writeAuditLog(trx, {
      ...actor,
      action: "create",
      entityType: "invoices",
      entityId: newId,
      newValues: { invoice_no: invoiceNo, logged_from_old_bill: true, total_amount: totalAmount },
    });

    return newId as number;
  });

  // Separate step, as at the counter: if it fails, the sale stands and the
  // money can be recorded against it afterwards.
  if (payload.paid !== false) {
    const invoice = await getInvoice(invoiceId);
    if (invoice && invoice.totalAmount > 0) {
      await recordPayment({
        invoiceId, amount: invoice.totalAmount, method: payload.paymentMethod,
        receivedAt: payload.date, note: `Paid on old bill ${billNo}`,
      } as any, actor);
    }
  }

  return getInvoice(invoiceId);
};
