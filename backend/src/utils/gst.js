import { percentOf } from './money.js';
// Same state as factory -> CGST + SGST (half each). Different state -> IGST.
export function calculateGst(taxablePaisa, rateBp, customerState, factoryState = 'Tamil Nadu') {
  const total = percentOf(taxablePaisa, rateBp);
  if (customerState === factoryState) {
    const cgst = Math.floor(total / 2);
    const sgst = total - cgst; // so cgst+sgst always equals total
    return { cgst, sgst, igst: 0, total };
  }
  return { cgst: 0, sgst: 0, igst: total, total };
}
