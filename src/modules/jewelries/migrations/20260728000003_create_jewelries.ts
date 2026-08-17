import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("jewelries", (t) => {
    t.increments("id").primary();
    t.string("name", 190).notNullable();
    t.string("category", 60).notNullable().defaultTo("other");
    t.string("image_url", 500).nullable();
    t.string("image_public_id", 255).nullable();
    t.decimal("silver_weight_grams", 10, 3).notNullable();
    t.decimal("making_charge", 10, 2).notNullable();
    t.enu("status", ["available", "sold"]).notNullable().defaultTo("available");
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("jewelries");
}
