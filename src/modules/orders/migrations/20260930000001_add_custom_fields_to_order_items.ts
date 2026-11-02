import type { Knex } from "knex";

// A custom order line is a piece that does not exist yet: no jewelry row, no
// weight, no price until the workshop has quoted it. The brief the customer gave
// lives on the line itself.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("order_items", (t) => {
    t.boolean("is_custom").notNullable().defaultTo(false);
    t.text("description").nullable();
    t.string("category", 60).nullable();
    t.string("size", 60).nullable();
    t.string("inspo_image_url", 500).nullable();
    t.string("inspo_image_public_id", 255).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("order_items", (t) => {
    t.dropColumn("is_custom");
    t.dropColumn("description");
    t.dropColumn("category");
    t.dropColumn("size");
    t.dropColumn("inspo_image_url");
    t.dropColumn("inspo_image_public_id");
  });
}
