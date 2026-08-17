import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("settings", (t) => {
    t.enum("silver_rate_source", ["manual", "auto"]).notNullable().defaultTo("manual");
    t.timestamp("silver_rate_synced_at").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("settings", (t) => {
    t.dropColumn("silver_rate_source");
    t.dropColumn("silver_rate_synced_at");
  });
}
