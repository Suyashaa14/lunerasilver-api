import type { Knex } from "knex";

// The buyer on a document. user_id is null for walk-in counter sales, which
// have no login account.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("customers", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("user_id").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.string("name", 120).notNullable();
    t.string("phone", 20).nullable();
    t.string("email", 190).nullable();
    t.string("pan", 20).nullable(); // required when the buyer is VAT-registered
    t.string("address_line", 190).nullable();
    t.string("city", 190).nullable();
    t.timestamps(true, true);
    t.index(["phone"], "customers_phone_index");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("customers");
}
