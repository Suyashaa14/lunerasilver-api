import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("sales", (t) => {
    t.string("category", 60).notNullable().defaultTo("other");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("sales", (t) => {
    t.dropColumn("category");
  });
}
