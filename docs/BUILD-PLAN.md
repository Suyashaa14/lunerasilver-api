# Lunera Silver — Accounting System Build Plan

A turn-by-turn work plan. One step per working session. Each step states what it
is for, what it touches, and how you know it is finished.

**Owner:** sabin@managevehicle.com
**Started:** 2026-09-25
**Scope:** `lunerasilver-api` (primary) and `lunerasilverweb` (admin UI)

---

## How to use this document

1. Pick the **first step that is not `DONE`**. Steps inside a phase are ordered
   by dependency — skipping one will strand the next.
2. Do the step. Nothing else. Scope creep is what turns a phase into a quarter.
3. Verify against **Done when**. If it cannot be verified, it is not done.
4. Update the step's status and add a line to the Changelog.

### Status legend

| Mark | Meaning |
|---|---|
| `TODO` | not started |
| `WIP` | in progress |
| `DONE` | finished and verified |
| `BLOCKED` | waiting on a decision in *Open decisions* |

---

## Current state (verified 2026-09-25)

**Schema — complete.** 25 tables, 36 foreign keys, 1 check constraint. All of the
database spec is applied and reversible (`npm run migrate:rollback` was tested
end to end).

**Data — effectively empty.**

```
users=1  jewelries=2  customers=1  silver_rates=2  settings=1
everything else = 0   (including fiscal_years, business_profile, invoice_sequences)
```

**API — 7 of 17 modules exist.**

| Has routes | Schema only (no code) |
|---|---|
| jewelries, orders, cart, expenses, settings, dashboard, auth, sales *(retired, 410 on write)* | customers, suppliers, invoices\*, payments, purchases, inventory, documents, audit, core |

\* `invoices` has a read/aggregate provider that feeds the dashboard, but **no
write path**. Nothing can create an invoice today.

**Controls — none.** No rule from the database spec's §0 is enforced.
`audit_logs` and `invoice_sequences` have zero references in the codebase.

### What this means

We have a document store, not an accounting system. The thing that makes
software "accounting" is a **double-entry general ledger that every document
posts into** (Phase 3). Until it exists we can produce registers and cash
in/out, but not a trial balance, a balance sheet, or a P&L an auditor can tie
out.

### Known regression

`POST /api/sales` returns **410 Gone** and has no replacement yet, so **there is
currently no way to record a counter sale.** Phase 1 fixes this. If it needs to
work sooner, the stop-gap is to make `sales_legacy` writable again — ask before
doing it, it reopens the reconciliation problem the retirement was meant to close.

---

## Open decisions

These gate real work. Answers come from the accountant, not from us.

| # | Question | Blocks | Why it matters |
|---|---|---|---|
| ~~D1~~ | ~~Sole proprietorship or Pvt Ltd?~~ | — | **ANSWERED 2026-09-25: Private Limited.** Certificate of Incorporation, Companies Act 2063, incorporated 2026-03-29. A Pvt Ltd must keep proper books and file audited financial statements, so **Phase 3 (general ledger) is required, not optional.** |
| D2 | VAT-registered, or PAN only? | **Phase 1, Phase 4** | **Provisionally answered: PAN only.** The filed documents are a PAN registration certificate with no VAT certificate among them. Confirm no separate VAT registration exists — if it does, invoices must carry tax fields from the first one issued. |
| D3 | Does IRD require the billing software to be registered/approved, and must the invoice layout match a prescribed format? | **Phase 1** | Can dictate invoice fields and print layout. Cheaper to know before the first invoice than after a thousand. |
| D4 | Required retention period and acceptable backup form for electronic records. | Phase 5 | Shapes the backup job and the archive format. |
| D5 | Does dealer-in-precious-metals AML/CFT reporting apply, and above what value must customer ID be recorded? | Phase 5 | May force ID capture on `customers` above a threshold. |

**D1 is answered. D2 is provisionally answered** — confirm there is no separate
VAT registration and Phase 1 is unblocked. D3 is still needed before the invoice
print layout is built. The rest can wait.

---

## Phase 0 — Make what exists trustworthy · `COMPLETE`

Small, and it only gets more expensive the longer it waits: an audit trail
retrofitted onto data written without one is worth very little.

