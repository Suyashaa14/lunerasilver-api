import type { Knex } from "knex";

// Invoice lines snapshot everything else about the piece, but not its category,
// so "sales by category" could not be rebuilt from invoices at all -- the
// analytics page was left reading the retired sales table instead.
//
// Rows written before this exists keep NULL. That is honest: the category at
// the time of sale was not recorded, and back-filling it from the catalogue
// today would invent history.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("invoice_items", (t) => {
    t.string("category_snapshot", 60).nullable().after("sku_snapshot");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("invoice_items", (t) => t.dropColumn("category_snapshot"));
}
