import type { Knex } from "knex";
import db from "../../utils/db";
import { allocateNumber } from "../../services/numbering/service.numbering";
import { stampForDate } from "../../utils/fiscalYear";
import { findOrCreateForUser, findOrCreateByPhone } from "../customers/provider.customers";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { uploadImageBuffer, deleteImage } from "../../utils/cloudinary";
import { getCurrentSilverRatePerGram } from "../settings/provider.settings";
import { computePrice } from "../../utils/pricing";
import { issueInvoice } from "../invoices/provider.issue";
import { CreateOrderPayload, CreateCounterOrderPayload, UpdateOrderStatusPayload, UpdateOrderDetailsPayload } from "./interface/interface.orders";

const serializeOrder = (order: any, items: any[]) => ({
  id: order.id,
  status: order.status,
  paymentMethod: order.payment_method,
  paymentStatus: order.payment_status,
  totalAmount: Number(order.total_amount),
  recipientName: order.recipient_name,
  phone: order.phone,
  addressLine: order.address_line,
  city: order.city,
  notes: order.notes,
  createdAt: order.created_at,
  placedAtBs: order.placed_at_bs ?? null,
  orderNo: order.order_no ?? null,
  userId: order.user_id,
  // Where the money ended up, so an order can be traced to the sale it became.
  invoice: order.invoice_id ? { id: Number(order.invoice_id), invoiceNo: order.invoice_no } : null,
  source: order.user_id ? "web" : "counter",
  ...(order.customer_name ? { customerName: order.customer_name, customerEmail: order.customer_email } : {}),
  items: items.map((it) => ({
    id: it.id,
    jewelryId: it.jewelry_id,
    name: it.name_snapshot,
    imageUrl: it.image_snapshot,
    isCustom: Boolean(it.is_custom),
    description: it.description ?? null,
    category: it.category ?? null,
    size: it.size ?? null,
    silverWeightGrams: Number(it.silver_weight_snapshot),
    makingCharge: Number(it.making_charge_snapshot),
    silverRate: Number(it.silver_rate_snapshot),
    unitPrice: Number(it.unit_price_snapshot),
  })),
});

export const createOrder = async (userId: number, data: CreateOrderPayload) => {
  return db.transaction(async (trx) => {
    const cartRows = await trx("cart_items")
      .join("jewelries", "jewelries.id", "cart_items.jewelry_id")
      .where("cart_items.user_id", userId)
      .select("jewelries.*");

    if (cartRows.length === 0) {
      throw Object.assign(new Error("Your cart is empty"), { status: 400 });
    }

    const unavailable = cartRows.filter((r) => r.status !== "available");
    if (unavailable.length > 0) {
      throw Object.assign(
        new Error(`No longer available: ${unavailable.map((r) => r.name).join(", ")}`),
        { status: 409 },
      );
    }

    const rate = await getCurrentSilverRatePerGram(trx);

    const totalAmount = cartRows.reduce(
      (sum, r) => sum + computePrice(Number(r.silver_weight_grams), Number(r.making_charge), rate, Number(r.stone_price ?? 0), Number(r.profit_amount ?? 0)),
      0,
    );

    const paymentStatus = data.paymentMethod === "esewa_qr" ? "awaiting_verification" : "unpaid";

    // An order belongs to a customer, which is the accounting identity. The
    // login account is optional and separate -- a counter buyer has no login.
    const customerId = await findOrCreateForUser(trx, userId, {
      name: data.recipientName,
      phone: data.phone,
      addressLine: data.addressLine,
      city: data.city,
    });

    const placedAt = new Date();
    const { fiscalYear, bsDate } = await stampForDate(trx, placedAt);
    const orderNo = await allocateNumber(trx, fiscalYear, "ORDER");

    const [orderId] = await trx("orders").insert({
      customer_id: customerId,
      order_no: orderNo,
      fiscal_year: fiscalYear,
      placed_at_bs: bsDate,
      user_id: userId,
      payment_method: data.paymentMethod,
      payment_status: paymentStatus,
      total_amount: totalAmount,
      recipient_name: data.recipientName,
      phone: data.phone,
      address_line: data.addressLine,
      city: data.city,
      notes: data.notes ?? null,
    });

    await trx("order_items").insert(
      cartRows.map((r) => ({
        order_id: orderId,
        jewelry_id: r.id,
        name_snapshot: r.name,
        image_snapshot: r.image_url,
        silver_weight_snapshot: r.silver_weight_grams,
        making_charge_snapshot: r.making_charge,
        silver_rate_snapshot: rate,
        unit_price_snapshot: computePrice(Number(r.silver_weight_grams), Number(r.making_charge), rate, Number(r.stone_price ?? 0), Number(r.profit_amount ?? 0)),
      })),
    );

    // Reserved, not sold. An order is a promise; the piece only leaves stock
    // when an invoice says it was sold, and until then it is still the shop's.
    await trx("jewelries")
      .whereIn("id", cartRows.map((r) => r.id))
      .update({ status: "reserved" });

    await trx("cart_items").where({ user_id: userId }).delete();

    const orderRow = await trx("orders").where({ id: orderId }).first();
    const itemRows = await trx("order_items").where({ order_id: orderId });
    return serializeOrder(orderRow, itemRows);
  });
};

