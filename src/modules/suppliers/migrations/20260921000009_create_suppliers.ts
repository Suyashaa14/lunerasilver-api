import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("suppliers", (t) => {
    t.bigIncrements("id").primary();
    t.string("name", 120).notNullable();
    t.string("pan", 20).nullable();
    t.string("phone", 20).nullable();
    t.string("email", 190).nullable();
    t.string("address_line", 190).nullable();
    t.string("city", 190).nullable();
    t.boolean("is_active").notNullable().defaultTo(true);
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("suppliers");
}
