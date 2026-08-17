import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("sales", (t) => {
    t.increments("id").primary();
    t.string("ring_name", 190).notNullable();
    t.enu("source", ["homemade", "bought"]).notNullable().defaultTo("homemade");
    t.decimal("silver_weight_grams", 10, 3).notNullable();
    t.decimal("silver_rate_per_gram", 10, 2).notNullable();
    t.decimal("stone_weight_grams", 10, 3).nullable();
    t.decimal("stone_price", 10, 2).nullable().defaultTo(0);
    t.decimal("making_charge", 10, 2).nullable().defaultTo(0);
    t.decimal("sold_price", 10, 2).notNullable();
    t.date("sold_at").notNullable();
    t.text("notes").nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("sales");
}
