/** Quotes a CSV cell, and defuses spreadsheet formulas (CSV injection). */
export function csvCell(v: string) {
  const safe = /^[=+\-@\t\r\n]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}
