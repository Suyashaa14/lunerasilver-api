import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("orders", (t) => {
    t.increments("id").primary();
    t.integer("user_id").unsigned().notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.enu("status", ["pending", "confirmed", "completed", "cancelled"]).notNullable().defaultTo("pending");
    t.enu("payment_method", ["cod", "esewa_qr"]).notNullable();
    t.enu("payment_status", ["unpaid", "awaiting_verification", "paid"]).notNullable().defaultTo("unpaid");
    t.decimal("total_amount", 12, 2).notNullable();
    t.string("recipient_name", 190).notNullable();
    t.string("phone", 40).notNullable();
    t.string("address_line", 500).notNullable();
    t.string("city", 120).notNullable();
    t.string("notes", 500).nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("orders");
}
