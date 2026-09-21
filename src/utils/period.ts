export type PeriodKey = "month" | "quarter" | "year";

export interface ResolvedPeriod {
  key: PeriodKey;
  /** Inclusive YYYY-MM-DD bounds. */
  from: string;
  to: string;
  /** Human range for the dashboard subtitle, e.g. "1-21 March 2026". */
  label: string;
  /** Compact form for narrow screens, e.g. "March 2026". */
  shortLabel: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const dateOnly = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const parsePeriodKey = (value: unknown): PeriodKey =>
  value === "quarter" || value === "year" ? value : "month";

/**
 * Periods run from the start of the calendar month, quarter or year up to
 * today -- a dashboard reports on the period in progress, so the range is
 * to-date rather than the whole calendar block.
 */
export const resolvePeriod = (key: PeriodKey, today = new Date()): ResolvedPeriod => {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let start: Date;
  if (key === "year") {
    start = new Date(end.getFullYear(), 0, 1);
  } else if (key === "quarter") {
    start = new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1);
  } else {
    start = new Date(end.getFullYear(), end.getMonth(), 1);
  }

  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const label = sameMonth
    ? `${start.getDate()}-${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
    : `${start.getDate()} ${MONTHS[start.getMonth()]} - ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;

  const shortLabel =
    key === "year"
      ? String(end.getFullYear())
      : key === "quarter"
        ? `${MONTHS[start.getMonth()].slice(0, 3)}-${MONTHS[end.getMonth()].slice(0, 3)} ${end.getFullYear()}`
        : `${MONTHS[end.getMonth()]} ${end.getFullYear()}`;

  return { key, from: dateOnly(start), to: dateOnly(end), label, shortLabel };
};
