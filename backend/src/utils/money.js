// All money is integer PAISA. Never use floats for money.
export const rupeesToPaisa = (rupees) => Math.round(rupees * 100);
export const paisaToRupees = (paisa) => (paisa / 100).toFixed(2);
export const formatINR = (paisa) =>
  '₹' + (paisa / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 });

// percent of an amount, rounded to nearest paisa. rateBp: 500 = 5%
export const percentOf = (paisa, rateBp) => Math.round((paisa * rateBp) / 10000);
