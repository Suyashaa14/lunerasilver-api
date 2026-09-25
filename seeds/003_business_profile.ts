import type { Knex } from "knex";

/**
 * The single business identity row (id = 1).
 *
 * Every invoice snapshots seller_name / seller_address / seller_pan from here
 * at the moment it is issued, and an issued invoice is immutable. A placeholder
 * seeded now would be frozen onto real tax documents forever, so this seed
 * refuses to write until the values below are real.
 *
 * Fill these in, then run `npm run seed`.
 */
// Taken from the Certificate of Incorporation (Office of the Company Registrar)
// and the PAN registration certificate (Inland Revenue Office, Tripureshwor).
// Incorporated 2026-03-29 (15 Chaitra 2082).
const PROFILE = {
  legal_name: "Lunera Online Business Pvt. Ltd.",
  // Not on either certificate -- this is the storefront brand, used for display
  // only. seller_name on an invoice is the legal name above.
  trade_name: "Lunera Silver",
  registration_number: "388284/82/83",
  pan: "623577543",
  // PAN registration only; no VAT certificate among the filed documents.
  vat_number: null as string | null,
  address_line: "Ward No. 12, Kathmandu Metropolitan City",
  city: "Kathmandu",
  district: "Kathmandu",
  province: "Bagmati",
  phone: null as string | null,
  email: null as string | null,
  website: null as string | null,
  logo_url: null as string | null,
  invoice_footer: null as string | null,
  invoice_terms: null as string | null,

  // Decision D2 in docs/BUILD-PLAN.md. The filed documents show PAN
  // registration only. VAT columns are still stored either way, as 0.00.
  is_vat_registered: false,
  default_vat_rate: 0,
};

const REQUIRED: (keyof typeof PROFILE)[] = ["legal_name", "trade_name", "pan", "address_line", "city"];

export async function seed(knex: Knex): Promise<void> {
  const unfilled = REQUIRED.filter((field) => PROFILE[field] === "TODO");

  if (unfilled.length > 0) {
    console.warn(
      [
        "",
        "  business_profile NOT seeded.",
        `  Still placeholder: ${unfilled.join(", ")}`,
        "  Edit seeds/003_business_profile.ts with the real values and re-run `npm run seed`.",
        "  Invoices snapshot this row permanently, so it is left empty rather than faked.",
        "",
      ].join("\n"),
    );
    return;
  }

  const existing = await knex("business_profile").first();
  if (existing) {
    await knex("business_profile").where({ id: existing.id }).update(PROFILE);
    console.log(`Updated business profile: ${PROFILE.trade_name}`);
    return;
  }

  await knex("business_profile").insert(PROFILE);
  console.log(`Created business profile: ${PROFILE.trade_name}`);
}
