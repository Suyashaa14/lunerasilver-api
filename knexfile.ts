import { Knex } from "knex";
import { config } from "./config/config";

const migration_dir = "./migrations";
const seeds_dir = "./seeds";

const mysqlConfig: Knex.Config = {
  client: config.mysql.client,
  connection: config.mysql.connection,
  migrations: { directory: migration_dir, tableName: "knex_migrations" },
  seeds: { directory: seeds_dir },
  pool: { min: 2, max: 10 },
};

export default mysqlConfig;
