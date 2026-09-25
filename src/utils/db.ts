import knex from "knex";
import mysqlConfig from "../../knexfile";
import { withWriteGuards } from "./writeGuards";

/**
 * Raw connection, with no delete guard.
 *
 * Only for tests and maintenance scripts that have to tidy up after
 * themselves. Application code must not import this.
 */
export const unguardedDb = knex(mysqlConfig);

/**
 * The connection the app uses. Calling `.del()` on a money table throws --
 * see src/utils/noDelete.ts for the list and the reasoning.
 */
const db = withWriteGuards(unguardedDb);

export default db;
