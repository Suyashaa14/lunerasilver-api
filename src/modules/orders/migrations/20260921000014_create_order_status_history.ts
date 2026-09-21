import type { Knex } from "knex";

// Append-only: who moved the order, when, and why.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("order_status_history", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("order_id").unsigned().notNullable().references("id").inTable("orders").onDelete("CASCADE");
    t.string("from_status", 40).nullable();
    t.string("to_status", 40).notNullable();
    t.bigInteger("changed_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.text("reason").nullable();
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    t.index(["order_id", "created_at"], "order_status_history_order_created_index");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("order_status_history");
}
