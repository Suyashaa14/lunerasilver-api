import cron from "node-cron";
import { config } from "../../config/config";
import { syncSilverRateFromFenegosida } from "../modules/settings/silverRateSync";

const runSilverRateSync = async () => {
  try {
    const settings = await syncSilverRateFromFenegosida();
    console.log(`[silver-rate-sync] updated to Rs ${settings.silverRatePerGram}/g`);
  } catch (err) {
    console.error("[silver-rate-sync] failed:", err instanceof Error ? err.message : err);
  }
};

export const startSchedulers = () => {
  if (!config.silverRateSync.enabled) return;

  if (!cron.validate(config.silverRateSync.cron)) {
    console.error(`[silver-rate-sync] invalid cron expression "${config.silverRateSync.cron}", scheduler not started`);
    return;
  }

  // Fire once at boot so the rate isn't stale after a deploy/restart, then on schedule.
  void runSilverRateSync();

  cron.schedule(config.silverRateSync.cron, runSilverRateSync, {
    timezone: config.silverRateSync.timezone,
  });
};
