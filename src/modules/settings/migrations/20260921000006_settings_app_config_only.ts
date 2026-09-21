import type { Knex } from "knex";

// Business identity moves to business_profile and the silver rate moves to the
// silver_rates history. settings keeps only app configuration.
//
// The current rate is carried into silver_rates before the column is dropped --
// losing it would leave the shop with no rate at all on the next boot.
export async function up(knex: Knex): Promise<void> {
  const hasRate = await knex.schema.hasColumn("settings", "silver_rate_per_gram");
  if (hasRate) {
    const current = await knex("settings").first("silver_rate_per_gram", "silver_rate_source", "silver_rate_synced_at");
    if (current && Number(current.silver_rate_per_gram) > 0) {
      await knex("silver_rates").insert({
        rate_per_gram: current.silver_rate_per_gram,
        source: current.silver_rate_source ?? "manual",
        effective_from: current.silver_rate_synced_at ?? knex.fn.now(),
        effective_to: null,
      });
    }
    await knex.schema.alterTable("settings", (t) => t.dropColumn("silver_rate_per_gram"));
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasRate = await knex.schema.hasColumn("settings", "silver_rate_per_gram");
  if (!hasRate) {
    await knex.schema.alterTable("settings", (t) => {
      t.decimal("silver_rate_per_gram", 10, 2).notNullable().defaultTo(0);
    });
    const latest = await knex("silver_rates").whereNull("effective_to").orderBy("id", "desc").first();
    if (latest) {
      await knex("settings").update({ silver_rate_per_gram: latest.rate_per_gram });
    }
  }
}
