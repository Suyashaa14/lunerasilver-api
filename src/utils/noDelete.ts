import type { Knex } from "knex";

/**
 * Tables a row is never removed from.
 *
 * The money tables come from the database spec. jewelries and the order tables
 * are here too: a piece with stock-ledger rows or invoice lines has to stay for
 * the history to read correctly, and an order is the record behind an invoice.
 *
 * Cancelling is a status change -- void, damaged, lost -- never a delete.
 */
export const APPEND_ONLY_TABLES = [
  "invoices",
  "invoice_items",
  "credit_notes",
  "credit_note_items",
  "payments",
  "purchases",
  "purchase_items",
  "expenses",
  "inventory_transactions",
  "audit_logs",
  "jewelries",
  "orders",
  "order_items",
  "order_status_history",
];

export class HardDeleteBlocked extends Error {
  table: string;
  status = 400;

  constructor(table: string) {
    super(
      `Rows are never deleted from "${table}". Cancel it with a status change ` +
        `(void / damaged / lost) so the history stays complete.`,
    );
    this.name = "HardDeleteBlocked";
    this.table = table;
  }
}

/**
 * Replaces the delete methods on a query builder with ones that throw.
 *
 * This is a tripwire, not a vault: it stops the ordinary mistake -- somebody
 * reaching for `.del()` in a hurry a year from now -- and it fails loudly
 * rather than quietly. A raw SQL DELETE would still get through. Database
 * triggers would close that too; see docs/BUILD-PLAN.md Step 0.3.
 */
export const guardQueryBuilder = <T>(table: string, builder: T): T => {
  if (!APPEND_ONLY_TABLES.includes(table)) return builder;

  const blocked = () => {
    throw new HardDeleteBlocked(table);
  };

  const target = builder as unknown as Record<string, unknown>;
  target.del = blocked;
  target.delete = blocked;
  target.truncate = blocked;
  return builder;
};

/** Wraps a knex instance or transaction so every builder it hands out is guarded. */
export const withDeleteGuard = <T extends Knex | Knex.Transaction>(conn: T): T =>
  new Proxy(conn, {
    apply(target, thisArg, args: unknown[]) {
      const builder = Reflect.apply(target as unknown as (...a: unknown[]) => unknown, thisArg, args);
      return typeof args[0] === "string" ? guardQueryBuilder(args[0], builder) : builder;
    },
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      // Transactions have to be guarded too, or the rule stops applying exactly
      // where the money is written.
      if (prop === "transaction" && typeof value === "function") {
        return function transaction(this: unknown, ...args: unknown[]) {
          const [handler, ...rest] = args;
          if (typeof handler === "function") {
            const wrapped = (trx: Knex.Transaction) =>
              (handler as (t: Knex.Transaction) => unknown)(withDeleteGuard(trx));
            return (value as (...a: unknown[]) => unknown).call(target, wrapped, ...rest);
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }

      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
