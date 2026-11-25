// Display helpers. The database stores money as whole paisa and stock in g / ml / pcs;
// we only convert at the very last moment, when showing something to a person.
export const formatINR = (paisa) =>
  '₹' + (paisa / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// reports already send money as text like "7875.00"
export const formatRupeeText = (text) =>
  '₹' + Number(text).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatPct = (x100) => (x100 / 100).toFixed(2) + '%'; // -600 -> "-6.00%"

// stock units: grams -> kg, millilitres -> litres, pieces stay pieces
const DIVIDE = { g: 1000, ml: 1000, pcs: 1 };
const SHOWN_AS = { g: 'kg', ml: 'L', pcs: 'pcs' };
const SENT_AS = { g: 'kg', ml: 'litre', pcs: 'pcs' }; // the unit names the server understands
export const toDisplayQty = (qty, baseUnit) => Number((qty / DIVIDE[baseUnit]).toFixed(3));
export const formatQty = (qty, baseUnit) => `${toDisplayQty(qty, baseUnit)} ${SHOWN_AS[baseUnit]}`;
export const serverUnit = (baseUnit) => SENT_AS[baseUnit];
export const unitChoices = (baseUnit) => ({ g: ['kg', 'g'], ml: ['litre', 'ml'], pcs: ['pcs'] }[baseUnit]);

// The server stores UTC times like '2026-11-23 09:30:00'. Show them in India time.
export function formatDateTime(utcText) {
  if (!utcText) return '';
  const d = new Date(utcText.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

// today's date in India as 2026-11-25, and the India date of a UTC time from the server
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const istDate = (utcText) =>
  new Date(utcText.replace(' ', 'T') + 'Z').toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