### Step 0.1 — Seed reference data · `DONE`

**Goal.** Make it possible to issue a document at all.
**Touches.** `seeds/`, `fiscal_years`, `business_profile`, `invoice_sequences`.
**Do.** Seed the current and previous Nepali fiscal year — as of 2026-09-25 the
current year is **`2083/84`** (Shrawan 1 2083 = 2026-07-17); `2082/83` ended
2026-07-16 — the real business profile (legal name, trade name, PAN, address —
ask the owner; do not invent them), and one `invoice_sequences` row per series
(`SALES`, `CN`, `PROFORMA`) for each open year.

**Verify the calendar.** BS month lengths vary year to year, so the AD
boundaries and the last day of Ashadh must be checked against an official
calendar before any document is issued — `fiscal_year` stamping depends on them.
**Done when.** `fiscal_years` has ≥1 `open` row, `business_profile` has exactly
one row with a real PAN, `invoice_sequences` has one row per (year, series), and
the dashboard header shows the real trade name instead of the `"Lunera Silver"`
fallback.

**Progress (2026-09-25).**
- `seeds/002_fiscal_years.ts` — DONE. 2082/83 and 2083/84, both `open`.
- `seeds/004_invoice_sequences.ts` — DONE. 6 rows, INV/CN/PI across both years.
- `seeds/003_business_profile.ts` — DONE. Filled from the Certificate of
  Incorporation and the PAN certificate: **Lunera Online Business Pvt. Ltd.**,
  reg. 388284/82/83, PAN 623577543, Kathmandu, Bagmati. Incorporated
  2026-03-29 (15 Chaitra 2082).

**Two values to confirm before the first invoice is issued** (`business_profile`
is editable; an issued invoice is not):
- **PAN `623577543`** — read from Devanagari digits on a photographed
  certificate. Check it against the original.
- **Ward number** — the incorporation documents say the registered office is
  Ward 12; the PAN certificate address reads Ward 13, Hyumat. Seeded as 12
  (the registered office). Confirm which belongs on a tax invoice.
- **Trade name `Lunera Silver`** — not on either certificate; it is the
  storefront brand, used for display only. `seller_name` on an invoice is the
  legal name.

### Step 0.2 — Audit log writer · `DONE`

**Goal.** Every financial write leaves a trace, in the same transaction.
**Touches.** new `src/utils/audit.ts`, `audit_logs`.
**Do.** A `writeAuditLog(trx, {userId, action, entityType, entityId, oldValues,
newValues, req})` helper that takes the **transaction** as its first argument so
it cannot be called outside one. Capture IP and user agent from the request.
**Done when.** A unit-level check shows that rolling back the transaction also
rolls back the audit row — the two must never diverge.

**Progress (2026-09-25).** `src/utils/audit.ts` — `writeAuditLog(trx, entry)`
plus `auditActor(req)`. Four tests in `src/utils/audit.test.ts`, all passing:
rollback discards the audit row, commit keeps it with both value snapshots,
credentials are redacted, over-long IP/user-agent are clipped to column width.

Beyond the step as written:
- **Credential redaction.** `password_hash`, `token`, `secret` and friends are
  replaced with `[redacted]`, recursively. Without it the first `role_change`
  entry would copy a bcrypt hash into a table that is never deleted.
- **Width clipping.** A long user agent would otherwise throw mid-transaction
  and roll back a financial write for a cosmetic reason.
- **Compile-time enforcement.** The first parameter is `Knex.Transaction`, so
  passing the root connection fails to compile — verified, not just intended:
  `error TS2345: Argument of type 'Knex' is not assignable to parameter of type
  'Transaction'`.

### Test runner (set up as part of this step)

The project had none. `npm test` now runs Node's built-in test runner over
`src/**/*.test.ts`:

```
TS_NODE_FILES=true node --require ts-node/register --test "src/**/*.test.ts"
```

`npm run typecheck` (`tsc --noEmit`) was added alongside it.

Two things worth knowing before writing the next test:
- **`TS_NODE_FILES=true` is required.** ts-node compiles file by file and would
  otherwise miss `src/types/express.d.ts`, so anything touching `req.user`
  fails to compile.
