import type { Knex } from "knex";

/**
 * A credit note gives back the levy along with the goods.
 *
 * Without this column a full refund would return the price of the jewellery but
 * leave the 0.5% sitting against the customer for ever, and the levy account
 * would never net back to zero on a sale that was entirely reversed.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("credit_notes", (t) => {
    t.decimal("skill_promo_amount", 12, 2).notNullable().defaultTo(0).after("vat_amount");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("credit_notes", (t) => {
    t.dropColumn("skill_promo_amount");
  });
}
