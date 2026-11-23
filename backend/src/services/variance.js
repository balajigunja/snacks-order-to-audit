// VARIANCE = "what actually happened" compared with "what should have happened".


// (actual - standard) / standard, as a % x100.

export function variancePctX100(actual, standard) {
  if (standard === 0) return 0;
  return Math.round(((actual - standard) * 10000) / standard);
}
//   oil:   actual 10500 ml vs standard 10000 ml  ->  +500  (+5%)
//   yield: actual 188 vs expected 200            ->  -600  (-6%)

export function isFlagged(pctX100, tolerancePct = Number(process.env.VARIANCE_TOLERANCE_PCT || 3)) {
  return Math.abs(pctX100) > tolerancePct * 100;
}


export const formatPct = (pctX100) => (pctX100 / 100).toFixed(2) + '%';
