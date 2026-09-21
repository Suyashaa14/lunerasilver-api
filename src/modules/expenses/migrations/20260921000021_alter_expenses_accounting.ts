import type { Knex } from "knex";

// `amount` stays the gross figure the shop actually paid, and is the column all
// existing reports sum. taxable_amount + vat_amount decompose it for the VAT
// return, and are backfilled as (amount, 0) while the shop is not registered.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("expenses", (t) => {
    t.string("expense_no", 24).nullable().after("id");
    t.bigInteger("supplier_id").unsigned().nullable().references("id").inTable("suppliers").onDelete("RESTRICT");
    t.string("bill_no", 60).nullable();
    t.decimal("taxable_amount", 12, 2).nullable();
    t.decimal("vat_amount", 12, 2).notNullable().defaultTo(0);
    t.enu("payment_method", ["cash", "cod", "esewa_qr", "bank_transfer", "card"]).nullable();
    t.string("payment_reference", 80).nullable();
    t.bigInteger("receipt_document_id").unsigned().nullable().references("id").inTable("documents").onDelete("SET NULL");
    t.string("spent_at_bs", 10).nullable();
    t.string("fiscal_year", 9).nullable();
    t.bigInteger("created_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
  });

  await knex.raw("UPDATE `expenses` SET `taxable_amount` = `amount` WHERE `taxable_amount` IS NULL");
  await knex.raw("UPDATE `expenses` SET `expense_no` = CONCAT('EXP-', LPAD(`id`, 6, '0')) WHERE `expense_no` IS NULL");
  await knex.raw("ALTER TABLE `expenses` MODIFY COLUMN `taxable_amount` DECIMAL(12,2) NOT NULL");
  await knex.raw("ALTER TABLE `expenses` MODIFY COLUMN `expense_no` VARCHAR(24) NOT NULL");
  await knex.raw("ALTER TABLE `expenses` MODIFY COLUMN `amount` DECIMAL(12,2) NOT NULL");

  await knex.schema.alterTable("expenses", (t) => {
    t.unique(["expense_no"], { indexName: "expenses_expense_no_unique" });
    t.index(["fiscal_year"], "expenses_fiscal_year_index");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("expenses", (t) => {
    t.dropUnique(["expense_no"], "expenses_expense_no_unique");
    t.dropIndex(["fiscal_year"], "expenses_fiscal_year_index");
    t.dropForeign("supplier_id");
    t.dropForeign("receipt_document_id");
    t.dropForeign("created_by");
    t.dropColumn("expense_no");
    t.dropColumn("supplier_id");
    t.dropColumn("bill_no");
    t.dropColumn("taxable_amount");
    t.dropColumn("vat_amount");
    t.dropColumn("payment_method");
    t.dropColumn("payment_reference");
    t.dropColumn("receipt_document_id");
    t.dropColumn("spent_at_bs");
    t.dropColumn("fiscal_year");
    t.dropColumn("created_by");
  });
  await knex.raw("ALTER TABLE `expenses` MODIFY COLUMN `amount` DECIMAL(10,2) NOT NULL");
}
