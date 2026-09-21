import type { Knex } from "knex";
import db from "../../utils/db";
import { uploadImageBuffer } from "../../utils/cloudinary";

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
  const [settings, rate] = await Promise.all([
    db("settings").where({ id: 1 }).first(),
    getCurrentSilverRate(),
  ]);

  return {
    // Shape is unchanged for callers; only the source of the rate moved.
    silverRatePerGram: Number(rate?.rate_per_gram ?? 0),
    silverRateSource: rate?.source ?? "manual",
    // Only an automatic rate was "synced"; a manual one was typed in, and the
    // admin UI keys off this being null to say so.
    silverRateSyncedAt: rate?.source === "auto" ? (rate?.effective_from ?? null) : null,
    esewaQrUrl: settings?.esewa_qr_url ?? null,
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

export const applyAutoSilverRate = async (silverRatePerGram: number) =>
  recordSilverRate(silverRatePerGram, "auto");

export const updateEsewaQr = async (file: Express.Multer.File) => {
  const { url } = await uploadImageBuffer(file.buffer, "lunerasilver/esewa-qr");
  await db("settings").where({ id: 1 }).update({ esewa_qr_url: url });
  return getSettings();
};
