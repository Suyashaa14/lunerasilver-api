import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("sales", (t) => {
    t.integer("jewelry_id").unsigned().nullable().references("id").inTable("jewelries").onDelete("SET NULL");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("sales", (t) => {
    t.dropColumn("jewelry_id");
  });
}
