import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", (t) => {
    t.increments("id").primary();
    t.string("name", 120).notNullable();
    t.string("email", 190).notNullable().unique();
    t.string("password_hash", 190).notNullable();
    t.enu("role", ["admin", "customer"]).notNullable().defaultTo("customer");
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("users");
}
