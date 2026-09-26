import type { Knex } from "knex";

/**
 * The skill promotion levy, charged on top of the goods and owed onward.
 *
 * Both columns default to zero, so every invoice issued before today keeps the
 * total it was handed over with. The rate is stored alongside the amount for
 * the same reason the VAT rate is: the document has to explain its own figures
 * years later, whatever the rate has become since.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("invoices", (t) => {
    t.decimal("skill_promo_rate", 5, 2).notNullable().defaultTo(0).after("vat_rate");
    t.decimal("skill_promo_amount", 12, 2).notNullable().defaultTo(0).after("skill_promo_rate");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("invoices", (t) => {
    t.dropColumn("skill_promo_rate");
    t.dropColumn("skill_promo_amount");
  });
}
