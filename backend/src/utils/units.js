// Convert any unit to the BASE unit (g, ml, pcs) so we only store integers.
const TO_BASE = { kg: 1000, g: 1, l: 1000, litre: 1000, ml: 1, pcs: 1, packet: 1 };
export function toBase(qty, unit) {
  if (!(unit in TO_BASE)) throw new Error('Unknown unit: ' + unit);
  return Math.round(qty * TO_BASE[unit]);
}
// carton -> packets is per product (1 carton = 20 packets). Pass the factor in.
export const cartonsToPackets = (cartons, packetsPerCarton = 20) => cartons * packetsPerCarton;