- **Node's native TypeScript stripping does not work here.** It resolves as ESM
  and demands file extensions; this codebase is CommonJS with extensionless
  imports.
- Tests run against the **dev database**. Each test cleans up after itself —
  keep doing that, or seed data will rot.

### Step 0.3 — No-delete guard · `DONE`

**Goal.** Enforce database spec §0.1.
**Touches.** `expenses`, `jewelries` providers and routes.
**Do.** Remove `DELETE /api/expenses/:id` (it currently hard-deletes) and
`DELETE /api/jewelries/:id`. Replace with a status change: expenses gain a void
flag; jewelries use `status = 'damaged' | 'lost'`, which writes an outbound
`inventory_transactions` row.
**Done when.** No `DELETE` route remains on any financial table, and attempting
`.del()` on one from a repository throws.

**Progress (2026-09-25).**
- `src/utils/noDelete.ts` — `db("expenses").del()` now throws, **synchronously**,
  before the query is built. The guard follows into transactions, which is where
  money is actually written. 14 tables covered; `cart_items` deliberately left
  alone, since a cart is working state, not history.
- `unguardedDb` is exported from `src/utils/db.ts` for tests and maintenance
  only. It is an escape hatch, so the guard is a tripwire rather than a vault —
  raw SQL still gets through. Database triggers (`BEFORE DELETE ... SIGNAL`)
  would close that, but they would also block tests from cleaning up, which
  needs a separate test database first.
- **Expenses:** `DELETE /api/expenses/:id` → `POST /api/expenses/:id/void`.
  Reason required. The row keeps its number and drops out of every total.
- **Jewellery:** `DELETE /api/jewelries/:id` → `POST /api/jewelries/:id/retire`
  with `damaged | lost | voided`. Writes one outbound stock-ledger row so the
  count still adds up. A sold piece is refused — that needs a credit note.
- **`voided` was added** as a fourth retire status. `damaged` and `lost` both
  claim the piece existed and something happened to it; a mis-entry never
  existed. It maps to ledger type `adjustment`, not `damage`, so the stock
  history stops overstating losses.
- **Sales:** the retired module's `POST`/`PUT`/`DELETE` routes were removed
  outright rather than left to answer 410.
- Photos are **not** deleted from Cloudinary on retire — an invoice issued
  earlier may still be showing one.
- 10 tests passing (`npm test`).

**Two bugs found and fixed while doing this:**
1. **Expense creation was broken** and had been since migration
   `20260921000021`, which made `expense_no` and `taxable_amount` `NOT NULL`
   without updating `createExpense`. Every `POST /api/expenses` returned a
   database error. Nobody had created an expense since, so it went unseen.
   Numbering is an interim `EXP-000007` derived from the row id — **replace it
   with the Step 0.4 allocator.**
2. **The frontend typecheck was checking nothing.** `lunerasilverweb/tsconfig.json`
   is a solution file (`"files": []` plus references), so `tsc --noEmit` exits 0
   having read no source at all. The real command is `tsc -b`, now wired up as
   `npm run typecheck` in that project. It immediately found a dead reference
   the no-op check had missed.

### Step 0.4 — Gapless document numbering · `DONE`

**Goal.** Enforce §0.3. This is the single highest-risk piece of the system.
**Touches.** new `src/services/numbering/`, `invoice_sequences`.
**Do.** `allocateNumber(trx, fiscalYear, series)` that locks the sequence row
with `SELECT … FOR UPDATE`, formats `{prefix}-{fiscal_year}-{000001}`, and
increments — all inside the caller's transaction. Never `MAX()+1`, never a
timestamp, never a UUID.
**Done when.** Concurrent allocation produces consecutive numbers with no gaps
and no duplicates (acceptance test §6.2, 1,000 parallel issues).

**Progress (2026-09-25).** `src/services/numbering/service.numbering.ts` —
`allocateNumber(trx, fiscalYear, series)` and `resolveFiscalYear(conn, date)`.
16 tests passing.

- **1,000 parallel allocations returned 1..1000**, every one unique and
  consecutive, in 438 ms. Each ran in its own transaction on its own
  connection, so they genuinely contended for the counter row.
