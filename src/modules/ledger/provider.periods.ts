import db from "../../utils/db";
import { writeAuditLog, AuditActor } from "../../utils/audit";
import { trialBalance } from "./provider.ledger";

export const listPeriods = async () => {
  const years = await db("fiscal_years").orderBy("start_date", "desc");
  return Promise.all(
    years.map(async (y: any) => {
      const tb = await trialBalance({ fiscalYear: y.name });
      return {
        name: y.name,
        startDate: y.start_date,
        endDate: y.end_date,
        startDateBs: y.start_date_bs,
        endDateBs: y.end_date_bs,
        status: y.status,
        totalDebit: tb.totalDebit,
        totalCredit: tb.totalCredit,
        balances: tb.balances,
      };
    }),
  );
};

/**
 * Signs off a year.
 *
 * A year whose books do not balance is refused: closing it would freeze a
 * trial balance that is already wrong, and every later report would inherit it.
 *
 * After this, `assertFiscalYearOpen` refuses any write stamped with the year --
 * invoices, payments, expenses, journal entries, all of it.
 */
export const closePeriod = async (name: string, actor: AuditActor) => {
  const year = await db("fiscal_years").where({ name }).first();
  if (!year) throw Object.assign(new Error(`No fiscal year ${name}`), { status: 404 });
  if (year.status === "closed") throw Object.assign(new Error(`${name} is already closed`), { status: 409 });

  const tb = await trialBalance({ fiscalYear: name });
  if (!tb.balances) {
    throw Object.assign(
      new Error(
        `${name} does not balance: debits ${tb.totalDebit}, credits ${tb.totalCredit}. ` +
          `Fix the difference before closing, or it is frozen into every later report.`,
      ),
      { status: 409 },
    );
  }

  await db.transaction(async (trx) => {
    await trx("fiscal_years").where({ name }).update({ status: "closed" });
    await writeAuditLog(trx, {
      ...actor,
      action: "update",
      entityType: "fiscal_years",
      entityId: year.id,
      oldValues: { status: "open" },
      newValues: { status: "closed", totalDebit: tb.totalDebit, totalCredit: tb.totalCredit },
    });
  });

  return { name, status: "closed", totalDebit: tb.totalDebit, totalCredit: tb.totalCredit };
};

/**
 * Reopens a closed year. Deliberately awkward: it needs a reason, and the
 * reason is kept, because reopening a signed-off period is the kind of thing an
 * auditor will ask about.
 */
export const reopenPeriod = async (name: string, reason: string, actor: AuditActor) => {
  const year = await db("fiscal_years").where({ name }).first();
  if (!year) throw Object.assign(new Error(`No fiscal year ${name}`), { status: 404 });
  if (year.status === "open") throw Object.assign(new Error(`${name} is already open`), { status: 409 });

  await db.transaction(async (trx) => {
    await trx("fiscal_years").where({ name }).update({ status: "open" });
    await writeAuditLog(trx, {
      ...actor,
      action: "update",
      entityType: "fiscal_years",
      entityId: year.id,
      oldValues: { status: "closed" },
      newValues: { status: "open", reason },
    });
  });

  return { name, status: "open", reason };
};
