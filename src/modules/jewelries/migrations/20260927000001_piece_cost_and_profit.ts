import type { Knex } from "knex";

/**
 * What a piece cost, and what the shop adds to it.
 *
 * The cost of a piece is settled the day it is bought and never moves again:
 * the silver rate paid, the making charge paid to the supplier, and the stone.
 * `cost_price` already held the total, but not the rate behind it, so the
 * figure could not be explained afterwards -- only trusted.
 *
 * `profit_amount` is the shop's own margin, typed in rupees per piece. It is
 * the piece of the selling price that is not a cost, and keeping it separate is
 * what stops the making charge doing two jobs at once: it was stored as a cost
 * paid to the supplier and then spent again as the shop's margin.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("jewelries", (t) => {
    t.decimal("cost_rate_per_gram", 12, 2).nullable().after("cost_price");
    t.decimal("profit_amount", 12, 2).notNullable().defaultTo(0).after("cost_rate_per_gram");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("jewelries", (t) => {
    t.dropColumn("cost_rate_per_gram");
    t.dropColumn("profit_amount");
  });
}
