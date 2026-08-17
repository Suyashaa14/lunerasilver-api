// mysql2 returns DATE columns as JS Date objects constructed at local midnight.
// Serializing with .toISOString() (UTC) shifts the date backward for
// positive-offset timezones (e.g. Nepal, UTC+5:45), so read the local
// calendar parts instead of converting to UTC.
export const toDateOnly = (value: unknown): string => {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
};
