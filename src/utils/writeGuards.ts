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
  "journal_entries",
  "journal_entry_lines",
];

/**
 * Columns that may still change after a document is issued.
 *
 * An issued invoice is a tax document: the customer has a copy, and the tax
 * office may already have the figure. Correcting it means a credit note, not an
 * edit. The only movements allowed are cancelling it and counting reprints.
 *
 * An empty list means nothing at all may change.
 */
export const MUTABLE_COLUMNS: Record<string, string[]> = {
  invoices: ["is_void", "void_reason", "voided_by", "voided_at", "print_count", "updated_at"],
  invoice_items: [],
};

export class ImmutableRecord extends Error {
  status = 409;

  constructor(table: string, columns: string[]) {
    const allowed = MUTABLE_COLUMNS[table];
    super(
      `${table} is immutable once issued. Refused change to: ${columns.join(", ")}. ` +
        (allowed.length > 0
          ? `Only ${allowed.join(", ")} may change. Correct the figures with a credit note.`
          : `Nothing on this row may change. Correct the figures with a credit note.`),
    );
    this.name = "ImmutableRecord";
  }
}

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
  const target = builder as unknown as Record<string, unknown>;

  if (APPEND_ONLY_TABLES.includes(table)) {
    const blocked = () => {
      throw new HardDeleteBlocked(table);
    };
    target.del = blocked;
    target.delete = blocked;
    target.truncate = blocked;
  }

  const allowed = MUTABLE_COLUMNS[table];
  if (allowed) {
    const originalUpdate = target.update as (...args: unknown[]) => unknown;

    target.update = function guardedUpdate(this: unknown, ...args: unknown[]) {
      // knex takes either update({a: 1}) or update("a", 1).
      const columns =
        typeof args[0] === "string" ? [args[0]] : Object.keys((args[0] ?? {}) as Record<string, unknown>);

      const refused = columns.filter((c) => !allowed.includes(c));
      if (refused.length > 0) throw new ImmutableRecord(table, refused);

      return originalUpdate.apply(this, args);
    };

    // increment() builds an UPDATE of its own and would otherwise slip past.
    for (const method of ["increment", "decrement"]) {
      const original = target[method] as (...args: unknown[]) => unknown;
      target[method] = function guarded(this: unknown, ...args: unknown[]) {
        const column = typeof args[0] === "string" ? args[0] : "";
        if (!allowed.includes(column)) throw new ImmutableRecord(table, [column || method]);
        return original.apply(this, args);
      };
    }
  }

  return builder;
};

/** Wraps a knex instance or transaction so every builder it hands out is guarded. */
export const withWriteGuards = <T extends Knex | Knex.Transaction>(conn: T): T =>
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
              (handler as (t: Knex.Transaction) => unknown)(withWriteGuards(trx));
            return (value as (...a: unknown[]) => unknown).call(target, wrapped, ...rest);
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }

      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
