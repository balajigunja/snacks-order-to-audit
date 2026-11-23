// Turns a report (columns + rows) into CSV text that Excel opens correctly.
// columns: [{ key, label }]   rows: [{ key: value, ... }]

function cell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // stop spreadsheet formulas: a text cell starting with = + @ (or a non-number starting with -) is prefixed with '
  if (/^[=+@]/.test(text) || (/^-/.test(text) && Number.isNaN(Number(text)))) text = "'" + text;
  // wrap in quotes if it has a comma, quote or new line; double any quotes inside
  if (/[",\n\r]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c.key])).join(','));
  return lines.join('\r\n') + '\r\n';
}