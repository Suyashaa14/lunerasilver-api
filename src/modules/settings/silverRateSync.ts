import * as provider from "./provider.settings";

const FENEGOSIDA_TODAY_URL = "https://api.fenegosida.org/api/website/v1/Dashboard/today";

interface FenegosidaRate {
  rateType: string;
  todayBaseRatePerGram: number;
}

// FENEGOSIDA (Federation of Nepal Gold & Silver Dealers' Association) publishes
// several rows per unit (1 tola, 10 gram, international). We want the "10 gram"
// row for silver — its rateType is Nepali text, so match on the two keywords
// (silver, gram) rather than the full string, which could reword slightly.
const isTenGramSilverRate = (r: FenegosidaRate) =>
  r.rateType.includes("चाँदी") && r.rateType.includes("ग्राम");

export const fetchNepalSilverRatePerGram = async (): Promise<number> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let rates: FenegosidaRate[];
  try {
    const res = await fetch(FENEGOSIDA_TODAY_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`FENEGOSIDA request failed: ${res.status} ${res.statusText}`);
    }
    rates = (await res.json()) as FenegosidaRate[];
  } finally {
    clearTimeout(timeout);
  }

  const tenGramSilver = rates.find(isTenGramSilverRate);
  if (!tenGramSilver || !(tenGramSilver.todayBaseRatePerGram > 0)) {
    throw new Error("Could not find a valid 10-gram silver rate in FENEGOSIDA response");
  }

  return Math.round((tenGramSilver.todayBaseRatePerGram / 10) * 100) / 100;
};

export const syncSilverRateFromFenegosida = async () => {
  const ratePerGram = await fetchNepalSilverRatePerGram();
  return provider.applyAutoSilverRate(ratePerGram);
};

const FENEGOSIDA_MONTH_URL = "https://api.fenegosida.org/api/website/v1/Dashboard/monthwisehistory";

interface FenegosidaDayRate {
  todayDate: string;
  rateType: string;
  baseRatePerGram: number;
}

const fetchMonth = async (month: string): Promise<FenegosidaDayRate[]> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${FENEGOSIDA_MONTH_URL}?date=${month}`, { signal: controller.signal });
    // 204: no history published for that month.
    if (res.status === 204 || !res.ok) return [];
    const text = await res.text();
    return text ? (JSON.parse(text) as FenegosidaDayRate[]) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
};

const previousMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/**
 * FENEGOSIDA's published silver rate for a past day, per gram.
 *
 * The market does not publish on closed days (Saturdays, holidays), so a
 * closed day takes the last rate published before it -- the one a shop would
 * have been selling at. Its history only reaches back to late July 2026;
 * earlier than that there is nothing to find and this returns null.
 */
export const fetchNepalSilverRateOn = async (date: string): Promise<{ ratePerGram: number; day: string } | null> => {
  let month = date.slice(0, 7);
  // The day itself, else earlier in its month, else the end of the month before.
  for (let tries = 0; tries < 2; tries += 1) {
    const rows = (await fetchMonth(month))
      .filter((r) => r.rateType.includes("चाँदी") && r.rateType.includes("ग्राम"))
      .filter((r) => r.todayDate.slice(0, 10) <= date && r.baseRatePerGram > 0)
      .sort((a, b) => a.todayDate.localeCompare(b.todayDate));
    const last = rows[rows.length - 1];
    if (last) return { ratePerGram: Math.round((last.baseRatePerGram / 10) * 100) / 100, day: last.todayDate.slice(0, 10) };
    month = previousMonth(month);
  }
  return null;
};
