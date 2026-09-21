import type { Knex } from "knex";

// jewelries.purchase_item_id and purchase_items.jewelry_id point at each other,
// so one direction has to be added after both tables exist. This is that side.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("jewelries", (t) => {
    t.bigInteger("purchase_item_id").unsigned().nullable();
    t.foreign("purchase_item_id", "jewelries_purchase_item_id_foreign")
      .references("id")
      .inTable("purchase_items")
      .onDelete("SET NULL");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("jewelries", (t) => {
    t.dropForeign("purchase_item_id", "jewelries_purchase_item_id_foreign");
    t.dropColumn("purchase_item_id");
  });
}
