import type { Knex } from "knex";

// 'damaged' and 'lost' both mean the piece existed and then something happened
// to it. A mis-entry means it never existed at all. Recording a typo as damaged
// would make the stock history claim a loss that never occurred, so it gets its
// own status.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    "ALTER TABLE `jewelries` MODIFY COLUMN `status` ENUM('available','reserved','sold','damaged','lost','voided') NOT NULL DEFAULT 'available'",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("UPDATE `jewelries` SET `status` = 'damaged' WHERE `status` = 'voided'");
  await knex.raw(
    "ALTER TABLE `jewelries` MODIFY COLUMN `status` ENUM('available','reserved','sold','damaged','lost') NOT NULL DEFAULT 'available'",
  );
}
