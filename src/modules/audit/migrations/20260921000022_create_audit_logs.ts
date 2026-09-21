import type { Knex } from "knex";

// Append-only. Every write to a financial table records one row here inside the
// same transaction -- that pairing is what makes the trail defensible.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("audit_logs", (t) => {
    t.bigIncrements("id").primary();
    t.bigInteger("user_id").unsigned().nullable().references("id").inTable("users").onDelete("RESTRICT");
    t.enu("action", ["create", "update", "void", "login", "role_change"]).notNullable();
    t.string("entity_type", 60).notNullable();
    t.bigInteger("entity_id").unsigned().notNullable();
    t.json("old_values").nullable();
    t.json("new_values").nullable();
    t.string("ip_address", 45).nullable();
    t.string("user_agent", 255).nullable();
    t.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    t.index(["entity_type", "entity_id", "created_at"], "audit_logs_entity_index");
    t.index(["user_id", "created_at"], "audit_logs_user_index");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("audit_logs");
}
