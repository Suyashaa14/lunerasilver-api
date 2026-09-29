import type { Knex } from "knex";
import db from "../../utils/db";
import { uploadImageBuffer } from "../../utils/cloudinary";
import { fetchNepalSilverRateOn } from "./silverRateSync";

/**
 * The live silver rate is the open row in silver_rates -- the one with no
 * effective_to. The rate is no longer a column on settings: historical
 * documents must be able to show the rate that applied when they were issued,
 * which a single mutable column cannot do.
 */
export const getCurrentSilverRate = async (trx?: Knex.Transaction) => {
  return (trx ?? db)("silver_rates").whereNull("effective_to").orderBy("id", "desc").first();
};

export const getCurrentSilverRatePerGram = async (trx?: Knex.Transaction): Promise<number> => {
  const current = await getCurrentSilverRate(trx);
  return Number(current?.rate_per_gram ?? 0);
};

export const getSettings = async () => {
  const [settings, rate, business] = await Promise.all([
    db("settings").where({ id: 1 }).first(),
    getCurrentSilverRate(),
    db("business_profile").first("is_vat_registered", "default_vat_rate", "skill_promo_rate"),
  ]);

  return {
    // Shape is unchanged for callers; only the source of the rate moved.
    silverRatePerGram: Number(rate?.rate_per_gram ?? 0),
    silverRateSource: rate?.source ?? "manual",
    // Only an automatic rate was "synced"; a manual one was typed in, and the
    // admin UI keys off this being null to say so.
    silverRateSyncedAt: rate?.source === "auto" ? (rate?.effective_from ?? null) : null,
    esewaQrUrl: settings?.esewa_qr_url ?? null,
    // The counter needs these to show a sale's total before it is issued. The
    // invoice is still priced by the server; this is only so the screen agrees
    // with the document it is about to produce.
    isVatRegistered: Boolean(business?.is_vat_registered),
    vatRate: business?.is_vat_registered ? Number(business?.default_vat_rate ?? 0) : 0,
    skillPromoRate: Number(business?.skill_promo_rate ?? 0),
  };
};

/**
 * Closes the open rate row and opens a new one, in one transaction, so there is
 * never a moment with two open rates or none. A repeat of the same rate is
 * ignored rather than cluttering the history.
 */
const recordSilverRate = async (ratePerGram: number, source: "manual" | "auto", createdBy?: number) => {
  await db.transaction(async (trx) => {
    const current = await getCurrentSilverRate(trx);
    if (current && Number(current.rate_per_gram) === ratePerGram && current.source === source) {
      return;
    }

    const now = new Date();
    if (current) {
      await trx("silver_rates").where({ id: current.id }).update({ effective_to: now });
    }
    await trx("silver_rates").insert({
      rate_per_gram: ratePerGram,
      source,
      effective_from: now,
      effective_to: null,
      created_by: createdBy ?? null,
    });

    // settings keeps a denormalised copy purely so the admin UI can show how the
    // rate was last set without a second query.
    await trx("settings").where({ id: 1 }).update({
      silver_rate_source: source,
      silver_rate_synced_at: source === "auto" ? now : null,
    });
  });

  return getSettings();
};

export const updateSilverRate = async (silverRatePerGram: number, createdBy?: number) =>
  recordSilverRate(silverRatePerGram, "manual", createdBy);

/**
 * The silver rate that applied on a past day.
 *
 * The shop's own rate history comes first: it is the rate the shop actually
 * priced at. Before that history begins, FENEGOSIDA's published rate for the
 * day -- from the saved list (silver_rate_reference, seeded back to 1 Jan
 * 2026), else from its live API. With none, null -- the caller asks for it to
 * be typed in rather than being handed a guess.
 */
export const getSilverRateOn = async (date: string) => {
  const endOfDay = `${date} 23:59:59`;
  const first = await db("silver_rates").orderBy("effective_from", "asc").first("effective_from");
  if (first && new Date(first.effective_from) <= new Date(`${date}T23:59:59`)) {
    const row = await db("silver_rates")
      .where("effective_from", "<=", endOfDay)
      .andWhere((q) => q.whereNull("effective_to").orWhere("effective_to", ">", endOfDay))
      .orderBy("effective_from", "desc")
      .first("rate_per_gram");
    if (row) return { ratePerGram: Number(row.rate_per_gram), source: "shop" as const, day: date };
  }

  // The saved FENEGOSIDA list, which reaches back further than the live API.
  // A closed market day takes the last rate before it, but never one more
  // than a few days old.
  const earliest = new Date(`${date}T00:00:00`);
  earliest.setDate(earliest.getDate() - 5);
  const pad = (x: number) => String(x).padStart(2, "0");
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const saved = await db("silver_rate_reference")
    .where("rate_date", "<=", date)
    .andWhere("rate_date", ">=", ymd(earliest))
    .orderBy("rate_date", "desc")
    .first("rate_date", "npr_per_gram_999");
  if (saved) {
    return { ratePerGram: Number(saved.npr_per_gram_999), source: "fenegosida" as const, day: ymd(new Date(saved.rate_date)) };
  }

  // Newer than the saved list: ask FENEGOSIDA directly.
  const published = await fetchNepalSilverRateOn(date);
  if (published) return { ratePerGram: published.ratePerGram, source: "fenegosida" as const, day: published.day };

  return { ratePerGram: null, source: null, day: date };
};

export const applyAutoSilverRate = async (silverRatePerGram: number) =>
  recordSilverRate(silverRatePerGram, "auto");

export const updateEsewaQr = async (file: Express.Multer.File) => {
  const { url } = await uploadImageBuffer(file.buffer, "lunerasilver/esewa-qr");
  await db("settings").where({ id: 1 }).update({ esewa_qr_url: url });
  return getSettings();
};
