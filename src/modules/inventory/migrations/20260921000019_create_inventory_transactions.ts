import type { Knex } from "knex";

// Append-only stock ledger. Every movement of a piece -- booked in from a
// purchase, sold on an invoice, returned on a credit note, written off --
// is one row here, so current stock is always reconstructable.
//
// reference_type/reference_id is deliberately polymorphic and therefore has no
// foreign key; the index below is what makes it queryable.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("inventory_transactions", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("jewelry_id").unsigned().notNullable().references("id").inTable("jewelries").onDelete("RESTRICT");
    t.enu("type", ["purchase", "sale", "return", "adjustment", "damage", "lost"]).notNullable();
    t.enu("direction", ["in", "out"]).notNullable();
    t.integer("quantity").notNullable().defaultTo(1);
    t.decimal("cost_amount", 12, 2).nullable();
    t.enu("reference_type", ["purchase", "invoice", "credit_note", "manual"]).notNullable();
    t.bigInteger("reference_id").unsigned().nullable();
    t.text("note").nullable();
    t.bigInteger("created_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["jewelry_id", "created_at"], "inventory_transactions_jewelry_created_index");
    t.index(["reference_type", "reference_id"], "inventory_transactions_reference_index");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("inventory_transactions");
}
