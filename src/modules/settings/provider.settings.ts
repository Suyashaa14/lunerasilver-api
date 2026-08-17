import db from "../../utils/db";
import { uploadImageBuffer } from "../../utils/cloudinary";

export const getSettings = async () => {
  const settings = await db("settings").where({ id: 1 }).first();
  return {
    silverRatePerGram: Number(settings?.silver_rate_per_gram ?? 0),
    silverRateSource: settings?.silver_rate_source ?? "manual",
    silverRateSyncedAt: settings?.silver_rate_synced_at ?? null,
    esewaQrUrl: settings?.esewa_qr_url ?? null,
  };
};

export const updateSilverRate = async (silverRatePerGram: number) => {
  await db("settings").where({ id: 1 }).update({
    silver_rate_per_gram: silverRatePerGram,
    silver_rate_source: "manual",
    silver_rate_synced_at: null,
  });
  return getSettings();
};

export const applyAutoSilverRate = async (silverRatePerGram: number) => {
  await db("settings").where({ id: 1 }).update({
    silver_rate_per_gram: silverRatePerGram,
    silver_rate_source: "auto",
    silver_rate_synced_at: db.fn.now(),
  });
  return getSettings();
};

export const updateEsewaQr = async (file: Express.Multer.File) => {
  const { url } = await uploadImageBuffer(file.buffer, "lunerasilver/esewa-qr");
  await db("settings").where({ id: 1 }).update({ esewa_qr_url: url });
  return getSettings();
};
