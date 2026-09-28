import type { Knex } from "knex";

/**
 * A supplier bill is never deleted or re-typed. A bill entered wrong is voided:
 * the row stays with its reason and who did it, its ledger entries are reversed,
 * and its pieces come off the shelf. The correct bill is then entered again.
 *
 * That re-entry usually carries the same bill number, so (supplier, bill_no) can
 * no longer be unique across every row -- only across bills still standing.
 * MySQL has no partial unique index, so the service enforces it instead and the
 * unique index becomes a plain one.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("purchases", (t) => {
    t.boolean("is_void").notNullable().defaultTo(false);
    t.text("void_reason").nullable();
    t.bigInteger("voided_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.timestamp("voided_at").nullable();
    // Added before the unique index goes: it backs the supplier_id foreign key.
    t.index(["supplier_id", "bill_no"], "purchases_supplier_bill_index");
  });
  await knex.schema.alterTable("purchases", (t) => {
    t.dropUnique(["supplier_id", "bill_no"], "purchases_supplier_bill_unique");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("purchases", (t) => {
    t.unique(["supplier_id", "bill_no"], { indexName: "purchases_supplier_bill_unique" });
  });
  await knex.schema.alterTable("purchases", (t) => {
    t.dropIndex(["supplier_id", "bill_no"], "purchases_supplier_bill_index");
    t.dropForeign("voided_by");
    t.dropColumn("is_void");
    t.dropColumn("void_reason");
    t.dropColumn("voided_by");
    t.dropColumn("voided_at");
  });
}