- **A rolled-back document hands its number back** — tested. A failed save must
  not burn a number, or the gap it leaves is indistinguishable from a hidden sale.
- Missing counter and out-of-range date are both refused with named errors
  (`SequenceMissing`, `FiscalYearMissing`) rather than a silent fallback.
- **`EXPENSE` was added to the series enum** and expenses now use the allocator:
  `EXP-2083/84-000001`, with `fiscal_year` stamped at write time. The interim
  id-derived numbering from Step 0.3 is gone.

**Note on `resolveFiscalYear`.** It reads `fiscal_years` by AD date only. Step
0.5 still owns BS conversion, BS-date stamping and the closed-year guard — this
allocator does **not** yet refuse a closed year.

### Step 0.5 — Fiscal year and BS date stamping · `DONE`

**Goal.** Enforce §0.4 and make closed years actually closed.
**Touches.** new `src/utils/fiscalYear.ts`, all financial inserts.
**Do.** AD→BS conversion, resolve a date to its fiscal year, and a guard that
refuses any insert carrying a `closed` year.
**Done when.** Every financial insert stamps `fiscal_year` and its `*_bs` column
at write time, and inserting into a closed year is rejected.

**Progress (2026-09-25).** `src/utils/fiscalYear.ts` — `toBsDate`,
`resolveFiscalYear`, `assertFiscalYearOpen`, `stampForDate`. 23 tests passing.

- **BS conversion uses `nepali-date-converter`** (MIT). BS month lengths are a
  lookup table, not arithmetic, so this could not be hand-written from memory
  without inventing tax-critical data. `nepali-datetime` was rejected: it is
  **GPL-3.0**, which would force this application to be open-sourced.
- **Verified against the company's own Certificate of Incorporation**, which
  prints both calendars: 2026-03-29 AD = 2082-12-15 BS. Matches.
- **Corrected Step 0.1's seed.** Ashadh 2083 has **32** days, not 31, so
  FY 2082/83 ends `2083-03-32`. The seed and the live row are fixed. This was
  the exact uncertainty flagged in 0.1 — and it was wrong.
- `stampForDate` resolves the year, refuses it if closed, and returns the BS
  date. One place for the guard, so it cannot be applied inconsistently.
- `updateExpense` **re-stamps on every write**: moving a date into another
  fiscal year moves the stamp with it, and is refused if that year is closed.
  Editing a row already in a closed year is refused too.

**A second broken write path, found and fixed:** `createOrder` never set
`customer_id`, `order_no`, `fiscal_year` or `placed_at_bs`, all of which
migration `…013` made required. **Checkout had been failing since then** — the
same mistake as the expenses bug in Step 0.3. Orders now find-or-create a
customer, take an `ORD-2083/84-000001` number from the allocator, and stamp both
period columns. Verified end to end.

**Lesson for later phases.** Twice now a migration has made a column required
without the write path being updated, and both went unnoticed because nothing
exercised the path. When a phase adds a required column, exercise the endpoint
that writes it in the same step.

---

## Phase 1 — Money in

The revenue path, and the fix for the counter-sale regression.
**Unblocked** (D1 answered, D2 provisional). D3 still gates the print layout only.

### Step 1.1 — Customers module · `TODO`

**Goal.** A buyer to put on a document.
**Touches.** new `src/modules/customers/` (provider, controller, routes, validator).
**Do.** CRUD plus find-or-create by phone, which is how a walk-in becomes a
record without a duplicate every visit.
**Done when.** A counter sale can attach to an existing customer or create one
in a single call, and no duplicate is created for a repeat phone number.

### Step 1.2 — Issue an invoice · `TODO`

**Goal.** The §4 "issue invoice" transaction.
**Touches.** new `src/modules/invoices/` write path.
**Do.** One transaction: allocate the number (0.4) → insert invoice + items with
**all values snapshotted, never recalculated** → set `jewelries.status='sold'` →
write the outbound `inventory_transactions` row with `cost_amount` → audit log.
Seller and buyer fields are copied from `business_profile` and `customers` at
issue time, not joined.
**Done when.** An invoice exists with items whose `line_total` sums to
`subtotal`, the piece is `sold`, a stock row exists per line, and an audit row
was written — all or nothing.

