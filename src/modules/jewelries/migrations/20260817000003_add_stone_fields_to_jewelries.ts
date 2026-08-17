import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("jewelries", (t) => {
    t.decimal("stone_weight_grams", 10, 3).nullable();
    t.decimal("stone_price", 10, 2).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("jewelries", (t) => {
    t.dropColumn("stone_weight_grams");
    t.dropColumn("stone_price");
  });
}
