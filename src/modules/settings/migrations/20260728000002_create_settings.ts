import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("settings", (t) => {
    t.increments("id").primary();
    t.decimal("silver_rate_per_gram", 10, 2).notNullable().defaultTo(0);
    t.string("esewa_qr_url", 500).nullable();
    t.timestamps(true, true);
  });

  await knex("settings").insert({ id: 1, silver_rate_per_gram: 0 });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("settings");
}