### Step 1.3 — Invoice immutability and void · `TODO`

**Goal.** Enforce §0.2.
**Touches.** invoices repository.
**Do.** Reject every `UPDATE` except `is_void`, `void_reason`, `voided_by`,
`voided_at`, `print_count`. Voiding requires a reason.
**Done when.** Updating an amount column on an issued invoice is refused at the
repository, not merely avoided by the caller.

### Step 1.4 — Payments · `TODO`

**Goal.** Record money actually received, partial payments included.
**Touches.** new `src/modules/payments/`.
**Do.** Record, verify and refund (a refund is a **negative amount**, never a
delete). Recompute `orders.payment_status` from the payment rows on every write
— it is a cache, never set by hand.
**Done when.** An invoice can be part-paid twice and shows the right outstanding
balance; verified payments never exceed the total unless a refund exists.

### Step 1.5 — Credit notes · `TODO`

**Goal.** Returns and cancellations without touching the original.
**Touches.** new credit-note write path.
**Do.** One transaction: allocate a `CN` number → insert note + items → inbound
`inventory_transactions` (`type='return'`) → negative payment if cash went back
→ set `invoices.is_void` if the whole invoice is reversed → audit log.
**Done when.** A returned sale stops counting as revenue on the dashboard, the
piece is back in stock, and the original invoice row is byte-for-byte unchanged.

### Step 1.6 — Counter sale UI · `TODO`

**Goal.** Replace the retired Sales pages; close the regression.
**Touches.** `lunerasilverweb` — retire `SaleForm`/`SalesList`, add invoice
screens (list, new, detail, print).
**Do.** Desktop and mobile. Then delete `sales_legacy` handling from the UI.
**Done when.** A shop sale can be recorded end to end in the browser and prints
a compliant invoice.

---

## Phase 2 — Money out and stock

Where `cost_price` comes from. Until this exists, gross profit is fiction —
COGS currently reads 0 because nothing writes `inventory_transactions.cost_amount`.

### Step 2.1 — Suppliers · `TODO`
CRUD. **Done when** a purchase can reference a supplier with a PAN.

### Step 2.2 — Purchases · `TODO`
Purchase + purchase items in one transaction, unique per `(supplier_id, bill_no)`
so the same bill cannot be entered twice. **Done when** entering a bill creates
the pieces it bought and links each to its `purchase_items` line.

### Step 2.3 — Inventory ledger · `TODO`
Inbound rows on purchase, adjustment, damage and loss; the outbound rows already
come from Phase 1. **Done when** current stock reconstructed from the ledger
matches `jewelries.status` for every piece.

### Step 2.4 — Expenses upgrade · `TODO`
Wire up `supplier_id`, `bill_no`, `taxable_amount`/`vat_amount`, and
`receipt_document_id`. Add the void flag from 0.3. **Done when** an expense can
carry a supplier bill and a scanned receipt.

### Step 2.5 — Jewellery pages rebuild · `TODO`
List, detail and create — desktop and mobile, per the approved mockups.
**Deliberately sequenced here:** the detail screen shows Source (supplier, bill,
landed cost), Movement (the stock ledger) and Margin (cost price). None of that
exists before 2.2 and 2.3, so building it earlier means building it twice.
**Note.** The mockups specify `price = silver weight × rate + making charge +
stone price`, with **no rounding**. Current `computePrice()` rounds up to the
nearest Rs 50 and ignores stone price. Changing it moves storefront prices —
confirm with the owner before touching it.

---

## Phase 3 — General ledger

**Required** — the company is a Private Limited, so proper books and audited
statements are a statutory obligation, not a preference. This is the phase that
earns the name "accounting software".

### Step 3.1 — Chart of accounts · `TODO`
`accounts` table (code, name, type, parent), seeded with a Nepali small-trader
chart. **Done when** every account has a type that rolls into P&L or balance sheet.

### Step 3.2 — Journal entries · `TODO`
`journal_entries` + `journal_entry_lines`, append-only, with a balance check
refusing any entry whose debits ≠ credits. **Done when** an unbalanced entry
cannot be persisted.

