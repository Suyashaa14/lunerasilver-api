import type { Knex } from "knex";

// One counter per (fiscal_year, series). Numbers are allocated by locking the
// row with SELECT ... FOR UPDATE inside the same transaction that inserts the
// document, which is what makes the sequence gapless.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("invoice_sequences", (t) => {
    t.bigIncrements("id").primary();
    t.string("fiscal_year", 9).notNullable();
    t.enu("series", ["SALES", "CN", "PROFORMA"]).notNullable();
    t.string("prefix", 12).notNullable();
    t.integer("next_number").unsigned().notNullable().defaultTo(1);
    t.timestamps(true, true);
    t.unique(["fiscal_year", "series"], { indexName: "invoice_sequences_year_series_unique" });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("invoice_sequences");
}
