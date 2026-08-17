import knex from "knex";
import mysqlConfig from "../../knexfile";

const db = knex(mysqlConfig);

export default db;
