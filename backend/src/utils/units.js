// Converting any unit to the BASE unit (g, ml, pcs) so we only store whole numbers.
const TO_BASE = { kg: 1000, g: 1, litre: 1000, l: 1000, ml: 1, pcs: 1, piece: 1, packet: 1 };
const BASE_UNIT_OF = { kg: 'g', g: 'g', litre: 'ml', l: 'ml', ml: 'ml', pcs: 'pcs', piece: 'pcs', packet: 'pcs' };

export function toBase(qty, unit) {
  if (!(unit in TO_BASE)) throw new Error('Unknown unit: ' + unit);
  return Math.round(qty * TO_BASE[unit]);
}

// Which base unit does this unit belong to? (kg -> g, litre -> ml)
export function baseUnitOf(unit) {
  if (!(unit in BASE_UNIT_OF)) throw new Error('Unknown unit: ' + unit);
  return BASE_UNIT_OF[unit];
}


export const cartonsToPackets = (cartons, packetsPerCarton = 20) => cartons * packetsPerCarton;