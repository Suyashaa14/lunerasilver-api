import type { Knex } from "knex";

// Expenses get their numbers from the same gapless allocator as invoices,
// rather than a number derived from the row id.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    "ALTER TABLE `invoice_sequences` MODIFY COLUMN `series` ENUM('SALES','CN','PROFORMA','EXPENSE') NOT NULL",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex("invoice_sequences").where({ series: "EXPENSE" }).del();
  await knex.raw(
    "ALTER TABLE `invoice_sequences` MODIFY COLUMN `series` ENUM('SALES','CN','PROFORMA') NOT NULL",
  );
}
