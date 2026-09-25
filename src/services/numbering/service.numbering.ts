import type { Knex } from "knex";

// Fiscal-year lookup and the closed-year guard live in one place.
export { resolveFiscalYear, FiscalYearMissing, FiscalYearClosed, stampForDate, toBsDate } from "../../utils/fiscalYear";

export type DocumentSeries = "SALES" | "CN" | "PROFORMA" | "EXPENSE" | "ORDER";

export class SequenceMissing extends Error {
  status = 400;
  constructor(fiscalYear: string, series: DocumentSeries) {
    super(
      `No ${series} counter exists for fiscal year ${fiscalYear}. ` +
        `Seed invoice_sequences before issuing documents in this year.`,
    );
    this.name = "SequenceMissing";
  }
}

/**
 * Takes the next number for a series, with no gaps and no duplicates.
 *
 * `FOR UPDATE` locks the counter row until this transaction ends, so a second
 * request asking at the same moment waits rather than reading the same number.
 * Because the lock, the read and the increment all sit inside the caller's
 * transaction, a document that fails to save gives its number back instead of
 * burning it.
 *
 * Deliberately not: MAX(number)+1 (two readers get the same answer), a
 * timestamp (collides, and leaks gaps), or a UUID (not a sequence at all).
 */
export const allocateNumber = async (
  trx: Knex.Transaction,
  fiscalYear: string,
  series: DocumentSeries,
): Promise<string> => {
  const counter = await trx("invoice_sequences")
    .where({ fiscal_year: fiscalYear, series })
    .forUpdate()
    .first();

  if (!counter) throw new SequenceMissing(fiscalYear, series);

  const next = Number(counter.next_number);
  await trx("invoice_sequences").where({ id: counter.id }).update({ next_number: next + 1 });

  return `${counter.prefix}-${fiscalYear}-${String(next).padStart(6, "0")}`;
};
