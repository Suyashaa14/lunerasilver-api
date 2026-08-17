import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("cart_items", (t) => {
    t.increments("id").primary();
    t.integer("user_id").unsigned().notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.integer("jewelry_id").unsigned().notNullable().references("id").inTable("jewelries").onDelete("CASCADE");
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.unique(["user_id", "jewelry_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("cart_items");
}
