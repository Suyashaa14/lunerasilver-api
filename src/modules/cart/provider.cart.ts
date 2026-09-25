import db from "../../utils/db";
import { computePrice } from "../../utils/pricing";
import { getCurrentSilverRate } from "../jewelries/provider.jewelries";

export const getCart = async (userId: number) => {
  const rate = await getCurrentSilverRate();
  const rows = await db("cart_items")
    .join("jewelries", "jewelries.id", "cart_items.jewelry_id")
    .where("cart_items.user_id", userId)
    .select("cart_items.id as cartItemId", "jewelries.*");

  return rows.map((r) => ({
    cartItemId: r.cartItemId,
    jewelryId: r.id,
    name: r.name,
    category: r.category,
    imageUrl: r.image_url,
    status: r.status,
    silverWeightGrams: Number(r.silver_weight_grams),
    makingCharge: Number(r.making_charge),
    price: computePrice(Number(r.silver_weight_grams), Number(r.making_charge), rate, Number(r.stone_price ?? 0)),
  }));
};

export const addToCart = async (userId: number, jewelryId: number) => {
  const jewelry = await db("jewelries").where({ id: jewelryId }).first();
  if (!jewelry) {
    throw Object.assign(new Error("Jewelry not found"), { status: 404 });
  }
  if (jewelry.status !== "available") {
    throw Object.assign(new Error("This piece is no longer available"), { status: 409 });
  }

  await db("cart_items")
    .insert({ user_id: userId, jewelry_id: jewelryId })
    .onConflict(["user_id", "jewelry_id"])
    .ignore();
};

export const removeFromCart = async (userId: number, jewelryId: number) => {
  await db("cart_items").where({ user_id: userId, jewelry_id: jewelryId }).delete();
};
