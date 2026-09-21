import type { Knex } from "knex";

// The accounting layer specifies BIGINT UNSIGNED keys throughout. MySQL requires
// a foreign key column to match the referenced column's type exactly, so every
// existing key is widened here -- before any new table points at one. Foreign
// keys must be dropped first: a column under an FK cannot be modified.
//
// This also applies the new delete rules: orders and order_items are financial
// history now, so they are no longer removed when a user is deleted.

const FOREIGN_KEYS: { table: string; name: string }[] = [
  { table: "cart_items", name: "cart_items_jewelry_id_foreign" },
  { table: "cart_items", name: "cart_items_user_id_foreign" },
  { table: "order_items", name: "order_items_jewelry_id_foreign" },
  { table: "order_items", name: "order_items_order_id_foreign" },
  { table: "orders", name: "orders_user_id_foreign" },
  { table: "sales", name: "sales_jewelry_id_foreign" },
];

export async function up(knex: Knex): Promise<void> {
  for (const fk of FOREIGN_KEYS) {
    await knex.raw(`ALTER TABLE \`${fk.table}\` DROP FOREIGN KEY \`${fk.name}\``);
  }

  // Primary keys.
  for (const table of ["users", "jewelries", "settings", "orders", "order_items", "cart_items", "sales", "expenses"]) {
    await knex.raw(`ALTER TABLE \`${table}\` MODIFY COLUMN \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT`);
  }

  // Referencing columns. orders.user_id becomes nullable: an order now belongs
  // to a customer, and the login account behind it is optional.
  await knex.raw("ALTER TABLE `orders` MODIFY COLUMN `user_id` BIGINT UNSIGNED NULL");
  await knex.raw("ALTER TABLE `order_items` MODIFY COLUMN `order_id` BIGINT UNSIGNED NOT NULL");
  await knex.raw("ALTER TABLE `order_items` MODIFY COLUMN `jewelry_id` BIGINT UNSIGNED NULL");
  await knex.raw("ALTER TABLE `cart_items` MODIFY COLUMN `user_id` BIGINT UNSIGNED NOT NULL");
  await knex.raw("ALTER TABLE `cart_items` MODIFY COLUMN `jewelry_id` BIGINT UNSIGNED NOT NULL");
  await knex.raw("ALTER TABLE `sales` MODIFY COLUMN `jewelry_id` BIGINT UNSIGNED NULL");

  // The cart is working state, not financial history, so it still cascades.
  await knex.raw(
    "ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE",
  );
  await knex.raw(
    "ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_jewelry_id_foreign` FOREIGN KEY (`jewelry_id`) REFERENCES `jewelries` (`id`) ON DELETE CASCADE",
  );
  await knex.raw(
    "ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT",
  );
  await knex.raw(
    "ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_foreign` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT",
  );
  await knex.raw(
    "ALTER TABLE `order_items` ADD CONSTRAINT `order_items_jewelry_id_foreign` FOREIGN KEY (`jewelry_id`) REFERENCES `jewelries` (`id`) ON DELETE SET NULL",
  );
  // sales is retired by a later migration; its FK is not restored.
}

export async function down(knex: Knex): Promise<void> {
  for (const fk of [
    { table: "cart_items", name: "cart_items_jewelry_id_foreign" },
    { table: "cart_items", name: "cart_items_user_id_foreign" },
    { table: "order_items", name: "order_items_jewelry_id_foreign" },
    { table: "order_items", name: "order_items_order_id_foreign" },
    { table: "orders", name: "orders_user_id_foreign" },
  ]) {
    await knex.raw(`ALTER TABLE \`${fk.table}\` DROP FOREIGN KEY \`${fk.name}\``);
  }

  await knex.raw("ALTER TABLE `orders` MODIFY COLUMN `user_id` INT UNSIGNED NOT NULL");
  await knex.raw("ALTER TABLE `order_items` MODIFY COLUMN `order_id` INT UNSIGNED NOT NULL");
  await knex.raw("ALTER TABLE `order_items` MODIFY COLUMN `jewelry_id` INT UNSIGNED NULL");
  await knex.raw("ALTER TABLE `cart_items` MODIFY COLUMN `user_id` INT UNSIGNED NOT NULL");
  await knex.raw("ALTER TABLE `cart_items` MODIFY COLUMN `jewelry_id` INT UNSIGNED NOT NULL");
  await knex.raw("ALTER TABLE `sales` MODIFY COLUMN `jewelry_id` INT UNSIGNED NULL");

  for (const table of ["users", "jewelries", "settings", "orders", "order_items", "cart_items", "sales", "expenses"]) {
    await knex.raw(`ALTER TABLE \`${table}\` MODIFY COLUMN \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT`);
  }

  await knex.raw(
    "ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE",
  );
  await knex.raw(
    "ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_jewelry_id_foreign` FOREIGN KEY (`jewelry_id`) REFERENCES `jewelries` (`id`) ON DELETE CASCADE",
  );
  await knex.raw(
    "ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE",
  );
  await knex.raw(
    "ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_foreign` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE",
  );
  await knex.raw(
    "ALTER TABLE `order_items` ADD CONSTRAINT `order_items_jewelry_id_foreign` FOREIGN KEY (`jewelry_id`) REFERENCES `jewelries` (`id`) ON DELETE SET NULL",
  );
  await knex.raw(
    "ALTER TABLE `sales` ADD CONSTRAINT `sales_jewelry_id_foreign` FOREIGN KEY (`jewelry_id`) REFERENCES `jewelries` (`id`) ON DELETE SET NULL",
  );
}
