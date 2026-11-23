// Invoice numbers: INV/2026-27/0001, restarting at 0001 every financial year.
// Call this INSIDE runInTransaction: if the invoice fails, the counter rolls back too,
// so numbers never skip (GST wants consecutive numbers).
import db from '../db/connection.js';
import { getFinYear } from '../utils/dates.js';

export function nextInvoiceNo(dateStr) {
  const fy = getFinYear(dateStr);
  const row = db.prepare('SELECT last_no FROM invoice_counters WHERE fin_year = ?').get(fy);
  const n = (row ? row.last_no : 0) + 1;
  if (row) db.prepare('UPDATE invoice_counters SET last_no = ? WHERE fin_year = ?').run(n, fy);
  else db.prepare('INSERT INTO invoice_counters (fin_year, last_no) VALUES (?, ?)').run(fy, n);
  return `INV/${fy}/${String(n).padStart(4, '0')}`;
}
