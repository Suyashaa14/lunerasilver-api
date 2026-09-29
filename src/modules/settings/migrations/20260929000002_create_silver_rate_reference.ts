import type { Knex } from "knex";

/**
 * Published silver rates for days before the shop kept its own, used to
 * suggest a rate when an old bill is typed in.
 *
 * Kept apart from silver_rates on purpose. silver_rates is what the shop
 * actually priced at; these are FENEGOSIDA's published figures. Mixing them
 * in would let an outside figure pass as the shop's own.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("silver_rate_reference", (t) => {
    t.bigIncrements("id").primary();
    t.date("rate_date").notNullable().unique();
    t.decimal("npr_per_oz", 12, 2).notNullable();
    t.decimal("npr_per_gram_999", 10, 2).notNullable();
    t.decimal("npr_per_tola_999", 12, 2).notNullable();
    t.decimal("npr_per_gram_925", 10, 2).notNullable();
    t.string("source", 60).notNullable();
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("silver_rate_reference");
}
