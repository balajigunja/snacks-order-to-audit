// Today's date in India as 'YYYY-MM-DD' (so an invoice made at 11pm IST is not dated tomorrow/yesterday).
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// Indian financial year runs April -> March.
//   2026-11-23 -> '2026-27'      2026-03-31 -> '2025-26'
export function getFinYear(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}