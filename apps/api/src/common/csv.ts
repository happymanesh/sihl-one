/**
 * One CSV cell.
 *
 * A leading `=`, `+`, `-` or `@` makes Excel treat the value as a formula, so a
 * lead called "=cmd" executes on open. Prefixing an apostrophe is the standard
 * defence and is invisible in the cell.
 *
 * Lived privately in two services and was about to live in a third. One copy,
 * because the day they drift is the day one export is injectable and nobody
 * notices which.
 */
export function csvCell(value: string): string {
  const risky = /^[=+\-@\t\r]/.test(value);
  const text = risky ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * A byte-order mark in front of the rows, so Excel reads the file as UTF-8.
 *
 * Without it Excel assumes the system codepage and mangles every name with a
 * character outside ASCII — which for an Indian client or staff list is a lot
 * of them. Nobody reports it as a bug; they just retype the names.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