/**
 * An order taken by the shop rather than placed on the website.
 *
 * The pieces are held as `reserved`, not `sold`. An order is a promise, not a
 * sale: nothing has been invoiced, no money has been recognised, and the stock
 * is still the shop's until it is. Cancelling the order puts them back.
 */
export const createCounterOrder = async (
  data: CreateCounterOrderPayload,
  actor: AuditActor,
  /** Inspiration images for custom lines, keyed by the line's position in `items`. */
  inspoFiles: Map<number, Express.Multer.File> = new Map(),
) => {
  if (!data.items || data.items.length === 0) {
    throw Object.assign(new Error("An order needs at least one piece"), { status: 400 });
  }

  const jewelryIds = data.items.filter((i) => i.jewelryId).map((i) => Number(i.jewelryId));
  if (new Set(jewelryIds).size !== jewelryIds.length) {
    throw Object.assign(new Error("The same piece is on this order twice"), { status: 400 });
  }
  if (data.items.some((i) => !i.jewelryId && !i.custom)) {
    throw Object.assign(new Error("Each line is either an existing piece or a custom one"), { status: 400 });
  }

  // Uploaded before the transaction opens so row locks are not held across a
  // network call; taken back down if the order then fails.
  const inspo = new Map<number, { url: string; publicId: string }>();
  for (const [index, file] of inspoFiles) {
    if (data.items[index]?.custom) inspo.set(index, await uploadImageBuffer(file.buffer, "lunerasilver/custom-orders"));
  }

  try {
    return await placeCounterOrder(data, jewelryIds, inspo, actor);
  } catch (err) {
    await Promise.all([...inspo.values()].map((u) => deleteImage(u.publicId)));
    throw err;
  }
};

