import type { Knex } from "knex";
import bcrypt from "bcrypt";
import { config } from "../config/config";

export async function seed(knex: Knex): Promise<void> {
  const { email, password, name } = config.admin;

  const existing = await knex("users").where({ email }).first();
  if (existing) {
    console.log(`Admin user already exists: ${email}`);
    return;
  }

  const password_hash = await bcrypt.hash(password, 10);
  await knex("users").insert({ name, email, password_hash, role: "admin" });
  console.log(`Created admin user: ${email}`);
}
