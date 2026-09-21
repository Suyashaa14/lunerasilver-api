import type { Knex } from "knex";

// Each piece is unique, so quantity is always 1 and status is the stock state.
// 'reserved' exists so two customers cannot check out the same ring: it is set
// inside the order transaction and released when reserved_until passes.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("jewelries", (t) => {
    t.string("sku", 40).nullable().after("id");
    t.string("material", 40).notNullable().defaultTo("silver");
    t.string("purity", 10).nullable(); // e.g. 925
    t.decimal("cost_price", 12, 2).nullable(); // landed cost, basis for COGS
    t.timestamp("reserved_until").nullable();
  });

  // Backfill a SKU for any existing piece before the unique index goes on.
  await knex.raw("UPDATE `jewelries` SET `sku` = CONCAT('JW-', LPAD(`id`, 6, '0')) WHERE `sku` IS NULL");
  await knex.raw("ALTER TABLE `jewelries` MODIFY COLUMN `sku` VARCHAR(40) NOT NULL");
  await knex.schema.alterTable("jewelries", (t) => t.unique(["sku"], { indexName: "jewelries_sku_unique" }));

  await knex.raw(
    "ALTER TABLE `jewelries` MODIFY COLUMN `status` ENUM('available','reserved','sold','damaged','lost') NOT NULL DEFAULT 'available'",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("UPDATE `jewelries` SET `status` = 'available' WHERE `status` IN ('reserved','damaged','lost')");
  await knex.raw("ALTER TABLE `jewelries` MODIFY COLUMN `status` ENUM('available','sold') NOT NULL DEFAULT 'available'");
  await knex.schema.alterTable("jewelries", (t) => {
    t.dropUnique(["sku"], "jewelries_sku_unique");
    t.dropColumn("sku");
    t.dropColumn("material");
    t.dropColumn("purity");
    t.dropColumn("cost_price");
    t.dropColumn("reserved_until");
  });
}