const placeCounterOrder = async (
  data: CreateCounterOrderPayload,
  jewelryIds: number[],
  inspo: Map<number, { url: string; publicId: string }>,
  actor: AuditActor,
) => {
  return db.transaction(async (trx) => {
    // Locked so the same ring cannot be promised to two people at once. The
    // second request waits here and is then refused.
    const pieces = await trx("jewelries").whereIn("id", jewelryIds).forUpdate();

    const byId = new Map(pieces.map((p: any) => [Number(p.id), p]));
    for (const id of jewelryIds) {
      const piece = byId.get(id);
      if (!piece) throw Object.assign(new Error(`Piece ${id} not found`), { status: 404 });
      if (piece.status !== "available") {
        throw Object.assign(
          new Error(`${piece.name} is ${piece.status} and cannot be ordered`),
          { status: 409 },
        );
      }
    }

    const rate = await getCurrentSilverRatePerGram(trx);
    const priceOf = (p: any) =>
      computePrice(Number(p.silver_weight_grams), Number(p.making_charge), rate, Number(p.stone_price ?? 0), Number(p.profit_amount ?? 0));

    // Custom lines have no price until the workshop quotes one, so they add
    // nothing to the total yet.
    const totalAmount = jewelryIds.reduce((sum, id) => sum + priceOf(byId.get(id)), 0);

    const customer = await findOrCreateByPhone(
      trx,
      { name: data.recipientName, phone: data.phone, addressLine: data.addressLine, city: data.city },
      actor,
    );

    const placedAt = new Date();
    const { fiscalYear, bsDate } = await stampForDate(trx, placedAt);
    const orderNo = await allocateNumber(trx, fiscalYear, "ORDER");

    const [orderId] = await trx("orders").insert({
      customer_id: customer.id,
      order_no: orderNo,
      fiscal_year: fiscalYear,
      placed_at_bs: bsDate,
      // No login behind a counter order. customer_id is the identity that matters.
      user_id: null,
      payment_method: data.paymentMethod,
      payment_status: data.paymentMethod === "esewa_qr" ? "awaiting_verification" : "unpaid",
      total_amount: totalAmount,
      recipient_name: data.recipientName,
      phone: data.phone,
      address_line: data.addressLine,
      city: data.city,
      notes: data.notes ?? null,
    });

    await trx("order_items").insert(
      data.items.map((item, index) => {
        if (item.custom) {
          const image = inspo.get(index);
          return {
            order_id: orderId,
            jewelry_id: null,
            is_custom: true,
            name_snapshot: item.custom.name.trim(),
            description: item.custom.description?.trim() || null,
            category: item.custom.category,
            size: item.custom.size?.trim() || null,
            inspo_image_url: image?.url ?? null,
            inspo_image_public_id: image?.publicId ?? null,
            image_snapshot: image?.url ?? null,
            silver_weight_snapshot: 0,
            making_charge_snapshot: 0,
            silver_rate_snapshot: rate,
            unit_price_snapshot: 0,
          };
        }
        const p = byId.get(Number(item.jewelryId));
        return {
          order_id: orderId,
          jewelry_id: p.id,
          name_snapshot: p.name,
          image_snapshot: p.image_url,
          silver_weight_snapshot: p.silver_weight_grams,
          making_charge_snapshot: p.making_charge,
          silver_rate_snapshot: rate,
          unit_price_snapshot: priceOf(p),
        };
      }),
    );

    if (jewelryIds.length > 0) {
      await trx("jewelries").whereIn("id", jewelryIds).update({ status: "reserved" });
    }

    await writeAuditLog(trx, {
      ...actor,
      action: "create",
      entityType: "orders",
      entityId: orderId,
      newValues: { order_no: orderNo, customer_id: customer.id, total_amount: totalAmount },
    });

    const orderRow = await trx("orders").where({ id: orderId }).first();
    const itemRows = await trx("order_items").where({ order_id: orderId });
    return serializeOrder(orderRow, itemRows);
  });
};

export const getMyOrders = async (userId: number) => {
  const orders = await db("orders").where({ user_id: userId }).orderBy("created_at", "desc");
  return Promise.all(
    orders.map(async (o) => serializeOrder(o, await db("order_items").where({ order_id: o.id }))),
  );
};

export const listOrders = async (filters: { page: number; pageSize: number; status?: string }) => {
  // Left joins, not inner: a counter order has no login, and an inner join on
  // users would quietly drop every one of them from this list.
  const query = db("orders")
    .leftJoin("users", "users.id", "orders.user_id")
    .leftJoin("customers", "customers.id", "orders.customer_id")
    // The sale an order turned into, if it got that far. Void invoices are
    // ignored: a voided sale means the order is not sold after all.
    .leftJoin("invoices", function () {
      this.on("invoices.order_id", "=", "orders.id").andOn("invoices.is_void", "=", db.raw("0"));
    })
    .orderBy("orders.created_at", "desc")
    .select(
      "orders.*",
      "invoices.id as invoice_id",
      "invoices.invoice_no as invoice_no",
      db.raw("COALESCE(users.name, customers.name) as customer_name"),
      db.raw("COALESCE(users.email, customers.email) as customer_email"),
    );

  query.whereNull("orders.deleted_at");
  if (filters.status === "open") query.whereIn("orders.status", ["pending", "confirmed"]);
  else if (filters.status) query.where("orders.status", filters.status);

  const orders = await query;

  const total = orders.length;
  const start = (filters.page - 1) * filters.pageSize;
  const pageOrders = orders.slice(start, start + filters.pageSize);

  const data = await Promise.all(
    pageOrders.map(async (o) => serializeOrder(o, await db("order_items").where({ order_id: o.id }))),
  );

  return { data, total, page: filters.page, pageSize: filters.pageSize };
};

export const getOrder = async (id: number) => {
  const order = await db("orders").where({ id }).first();
  if (!order) return null;
  const items = await db("order_items").where({ order_id: order.id });
  return serializeOrder(order, items);
};

export const updateOrderStatus = async (id: number, data: UpdateOrderStatusPayload) => {
  const order = await db("orders").where({ id }).first();
  if (!order) return null;

  await db.transaction(async (trx) => {
    const update: Record<string, unknown> = {};
    if (data.status) update.status = data.status;
    if (data.paymentStatus) update.payment_status = data.paymentStatus;
    if (Object.keys(update).length > 0) {
      await trx("orders").where({ id: order.id }).update(update);
    }

    if (data.status === "cancelled" && order.status !== "cancelled") {
      const items = await trx("order_items").where({ order_id: order.id }).whereNotNull("jewelry_id");
      if (items.length > 0) {
        await trx("jewelries")
          .whereIn("id", items.map((i) => i.jewelry_id))
          .update({ status: "available" });
      }
    }
  });

  return getOrder(id);
};

