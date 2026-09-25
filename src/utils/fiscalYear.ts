import type { Knex } from "knex";
import NepaliDate from "nepali-date-converter";

export class FiscalYearMissing extends Error {
  status = 400;
  constructor(date: string) {
    super(`No fiscal year covers ${date}. Add it to fiscal_years first.`);
    this.name = "FiscalYearMissing";
  }
}

export class FiscalYearClosed extends Error {
  status = 409;
  constructor(fiscalYear: string) {
    super(
      `Fiscal year ${fiscalYear} is closed. Its books are signed off, so nothing ` +
        `new can be recorded in it. Post the entry in the open year instead.`,
    );
    this.name = "FiscalYearClosed";
  }
}

const toDateOnly = (value: string | Date): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

/**
 * Bikram Sambat date as YYYY-MM-DD.
 *
 * BS month lengths differ from year to year -- Ashadh 2083 has 32 days, Ashadh
 * 2084 has 31 -- so this is a lookup, never arithmetic on the AD date. The
 * conversion is checked in the tests against the company's own incorporation
 * certificate: 2026-03-29 AD = 2082-12-15 BS.
 */
export const toBsDate = (value: string | Date): string => {
  const ad = toDateOnly(value);
  const nepali = new NepaliDate(new Date(`${ad}T00:00:00`));
  const month = String(nepali.getMonth() + 1).padStart(2, "0");
  const day = String(nepali.getDate()).padStart(2, "0");
  return `${nepali.getYear()}-${month}-${day}`;
};

/** Which fiscal year an AD date falls in, e.g. "2083/84". */
export const resolveFiscalYear = async (
  conn: Knex | Knex.Transaction,
  value: string | Date,
): Promise<string> => {
  const date = toDateOnly(value);
  const year = await conn("fiscal_years")
    .where("start_date", "<=", date)
    .andWhere("end_date", ">=", date)
    .first("name");

  if (!year) throw new FiscalYearMissing(date);
  return year.name as string;
};

/** Refuses a year whose books are closed. */
export const assertFiscalYearOpen = async (
  conn: Knex | Knex.Transaction,
  fiscalYear: string,
): Promise<void> => {
  const year = await conn("fiscal_years").where({ name: fiscalYear }).first("name", "status");
  if (!year) throw new FiscalYearMissing(fiscalYear);
  if (year.status === "closed") throw new FiscalYearClosed(fiscalYear);
};

/**
 * The two columns every financial row is stamped with, worked out once at write
 * time rather than derived later at report time -- a report that recomputes the
 * period would silently move rows between years if a boundary were ever edited.
 *
 * Refuses a closed year, so this is the single place the guard has to live.
 */
export const stampForDate = async (
  conn: Knex | Knex.Transaction,
  value: string | Date,
): Promise<{ fiscalYear: string; bsDate: string }> => {
  const fiscalYear = await resolveFiscalYear(conn, value);
  await assertFiscalYearOpen(conn, fiscalYear);
  return { fiscalYear, bsDate: toBsDate(value) };
};
