import type { Knex } from "knex";

// Orders get a human reference from the same allocator, so an order number can
// never repeat or skip either.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    "ALTER TABLE `invoice_sequences` MODIFY COLUMN `series` ENUM('SALES','CN','PROFORMA','EXPENSE','ORDER') NOT NULL",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex("invoice_sequences").where({ series: "ORDER" }).del();
  await knex.raw(
    "ALTER TABLE `invoice_sequences` MODIFY COLUMN `series` ENUM('SALES','CN','PROFORMA','EXPENSE') NOT NULL",
  );
}
