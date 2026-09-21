import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("fiscal_years", (t) => {
    t.bigIncrements("id").primary();
    t.string("name", 9).notNullable().unique(); // 2082/83
    t.date("start_date").notNullable();
    t.date("end_date").notNullable();
    t.string("start_date_bs", 10).notNullable();
    t.string("end_date_bs", 10).notNullable();
    // Closing a year is enforced in the service layer: no financial row may be
    // inserted carrying a closed year.
    t.enu("status", ["open", "closed"]).notNullable().defaultTo("open");
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("fiscal_years");
}
