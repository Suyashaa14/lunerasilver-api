import { test, after } from "node:test";
import assert from "node:assert/strict";
import db, { unguardedDb } from "./db";
import { toBsDate, resolveFiscalYear, assertFiscalYearOpen, stampForDate, FiscalYearClosed, FiscalYearMissing } from "./fiscalYear";

after(async () => {
  await unguardedDb("fiscal_years").where({ name: "2082/83" }).update({ status: "open" });
  await unguardedDb.destroy();
});

// Anchored on the company's own Certificate of Incorporation, which prints both
// calendars: 29 March 2026 = 15 Chaitra 2082.
test("AD to BS matches the incorporation certificate", () => {
  assert.equal(toBsDate("2026-03-29"), "2082-12-15");
});

// Ashadh is 32 days in 2083 and 31 in 2084. Arithmetic on the AD date cannot
// produce this; only a real calendar table can.
test("month lengths differ between years", () => {
  assert.equal(toBsDate("2026-07-16"), "2083-03-32");
  assert.equal(toBsDate("2027-07-16"), "2084-03-31");
  assert.equal(toBsDate("2026-07-17"), "2083-04-01");
});

test("dates resolve to the right fiscal year", async () => {
  assert.equal(await resolveFiscalYear(db, "2026-09-25"), "2083/84");
  assert.equal(await resolveFiscalYear(db, "2026-07-17"), "2083/84");
  assert.equal(await resolveFiscalYear(db, "2026-07-16"), "2082/83");
});

test("a date in no fiscal year is refused", async () => {
  await assert.rejects(() => resolveFiscalYear(db, "1990-01-01"), FiscalYearMissing);
});

test("an open year passes the guard", async () => {
  await assertFiscalYearOpen(db, "2083/84");
});

test("a closed year is refused, and reopening it lifts the block", async () => {
  await unguardedDb("fiscal_years").where({ name: "2082/83" }).update({ status: "closed" });

  await assert.rejects(() => assertFiscalYearOpen(db, "2082/83"), FiscalYearClosed);
  // A date inside the closed year cannot be stamped at all.
  await assert.rejects(() => stampForDate(db, "2026-05-01"), FiscalYearClosed);
  // The open year is unaffected.
  const stamp = await stampForDate(db, "2026-09-25");
  assert.equal(stamp.fiscalYear, "2083/84");

  await unguardedDb("fiscal_years").where({ name: "2082/83" }).update({ status: "open" });
  await assertFiscalYearOpen(db, "2082/83");
});

test("stamping returns both the period and the BS date", async () => {
  const stamp = await stampForDate(db, "2026-09-25");
  assert.equal(stamp.fiscalYear, "2083/84");
  assert.equal(stamp.bsDate, toBsDate("2026-09-25"));
});
