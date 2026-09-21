import type { Knex } from "knex";

// Single row, id = 1. Invoices snapshot these values at issue time rather than
// joining, so changing the trade name later never rewrites past documents.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("business_profile", (t) => {
    t.bigIncrements("id").primary();
    t.string("legal_name", 190).notNullable();
    t.string("trade_name", 190).notNullable();
    t.string("registration_number", 60).nullable();
    t.string("pan", 20).notNullable();
    t.string("vat_number", 20).nullable();
    t.string("address_line", 190).notNullable();
    t.string("city", 120).notNullable();
    t.string("district", 120).nullable();
    t.string("province", 120).nullable();
    t.string("phone", 40).nullable();
    t.string("email", 190).nullable();
    t.string("website", 190).nullable();
    t.string("logo_url", 500).nullable();
    t.text("invoice_footer").nullable();
    t.text("invoice_terms").nullable();
    t.boolean("is_vat_registered").notNullable().defaultTo(false);
    t.decimal("default_vat_rate", 5, 2).notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("business_profile");
}
