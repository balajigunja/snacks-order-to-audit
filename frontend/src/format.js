// Display helpers. The database stores money as whole paisa; we only convert at the last moment.
export const formatINR = (paisa) =>
  '₹' + (paisa / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The server stores UTC times like '2026-11-23 09:30:00'. Show them in India time.
export function formatDateTime(utcText) {
  if (!utcText) return '';
  const d = new Date(utcText.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
