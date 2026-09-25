import type { Knex } from "knex";
import db from "../../utils/db";
import { allocateNumber } from "../../services/numbering/service.numbering";
import { stampForDate } from "../../utils/fiscalYear";
import { findOrCreateForUser } from "../customers/provider.customers";
import { getCurrentSilverRatePerGram } from "../settings/provider.settings";
import { computePrice } from "../../utils/pricing";
import { CreateOrderPayload, UpdateOrderStatusPayload } from "./interface/interface.orders";

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
  userId: order.user_id,
  ...(order.customer_name ? { customerName: order.customer_name, customerEmail: order.customer_email } : {}),
  items: items.map((it) => ({
    id: it.id,
    jewelryId: it.jewelry_id,
    name: it.name_snapshot,
    imageUrl: it.image_snapshot,
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
      (sum, r) => sum + computePrice(Number(r.silver_weight_grams), Number(r.making_charge), rate, Number(r.stone_price ?? 0)),
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
        unit_price_snapshot: computePrice(Number(r.silver_weight_grams), Number(r.making_charge), rate, Number(r.stone_price ?? 0)),
      })),
    );

    await trx("jewelries")
      .whereIn("id", cartRows.map((r) => r.id))
      .update({ status: "sold" });

    await trx("cart_items").where({ user_id: userId }).delete();

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

export const listOrders = async (filters: { page: number; pageSize: number }) => {
  const orders = await db("orders")
    .join("users", "users.id", "orders.user_id")
    .orderBy("orders.created_at", "desc")
    .select("orders.*", "users.name as customer_name", "users.email as customer_email");

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
