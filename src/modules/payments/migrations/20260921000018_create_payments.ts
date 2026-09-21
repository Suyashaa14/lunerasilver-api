import type { Knex } from "knex";

// Many payments per invoice: partial payment has to work. A refund is a
// negative amount rather than a deletion. orders.payment_status is a derived
// cache recomputed from these rows, never set by hand.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("payments", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("invoice_id").unsigned().nullable().references("id").inTable("invoices").onDelete("RESTRICT");
    t.bigInteger("order_id").unsigned().nullable().references("id").inTable("orders").onDelete("RESTRICT");
    t.decimal("amount", 12, 2).notNullable(); // negative = refund
    t.enu("method", ["cash", "cod", "esewa_qr", "bank_transfer", "card"]).notNullable();
    t.string("reference_no", 80).nullable(); // eSewa txn id / bank ref
    t.enu("status", ["pending", "verified", "rejected", "refunded"]).notNullable().defaultTo("pending");
    t.timestamp("received_at").notNullable();
    t.string("received_date_bs", 10).notNullable();
    t.string("fiscal_year", 9).notNullable();
    t.bigInteger("verified_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.timestamp("verified_at").nullable();
    t.text("note").nullable();
    t.timestamps(true, true);

    t.index(["invoice_id"], "payments_invoice_id_index");
    t.index(["order_id"], "payments_order_id_index");
    t.index(["fiscal_year"], "payments_fiscal_year_index");
  });

  // A payment must belong to something.
  await knex.raw(
    "ALTER TABLE `payments` ADD CONSTRAINT `payments_parent_check` CHECK (`invoice_id` IS NOT NULL OR `order_id` IS NOT NULL)",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("payments");
}
