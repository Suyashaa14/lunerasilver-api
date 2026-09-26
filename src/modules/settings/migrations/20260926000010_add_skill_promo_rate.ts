import type { Knex } from "knex";

/**
 * The skill promotion levy charged on top of a sale.
 *
 * Kept beside default_vat_rate rather than written into the code: a rate set by
 * someone else can change, and changing it must not need a deploy. Invoices
 * snapshot the rate they were issued at, so a change never rewrites a document
 * already handed over.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("business_profile", (t) => {
    t.decimal("skill_promo_rate", 5, 2).notNullable().defaultTo(0.5);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("business_profile", (t) => {
    t.dropColumn("skill_promo_rate");
  });
}
