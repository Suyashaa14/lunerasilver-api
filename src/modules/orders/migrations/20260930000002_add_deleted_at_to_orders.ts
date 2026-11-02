import type { Knex } from "knex";

// Orders are never hard-deleted (see utils/writeGuards.ts): the order number is
// already issued and the audit trail points at it. "Deleting" an order hides it
// from the list and records when and by whom, in the audit log.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (t) => {
    t.timestamp("deleted_at").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (t) => {
    t.dropColumn("deleted_at");
  });
}
