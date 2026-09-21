import type { Knex } from "knex";

// An order is a workflow object, not a tax document -- the invoice is. These
// columns give it an accounting identity and the BS/fiscal fields the reports
// group by, written at insert time rather than derived later.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (t) => {
    t.bigInteger("customer_id").unsigned().nullable().after("id");
    t.string("order_no", 24).nullable().after("customer_id");
    t.string("fiscal_year", 9).nullable();
    t.string("placed_at_bs", 10).nullable();
    t.string("courier_name", 80).nullable();
    t.string("tracking_no", 80).nullable();
    t.timestamp("delivered_at").nullable(); // revenue recognition point for COD
  });

  // No rows exist yet, so the NOT NULL columns can be tightened immediately.
  // Against a populated database these would be backfilled first.
  const [{ count }] = (await knex("orders").count({ count: "*" })) as any[];
  if (Number(count) === 0) {
    await knex.raw("ALTER TABLE `orders` MODIFY COLUMN `customer_id` BIGINT UNSIGNED NOT NULL");
    await knex.raw("ALTER TABLE `orders` MODIFY COLUMN `order_no` VARCHAR(24) NOT NULL");
    await knex.raw("ALTER TABLE `orders` MODIFY COLUMN `fiscal_year` VARCHAR(9) NOT NULL");
    await knex.raw("ALTER TABLE `orders` MODIFY COLUMN `placed_at_bs` VARCHAR(10) NOT NULL");
  }

  await knex.schema.alterTable("orders", (t) => {
    t.foreign("customer_id", "orders_customer_id_foreign")
      .references("id")
      .inTable("customers")
      .onDelete("RESTRICT");
    t.unique(["order_no"], { indexName: "orders_order_no_unique" });
    t.index(["fiscal_year"], "orders_fiscal_year_index");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("orders", (t) => {
    t.dropForeign("customer_id", "orders_customer_id_foreign");
    t.dropUnique(["order_no"], "orders_order_no_unique");
    t.dropIndex(["fiscal_year"], "orders_fiscal_year_index");
    t.dropColumn("customer_id");
    t.dropColumn("order_no");
    t.dropColumn("fiscal_year");
    t.dropColumn("placed_at_bs");
    t.dropColumn("courier_name");
    t.dropColumn("tracking_no");
    t.dropColumn("delivered_at");
  });
}
