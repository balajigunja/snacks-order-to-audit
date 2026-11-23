// COSTING - weighted average method.
// Average cost = total value in stock / total quantity in stock.
// Flour: 100 kg @ Rs42 + 60 kg @ Rs45 = Rs 6,900 for 160 kg -> Rs 43.125 per kg.
import db from '../db/connection.js';

// Current quantity and total value of an item, from the ledger.
// Issues are stored with a negative value, so SUM() gives what is left.
function onHand(itemId) {
  const last = db
    .prepare('SELECT balance_qty FROM stock_ledger WHERE item_id = ? ORDER BY id DESC LIMIT 1')
    .get(itemId);
  const sum = db
    .prepare('SELECT COALESCE(SUM(value_paisa), 0) AS v FROM stock_ledger WHERE item_id = ?')
    .get(itemId);
  return { qty: last ? last.balance_qty : 0, valuePaisa: sum.v };
}

// Value (in paisa) of issuing qty base units at the current average cost.
// Ex: 40000 g of flour -> 690000 * 40000 / 160000 = 172500 paisa (Rs 1,725).
export function issueValue(itemId, qty) {
  const { qty: have, valuePaisa } = onHand(itemId);
  if (have <= 0) return 0;
  return Math.round((valuePaisa * qty) / have);
}

// Cost of ONE good packet = (materials + labour + power/gas) / good packets.

export function costPerPacket({ materialPaisa, labourPaisa = 0, powerPaisa = 0, goodPackets }) {
  if (!(goodPackets > 0)) throw new Error('goodPackets must be more than 0');
  const totalPaisa = materialPaisa + labourPaisa + powerPaisa;
  return { totalPaisa, perPacketPaisa: Math.round(totalPaisa / goodPackets) };
}

// Profit per packet and margin % x100 (3774 means 37.74%).
export function margin(sellingPaisa, costPaisa) {
  const profitPaisa = sellingPaisa - costPaisa;
  return { profitPaisa, marginPctX100: Math.round((profitPaisa * 10000) / sellingPaisa) };
}