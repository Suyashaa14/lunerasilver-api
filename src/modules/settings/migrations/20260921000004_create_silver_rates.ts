import type { Knex } from "knex";

// Append-only rate history. The current rate is the row with effective_to NULL;
// changing the rate closes that row and inserts a new one in one transaction.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("silver_rates", (t) => {
    t.bigIncrements("id").primary();
    t.decimal("rate_per_gram", 10, 2).notNullable();
    t.enu("source", ["manual", "auto"]).notNullable();
    t.timestamp("effective_from").notNullable();
    t.timestamp("effective_to").nullable();
    t.bigInteger("created_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.index(["effective_from"], "silver_rates_effective_from_index");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("silver_rates");
}
