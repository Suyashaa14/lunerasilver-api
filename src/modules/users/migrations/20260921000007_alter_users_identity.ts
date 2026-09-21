import type { Knex } from "knex";

// Users are a login identity only; the accounting identity is customers.
// Accounts are never deleted -- deactivate, or anonymise on request -- so that
// invoices and orders always resolve to a name.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (t) => {
    t.string("phone", 20).nullable().after("email");
    t.boolean("is_active").notNullable().defaultTo(true);
  });
  await knex.raw("ALTER TABLE `users` MODIFY COLUMN `password_hash` VARCHAR(255) NOT NULL");
  await knex.raw("ALTER TABLE `users` MODIFY COLUMN `role` ENUM('admin','staff','customer') NOT NULL DEFAULT 'customer'");
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("UPDATE `users` SET `role` = 'customer' WHERE `role` = 'staff'");
  await knex.raw("ALTER TABLE `users` MODIFY COLUMN `role` ENUM('admin','customer') NOT NULL DEFAULT 'customer'");
  await knex.raw("ALTER TABLE `users` MODIFY COLUMN `password_hash` VARCHAR(190) NOT NULL");
  await knex.schema.alterTable("users", (t) => {
    t.dropColumn("phone");
    t.dropColumn("is_active");
  });
}
