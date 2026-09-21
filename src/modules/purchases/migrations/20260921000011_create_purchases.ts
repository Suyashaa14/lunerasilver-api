import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("purchases", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("supplier_id").unsigned().notNullable().references("id").inTable("suppliers").onDelete("RESTRICT");
    t.string("bill_no", 60).notNullable();
    t.date("bill_date").notNullable();
    t.string("bill_date_bs", 10).notNullable();
    t.string("fiscal_year", 9).notNullable();
    t.decimal("subtotal", 12, 2).notNullable().defaultTo(0);
    t.decimal("discount", 12, 2).notNullable().defaultTo(0);
    t.decimal("taxable_amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("vat_amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("tds_amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("total_amount", 12, 2).notNullable().defaultTo(0);
    t.enu("payment_method", ["cash", "cod", "esewa_qr", "bank_transfer", "card"]).nullable();
    t.enu("payment_status", ["unpaid", "partial", "paid"]).notNullable().defaultTo("unpaid");
    t.text("notes").nullable();
    t.bigInteger("created_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.timestamps(true, true);
    t.unique(["supplier_id", "bill_no"], { indexName: "purchases_supplier_bill_unique" });
    t.index(["fiscal_year"], "purchases_fiscal_year_index");
  });

  await knex.schema.createTable("purchase_items", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("purchase_id").unsigned().notNullable().references("id").inTable("purchases").onDelete("CASCADE");
    // The piece this line produced, once it is booked into stock.
    t.bigInteger("jewelry_id").unsigned().nullable().references("id").inTable("jewelries").onDelete("SET NULL");
    t.string("description", 190).notNullable();
    t.string("material", 40).nullable();
    t.decimal("weight_grams", 10, 3).nullable();
    t.decimal("rate_per_gram", 10, 2).nullable();
    t.integer("quantity").notNullable().defaultTo(1);
    t.decimal("unit_cost", 12, 2).notNullable().defaultTo(0);
    t.decimal("taxable_amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("vat_amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("line_total", 12, 2).notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("purchase_items");
  await knex.schema.dropTableIfExists("purchases");
}
