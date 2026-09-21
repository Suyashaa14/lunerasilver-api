import type { Knex } from "knex";

// A return or cancellation issues a credit note against the original invoice.
// The invoice itself is never edited.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("credit_notes", (t) => {
    t.bigIncrements("id").primary();
    t.string("credit_note_no", 32).notNullable();
    t.string("fiscal_year", 9).notNullable();
    t.bigInteger("invoice_id").unsigned().notNullable().references("id").inTable("invoices").onDelete("RESTRICT");
    t.bigInteger("customer_id").unsigned().notNullable().references("id").inTable("customers").onDelete("RESTRICT");
    t.text("reason").notNullable();
    t.timestamp("issued_at").notNullable();
    t.string("issued_date_bs", 10).notNullable();

    t.decimal("subtotal", 12, 2).notNullable().defaultTo(0);
    t.decimal("discount", 12, 2).notNullable().defaultTo(0);
    t.decimal("taxable_amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("vat_amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("total_amount", 12, 2).notNullable().defaultTo(0);

    t.bigInteger("created_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.timestamps(true, true);

    t.unique(["credit_note_no"], { indexName: "credit_notes_no_unique" });
    t.index(["fiscal_year", "credit_note_no"], "credit_notes_fiscal_year_no_index");
    t.index(["invoice_id"], "credit_notes_invoice_id_index");
  });

  await knex.schema.createTable("credit_note_items", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("credit_note_id").unsigned().notNullable().references("id").inTable("credit_notes").onDelete("CASCADE");
    t.bigInteger("invoice_item_id").unsigned().notNullable().references("id").inTable("invoice_items").onDelete("RESTRICT");
    t.string("description", 190).notNullable();
    t.integer("quantity").notNullable().defaultTo(1);
    t.decimal("amount", 12, 2).notNullable().defaultTo(0);
    t.decimal("vat_amount", 12, 2).notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("credit_note_items");
  await knex.schema.dropTableIfExists("credit_notes");
}
