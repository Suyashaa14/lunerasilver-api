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