/** An order can only be worked on while it is open and has not become a sale. */
const assertEditable = async (trx: Knex.Transaction, orderId: number) => {
  const order = await trx("orders").where({ id: orderId }).forUpdate().first();
  if (!order || order.deleted_at) throw Object.assign(new Error("Order not found"), { status: 404 });
  if (order.status === "cancelled" || order.status === "completed") {
    throw Object.assign(new Error("This order is closed and can no longer be changed"), { status: 409 });
  }
  const invoice = await trx("invoices").where({ order_id: orderId, is_void: false }).first("invoice_no");
  if (invoice) {
    throw Object.assign(new Error(`This order is already on invoice ${invoice.invoice_no}`), { status: 409 });
  }
  return order;
};

/**
 * Corrects an order's details: who it is for, where it goes, and the brief on
 * its custom lines. Priced pieces are not edited here -- remove the order and
 * take it again -- so a held price is never changed under a buyer.
 */
export const updateOrderDetails = async (id: number, data: UpdateOrderDetailsPayload, actor: AuditActor) => {
  await db.transaction(async (trx) => {
    const order = await assertEditable(trx, id);

    const update: Record<string, unknown> = {};
    if (data.recipientName !== undefined) update.recipient_name = data.recipientName.trim();
    if (data.phone !== undefined) update.phone = data.phone.trim();
    if (data.addressLine !== undefined) update.address_line = data.addressLine.trim();
    if (data.city !== undefined) update.city = data.city.trim();
    if (data.notes !== undefined) update.notes = data.notes?.trim() || null;
    if (data.paymentMethod !== undefined) {
      update.payment_method = data.paymentMethod;
      update.payment_status = data.paymentMethod === "esewa_qr" ? "awaiting_verification" : "unpaid";
    }
    if (Object.keys(update).length > 0) await trx("orders").where({ id }).update(update);

    for (const line of data.items ?? []) {
      const row = await trx("order_items").where({ id: line.id, order_id: id }).first();
      if (!row) throw Object.assign(new Error("That line is not on this order"), { status: 404 });
      if (!row.is_custom || row.jewelry_id) {
        throw Object.assign(new Error("Only custom pieces that are not made yet can be edited"), { status: 409 });
      }
      await trx("order_items").where({ id: line.id }).update({
        name_snapshot: line.name.trim(),
        description: line.description?.trim() || null,
        category: line.category,
        size: line.size?.trim() || null,
      });
    }

    await writeAuditLog(trx, {
      ...actor,
      action: "update",
      entityType: "orders",
      entityId: id,
      oldValues: Object.fromEntries(Object.keys(update).map((k) => [k, order[k]])),
      newValues: { ...update, lines_edited: (data.items ?? []).map((l) => l.id) },
    });
  });

  return getOrder(id);
};

/**
 * Puts a finished piece against a custom line.
 *
 * The piece has been made and entered into stock (through a supplier bill, so
 * it carries its cost). Here it is attached to the line: the line takes its
 * weight and price, the piece is held for this buyer, and the order's total
 * now includes it. After that the order can be invoiced like any other.
 */
