import type { Knex } from "knex";

/**
 * Nepali fiscal years run Shrawan 1 to the last day of Ashadh.
 *
 * Every boundary below was checked against nepali-date-converter, including
 * against a known anchor: 2026-03-29 AD = 2082-12-15 BS, the incorporation date
 * printed on the company certificate. Ashadh length varies -- 2083 has 32 days,
 * 2084 has 31 -- so these are not interchangeable between years.
 *
 * Both years are seeded `open`. Closing a year is a deliberate act once the
 * accountant has signed it off, not something a seed should decide.
 */
const FISCAL_YEARS = [
  {
    name: "2082/83",
    start_date: "2025-07-17",
    end_date: "2026-07-16",
    start_date_bs: "2082-04-01", // Shrawan 1
    end_date_bs: "2083-03-32",   // Ashadh 2083 has 32 days (verified via nepali-date-converter)
  },
  {
    name: "2083/84",
    start_date: "2026-07-17",
    end_date: "2027-07-16",
    start_date_bs: "2083-04-01",
    end_date_bs: "2084-03-31",
  },
];

export async function seed(knex: Knex): Promise<void> {
  for (const year of FISCAL_YEARS) {
    const existing = await knex("fiscal_years").where({ name: year.name }).first();
    if (existing) {
      console.log(`Fiscal year already present: ${year.name}`);
      continue;
    }
    await knex("fiscal_years").insert({ ...year, status: "open" });
    console.log(`Created fiscal year ${year.name} (${year.start_date} to ${year.end_date})`);
  }
}
