import type { Knex } from "knex";

/**
 * One phone number, one customer.
 *
 * The code already matched a repeat buyer on their phone, but nothing stopped
 * two rows sharing one -- two counter sales saved at the same instant, or a
 * customer typed in by hand next to one created by a sale, and the buyer's
 * history silently splits in two.
 *
 * MySQL allows any number of NULLs in a unique index, so a walk-in who gives no
 * phone still gets their own row. That is the intended behaviour: without a
 * number there is nothing to recognise them by.
 */
export async function up(knex: Knex): Promise<void> {
  const duplicates = await knex("customers")
    .whereNotNull("phone")
    .select("phone")
    .count({ c: "*" })
    .groupBy("phone")
    .havingRaw("count(*) > 1");

  if (duplicates.length > 0) {
    throw new Error(
      `Cannot make customers.phone unique: ${duplicates.length} number(s) are on more than one ` +
        `customer (${duplicates.map((d: any) => d.phone).join(", ")}). Merge them first.`,
    );
  }

  await knex.schema.alterTable("customers", (t) => {
    t.dropIndex(["phone"], "customers_phone_index");
    t.unique(["phone"], { indexName: "customers_phone_unique" });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("customers", (t) => {
    t.dropUnique(["phone"], "customers_phone_unique");
    t.index(["phone"], "customers_phone_index");
  });
}
