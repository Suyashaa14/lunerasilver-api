import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import db, { unguardedDb } from "../../utils/db";
import { allocateNumber, resolveFiscalYear, SequenceMissing, FiscalYearMissing } from "./service.numbering";

const YEAR = "TEST/99";
const PREFIX = "TST";

before(async () => {
  await unguardedDb("invoice_sequences").where({ fiscal_year: YEAR }).del();
  await unguardedDb("invoice_sequences").insert({
    fiscal_year: YEAR,
    series: "SALES",
    prefix: PREFIX,
    next_number: 1,
  });
});

after(async () => {
  await unguardedDb("invoice_sequences").where({ fiscal_year: YEAR }).del();
  await unguardedDb.destroy();
});

test("numbers are formatted prefix-year-000001", async () => {
  const number = await db.transaction((trx) => allocateNumber(trx, YEAR, "SALES"));
  assert.equal(number, `${PREFIX}-${YEAR}-000001`);
});

// The one that matters. Every request takes its own connection and its own
// transaction, so they genuinely contend for the counter row.
test("1,000 at once produce 1..1000 — no gaps, no duplicates", async () => {
  const TOTAL = 1000;

  const issued = await Promise.all(
    Array.from({ length: TOTAL }, () => db.transaction((trx) => allocateNumber(trx, YEAR, "SALES"))),
  );

  assert.equal(new Set(issued).size, TOTAL, "duplicate numbers were handed out");

  const sequence = issued
    .map((n) => Number(n.slice(n.lastIndexOf("-") + 1)))
    .sort((a, b) => a - b);

  // The formatting test above already took 1.
  assert.equal(sequence[0], 2);
  assert.equal(sequence[sequence.length - 1], TOTAL + 1);

  for (let i = 1; i < sequence.length; i++) {
    assert.equal(sequence[i], sequence[i - 1] + 1, `gap before ${sequence[i]}`);
  }
});

// A number must not be burned by a document that never saved.
test("rolling back gives the number back", async () => {
  const before = await db("invoice_sequences").where({ fiscal_year: YEAR, series: "SALES" }).first();

  await assert.rejects(
    db.transaction(async (trx) => {
      await allocateNumber(trx, YEAR, "SALES");
      throw new Error("document failed to save");
    }),
    /document failed to save/,
  );

  const after = await db("invoice_sequences").where({ fiscal_year: YEAR, series: "SALES" }).first();
  assert.equal(Number(after.next_number), Number(before.next_number), "a rolled-back document burned a number");
});

test("a year with no counter is refused", async () => {
  await assert.rejects(
    db.transaction((trx) => allocateNumber(trx, "9999/00", "SALES")),
    SequenceMissing,
  );
});

test("a date outside every fiscal year is refused", async () => {
  await assert.rejects(() => resolveFiscalYear(db, "1990-01-01"), FiscalYearMissing);
});

test("a real date resolves to its fiscal year", async () => {
  assert.equal(await resolveFiscalYear(db, "2026-09-25"), "2083/84");
  assert.equal(await resolveFiscalYear(db, "2026-05-01"), "2082/83");
});
