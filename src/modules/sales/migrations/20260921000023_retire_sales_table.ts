import type { Knex } from "knex";

// The sales table was a second, differently-shaped sales path that would never
// reconcile with orders at year end. A counter sale is now customers ->
// invoices -> payments -> inventory_transactions.
//
// It is renamed rather than dropped so the old rows stay readable until the
// totals have been reconciled. Nothing writes to it.
export async function up(knex: Knex): Promise<void> {
  const hasSales = await knex.schema.hasTable("sales");
  if (hasSales) {
    await knex.raw("RENAME TABLE `sales` TO `sales_legacy`");
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasLegacy = await knex.schema.hasTable("sales_legacy");
  if (hasLegacy) {
    await knex.raw("RENAME TABLE `sales_legacy` TO `sales`");
  }
}
