import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("order_items", (t) => {
    t.increments("id").primary();
    t.integer("order_id").unsigned().notNullable().references("id").inTable("orders").onDelete("CASCADE");
    t.integer("jewelry_id").unsigned().nullable().references("id").inTable("jewelries").onDelete("SET NULL");
    t.string("name_snapshot", 190).notNullable();
    t.string("image_snapshot", 500).nullable();
    t.decimal("silver_weight_snapshot", 10, 3).notNullable();
    t.decimal("making_charge_snapshot", 10, 2).notNullable();
    t.decimal("silver_rate_snapshot", 10, 2).notNullable();
    t.decimal("unit_price_snapshot", 12, 2).notNullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("order_items");
}
