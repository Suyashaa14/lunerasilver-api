import type { Knex } from "knex";

// Scanned evidence behind a row: supplier bills, expense receipts, payment
// screenshots, generated PDFs. Polymorphic reference, so no foreign key.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("documents", (t) => {
    t.bigIncrements("id").primary();
    t.enu("document_type", [
      "purchase_bill",
      "expense_receipt",
      "payment_proof",
      "invoice_pdf",
      "credit_note_pdf",
      "other",
    ]).notNullable();
    t.string("reference_type", 40).nullable();
    t.bigInteger("reference_id").unsigned().nullable();
    t.string("file_name", 255).notNullable();
    t.string("file_url", 500).notNullable();
    t.string("storage_provider", 30).notNullable();
    t.string("storage_public_id", 190).nullable();
    t.string("mime_type", 120).notNullable();
    t.integer("file_size").unsigned().notNullable();
    t.bigInteger("uploaded_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.timestamps(true, true);

    t.index(["reference_type", "reference_id"], "documents_reference_index");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("documents");
}