### Step 3.3 — Posting rules · `TODO`
Each document type posts automatically inside its existing transaction: invoice
→ AR / revenue / VAT payable; payment → bank / AR; purchase → inventory / AP /
VAT receivable; expense → expense / bank; credit note → reverse. **Done when**
every financial document produces a balanced entry, and the sum of all entries
is zero.

### Step 3.4 — Period close · `TODO`
Closing a fiscal year locks it against new entries and freezes the trial
balance. **Done when** a closed year rejects writes and its trial balance is
stable across runs.

---

## Phase 4 — Statutory output

Mostly queries once Phase 3 exists; mostly impossible before it.

- **4.1** Trial balance, P&L, balance sheet — `TODO`
- **4.2** Aged receivables and payables — `TODO`
- **4.3** Stock valuation at cost — `TODO`
- **4.4** Sales register, purchase register, VAT return *(D2)* — `TODO`
- **4.5** Export to XLSX/PDF for the accountant — `TODO`

**Done when** the year's revenue from the P&L equals the sales register total
equals verified payments plus outstanding receivables. Three routes, one number.

---

## Phase 5 — Operations

- **5.1** Staff role and permissions (`users.role='staff'` exists, unused) — `TODO`
- **5.2** Document upload and attachment (`documents` table, unused) — `TODO`
- **5.3** Backup, retention and restore drill *(D4)* — `TODO`
- **5.4** AML customer-ID capture above threshold *(D5)* — `TODO`
- **5.5** Acceptance tests — `TODO`

**On tests.** The runner was set up in Step 0.2 (`npm test`). The database spec
lists ten acceptance tests. Write each phase's tests **within that phase**, not
here; 5.5 is only the gap-fill for whatever was missed.

---

## Not building

Deliberately out of scope until the business asks. Each roughly doubles the
surface of the phase it lands in.

Sub-ledger accounts per customer · multi-currency · multi-location stock ·
production and wastage batches · debit notes · payment accounts ·
`roles`/`user_roles` tables (the enum is enough until there are staff).

---

## Changelog

| Date | Step | Note |
|---|---|---|
| 2026-09-25 | — | Plan created. Schema complete; Phases 0–5 all `TODO`. |
| 2026-09-25 | 0.1 | Corrected current fiscal year to **2083/84** (2082/83 ended 2026-07-16). |
| 2026-09-25 | 0.1 | Seeded `fiscal_years` (2) and `invoice_sequences` (6); both idempotent. |
| 2026-09-25 | 0.1 | `business_profile` seeded from incorporation + PAN certificates. Step **DONE**. |
| 2026-09-25 | D1 | **Answered: Private Limited.** Phase 3 is now required, not optional. |
| 2026-09-25 | D2 | Provisionally PAN-only; no VAT certificate filed. Awaiting confirmation. |
| 2026-09-25 | 0.2 | `writeAuditLog` + `auditActor` written; 4 tests passing. Step **DONE**. |
| 2026-09-25 | 0.2 | Test runner added (`npm test`, `npm run typecheck`) — the project had none. |
| 2026-09-25 | 0.3 | Delete guard, expense void, jewellery retire, `voided` status. Step **DONE**. |
| 2026-09-25 | 0.3 | Fixed: expense creation broken since migration `…021` (`expense_no`/`taxable_amount` NOT NULL). |
| 2026-09-25 | 0.3 | Fixed: `lunerasilverweb` `tsc --noEmit` checked zero files; real check is `tsc -b`. |
| 2026-09-25 | 0.4 | Gapless allocator + `EXPENSE` series; expenses rewired. 1,000-parallel test passes. Step **DONE**. |
| 2026-09-25 | 0.5 | BS conversion, fiscal-year stamping, closed-year guard. 23 tests. Step **DONE**. |
| 2026-09-25 | 0.5 | Corrected FY 2082/83 end BS date to `2083-03-32` (Ashadh has 32 days that year). |
| 2026-09-25 | 0.5 | Fixed: `createOrder` broken since migration `…013` — checkout could not complete. |
| 2026-09-25 | — | **Phase 0 complete.** Next: Phase 1, Step 1.1 (customers module). |
