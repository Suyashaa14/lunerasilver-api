import type { Knex } from "knex";

/**
 * Marks a sale typed in from a paper bill made before the system.
 *
 * Its invoice number is the paper bill's own, so the number alone cannot say
 * where it came from. Voiding needs to know: its pieces were never on the
 * shelf, so a void must not put them back there.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("invoices", (t) => {
    t.boolean("is_old_bill").notNullable().defaultTo(false).after("series");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("invoices", (t) => {
    t.dropColumn("is_old_bill");
  });
}
