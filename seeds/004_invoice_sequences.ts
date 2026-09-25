import type { Knex } from "knex";

/**
 * One counter per (fiscal_year, series). Numbers are allocated by locking the
 * row inside the issuing transaction, which is what keeps the sequence gapless.
 *
 * Prefixes are a presentation choice, not a legal one -- change them here
 * before the first document of a series is issued, never after.
 */
const SERIES: { series: string; prefix: string }[] = [
  { series: "SALES", prefix: "INV" },
  { series: "CN", prefix: "CN" },
  { series: "PROFORMA", prefix: "PI" },
];

export async function seed(knex: Knex): Promise<void> {
  const openYears = await knex("fiscal_years").where({ status: "open" }).select("name");

  if (openYears.length === 0) {
    console.warn("No open fiscal years -- run the fiscal year seed first. Skipping sequences.");
    return;
  }

  for (const year of openYears) {
    for (const entry of SERIES) {
      const existing = await knex("invoice_sequences")
        .where({ fiscal_year: year.name, series: entry.series })
        .first();

      if (existing) {
        console.log(`Sequence already present: ${year.name} ${entry.series} (next ${existing.next_number})`);
        continue;
      }

      await knex("invoice_sequences").insert({
        fiscal_year: year.name,
        series: entry.series,
        prefix: entry.prefix,
        next_number: 1,
      });
      console.log(`Created sequence ${entry.prefix} for ${year.name} ${entry.series}`);
    }
  }
}
