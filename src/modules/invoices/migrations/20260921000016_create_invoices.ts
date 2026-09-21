import type { Knex } from "knex";

// The tax document. Immutable once issued: the service layer permits only
// is_void / void_reason / voided_by / voided_at and print_count to change.
//
// Seller and buyer fields are snapshots, not joins, so a later rename of the
// business or the customer never alters a document already given to a buyer.
// VAT columns are stored even while the shop is not VAT-registered (written as
// 0.00 with taxable_amount = total_amount); retrofitting tax later is worse.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("invoices", (t) => {
    t.bigIncrements("id").primary();
    t.string("invoice_no", 32).notNullable(); // {prefix}-{fiscal_year}-{000001}
    t.string("fiscal_year", 9).notNullable();
    t.enu("series", ["SALES", "PROFORMA"]).notNullable().defaultTo("SALES");
    t.bigInteger("order_id").unsigned().nullable().references("id").inTable("orders").onDelete("RESTRICT");
    t.bigInteger("customer_id").unsigned().notNullable().references("id").inTable("customers").onDelete("RESTRICT");
    t.timestamp("issued_at").notNullable();
    t.string("issued_date_bs", 10).notNullable();

    t.string("seller_name", 190).notNullable();
    t.string("seller_address", 190).notNullable();
    t.string("seller_pan", 190).notNullable();
    t.string("buyer_name", 190).notNullable();
    t.string("buyer_address", 190).notNullable();
    t.string("buyer_pan", 20).nullable();

    t.decimal("subtotal", 12, 2).notNullable().defaultTo(0);
    t.decimal("discount", 12, 2).notNullable().defaultTo(0);
    t.decimal("taxable_amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("vat_amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("total_amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("vat_rate", 5, 2).notNullable().defaultTo(0);

    t.enu("payment_method", ["cod", "esewa_qr", "cash", "bank_transfer"]).notNullable();

    t.boolean("is_void").notNullable().defaultTo(false);
    t.text("void_reason").nullable();
    t.bigInteger("voided_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.timestamp("voided_at").nullable();
    t.integer("print_count").unsigned().notNullable().defaultTo(0); // first print is the original, rest are COPY

    t.bigInteger("created_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.timestamps(true, true);

    t.unique(["invoice_no"], { indexName: "invoices_invoice_no_unique" });
    t.index(["fiscal_year", "invoice_no"], "invoices_fiscal_year_no_index");
    t.index(["customer_id"], "invoices_customer_id_index");
    t.index(["issued_at"], "invoices_issued_at_index");
  });

  await knex.schema.createTable("invoice_items", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("invoice_id").unsigned().notNullable().references("id").inTable("invoices").onDelete("CASCADE");
    t.bigInteger("jewelry_id").unsigned().nullable().references("id").inTable("jewelries").onDelete("SET NULL");

    t.string("name_snapshot", 190).notNullable();
    t.string("sku_snapshot", 40).nullable();
    t.string("image_snapshot", 500).nullable();
    t.decimal("silver_weight_snapshot", 10, 3).nullable();
    t.decimal("silver_rate_snapshot", 10, 2).nullable();
    t.decimal("making_charge_snapshot", 12, 2).nullable();
    t.decimal("stone_weight_snapshot", 10, 3).nullable();
    t.decimal("stone_price_snapshot", 12, 2).nullable();

    t.integer("quantity").notNullable().defaultTo(1);
    t.decimal("unit_price", 12, 2).notNullable().defaultTo(0);
    t.decimal("discount", 12, 2).notNullable().defaultTo(0);
    t.decimal("taxable_amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("vat_amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("line_total", 12, 2).notNullable().defaultTo(0);
    t.timestamps(true, true);

    t.index(["invoice_id"], "invoice_items_invoice_id_index");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("invoice_items");
  await knex.schema.dropTableIfExists("invoices");
}
