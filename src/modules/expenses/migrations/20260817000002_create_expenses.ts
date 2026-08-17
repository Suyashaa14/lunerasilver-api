import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("expenses", (t) => {
    t.increments("id").primary();
    t.string("category", 120).notNullable();
    t.decimal("amount", 10, 2).notNullable();
    t.text("note").nullable();
    t.date("spent_at").notNullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("expenses");
}
