/**
 * CSV, not XLSX.
 *
 * A .csv opens directly in Excel and in every accounting package, needs no
 * dependency, and cannot carry a formula error. If a real .xlsx with formatting
 * is ever wanted, that means adding a library -- see docs/BUILD-PLAN.md 4.5.
 */
const escape = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string => {
  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => escape(row[c.key])).join(","));
  // BOM so Excel reads Devanagari and the rupee sign correctly instead of mojibake.
  return `﻿${[header, ...body].join("\n")}\n`;
};
