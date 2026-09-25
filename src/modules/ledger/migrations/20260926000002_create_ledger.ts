import type { Knex } from "knex";

// The double-entry core. Every financial document posts a balanced entry here,
// and the trial balance, profit and loss and balance sheet are all read from
// these two tables rather than recomputed from the documents.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("accounts", (t) => {
    t.bigIncrements("id").primary();
    t.string("code", 20).notNullable().unique();
    t.string("name", 120).notNullable();
    // Which statement the account rolls into, and which way a debit moves it.
    t.enu("type", ["asset", "liability", "equity", "income", "expense"]).notNullable();
    t.bigInteger("parent_id").unsigned().nullable().references("id").inTable("accounts").onDelete("RESTRICT");
    t.boolean("is_active").notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index(["type"], "accounts_type_index");
  });

  await knex.schema.createTable("journal_entries", (t) => {
    t.bigIncrements("id").primary();
    t.string("entry_no", 32).notNullable().unique();
    t.string("fiscal_year", 9).notNullable();
    t.date("entry_date").notNullable();
    t.string("entry_date_bs", 10).notNullable();
    t.string("narration", 255).notNullable();
    // What caused it. Polymorphic, so no foreign key -- indexed instead.
    t.string("reference_type", 40).nullable();
    t.bigInteger("reference_id").unsigned().nullable();
    t.bigInteger("created_by").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["fiscal_year"], "journal_entries_fiscal_year_index");
    t.index(["entry_date"], "journal_entries_entry_date_index");
    t.index(["reference_type", "reference_id"], "journal_entries_reference_index");
  });

  await knex.schema.createTable("journal_entry_lines", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("journal_entry_id").unsigned().notNullable()
      .references("id").inTable("journal_entries").onDelete("CASCADE");
    t.bigInteger("account_id").unsigned().notNullable()
      .references("id").inTable("accounts").onDelete("RESTRICT");
    t.decimal("debit", 12, 2).notNullable().defaultTo(0);
    t.decimal("credit", 12, 2).notNullable().defaultTo(0);
    t.string("note", 255).nullable();
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["account_id"], "journal_entry_lines_account_index");
    t.index(["journal_entry_id"], "journal_entry_lines_entry_index");
  });

  // A line is one side or the other, never both and never neither.
  await knex.raw(
    "ALTER TABLE `journal_entry_lines` ADD CONSTRAINT `jel_one_sided_check` " +
      "CHECK ((`debit` > 0 AND `credit` = 0) OR (`credit` > 0 AND `debit` = 0))",
  );

  await knex.raw(
    "ALTER TABLE `invoice_sequences` MODIFY COLUMN `series` " +
      "ENUM('SALES','CN','PROFORMA','EXPENSE','ORDER','JOURNAL') NOT NULL",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex("invoice_sequences").where({ series: "JOURNAL" }).del();
  await knex.raw(
    "ALTER TABLE `invoice_sequences` MODIFY COLUMN `series` " +
      "ENUM('SALES','CN','PROFORMA','EXPENSE','ORDER') NOT NULL",
  );
  await knex.schema.dropTableIfExists("journal_entry_lines");
  await knex.schema.dropTableIfExists("journal_entries");
  await knex.schema.dropTableIfExists("accounts");
}