export const linkCustomPiece = async (orderId: number, itemId: number, jewelryId: number, actor: AuditActor) => {
  await db.transaction(async (trx) => {
    await assertEditable(trx, orderId);

    const line = await trx("order_items").where({ id: itemId, order_id: orderId }).forUpdate().first();
    if (!line) throw Object.assign(new Error("That line is not on this order"), { status: 404 });
    if (!line.is_custom || line.jewelry_id) {
      throw Object.assign(new Error("This line already has its piece"), { status: 409 });
    }

    const piece = await trx("jewelries").where({ id: jewelryId }).forUpdate().first();
    if (!piece) throw Object.assign(new Error("Piece not found"), { status: 404 });
    if (piece.status !== "available") {
      throw Object.assign(new Error(`${piece.name} is ${piece.status} and cannot be put on this order`), { status: 409 });
    }

    const rate = await getCurrentSilverRatePerGram(trx);
    const price = computePrice(
      Number(piece.silver_weight_grams), Number(piece.making_charge), rate,
      Number(piece.stone_price ?? 0), Number(piece.profit_amount ?? 0),
    );

    await trx("order_items").where({ id: itemId }).update({
      jewelry_id: piece.id,
      silver_weight_snapshot: piece.silver_weight_grams,
      making_charge_snapshot: piece.making_charge,
      silver_rate_snapshot: rate,
      unit_price_snapshot: price,
    });
    await trx("jewelries").where({ id: piece.id }).update({ status: "reserved" });

    const items = await trx("order_items").where({ order_id: orderId });
    const total = items.reduce((sum: number, it: any) => sum + Number(it.unit_price_snapshot), 0);
    await trx("orders").where({ id: orderId }).update({ total_amount: total });

    await writeAuditLog(trx, {
      ...actor,
      action: "update",
      entityType: "orders",
      entityId: orderId,
      newValues: { item_id: itemId, jewelry_id: piece.id, unit_price: price, total_amount: total },
    });
  });

  return getOrder(orderId);
};

/**
 * Removes an order from the list.
 *
 * Orders are never hard-deleted -- the number is issued and the audit trail
 * points at it -- so this cancels the order, puts its held pieces back on the
 * shelf and hides it. Refused once the order has been sold.
 */
export const deleteOrder = async (id: number, actor: AuditActor) => {
  await db.transaction(async (trx) => {
    const order = await trx("orders").where({ id }).forUpdate().first();
    if (!order || order.deleted_at) throw Object.assign(new Error("Order not found"), { status: 404 });

    const invoice = await trx("invoices").where({ order_id: id }).first("invoice_no");
    if (invoice) {
      throw Object.assign(
        new Error(`This order was sold on invoice ${invoice.invoice_no} and cannot be deleted`),
        { status: 409 },
      );
    }

    if (order.status !== "cancelled") {
      const held = await trx("order_items").where({ order_id: id }).whereNotNull("jewelry_id");
      if (held.length > 0) {
        await trx("jewelries")
          .whereIn("id", held.map((i: any) => i.jewelry_id))
          .where({ status: "reserved" })
          .update({ status: "available" });
      }
    }

    await trx("orders").where({ id }).update({ status: "cancelled", deleted_at: trx.fn.now() });

    await writeAuditLog(trx, {
      ...actor,
      action: "void",
      entityType: "orders",
      entityId: id,
      oldValues: { status: order.status, order_no: order.order_no },
      newValues: { deleted: true },
    });
  });
};

/**
 * Turns an order into the sale it always meant to be.
 *
 * The invoice is the point where money is recognised, stock leaves the books
 * and the ledger moves -- none of which happens while an order is merely
 * confirmed. Each piece is charged the price the order quoted, not today's,
 * because that is the figure the buyer agreed to.
 */
export const invoiceOrder = async (orderId: number, actor: AuditActor) => {
  const order = await db("orders").where({ id: orderId }).first();
  if (!order) throw Object.assign(new Error("Order not found"), { status: 404 });
  if (order.status === "cancelled") {
    throw Object.assign(new Error("This order was cancelled; there is nothing to invoice"), { status: 409 });
  }

  const existing = await db("invoices").where({ order_id: orderId, is_void: false }).first("id", "invoice_no");
  if (existing) {
    throw Object.assign(new Error(`This order is already on invoice ${existing.invoice_no}`), { status: 409 });
  }

  // A custom line has no piece or price until it has been made and quoted;
  // invoicing now would silently leave it off the sale.
  const customLines = await db("order_items").where({ order_id: orderId, is_custom: true }).whereNull("jewelry_id");
  if (customLines.length > 0) {
    throw Object.assign(
      new Error("This order has custom pieces that are not made yet, so it cannot be invoiced"),
      { status: 409 },
    );
  }

  const items = await db("order_items").where({ order_id: orderId }).whereNotNull("jewelry_id");
  if (items.length === 0) {
    throw Object.assign(new Error("This order has no pieces to invoice"), { status: 400 });
  }

  const invoice = await issueInvoice(
    {
      customerId: Number(order.customer_id),
      orderId,
      paymentMethod: order.payment_method,
      items: items.map((it: any) => ({
        jewelryId: Number(it.jewelry_id),
        unitPrice: Number(it.unit_price_snapshot),
      })),
    },
    actor,
  );

  await db("orders").where({ id: orderId }).update({ status: "completed", delivered_at: db.fn.now() });

  return { order: await getOrder(orderId), invoice };
};
