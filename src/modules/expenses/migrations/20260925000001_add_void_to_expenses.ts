import type { Knex } from "knex";

// An expense is never deleted. It is voided: the row stays, stops counting in
// totals, and carries the reason and the person who did it.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("expenses", (t) => {
    t.boolean("is_void").notNullable().defaultTo(false);
    t.text("void_reason").nullable();
    t.bigInteger("voided_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.timestamp("voided_at").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("expenses", (t) => {
    t.dropForeign("voided_by");
    t.dropColumn("is_void");
    t.dropColumn("void_reason");
    t.dropColumn("voided_by");
    t.dropColumn("voided_at");
  });
}
