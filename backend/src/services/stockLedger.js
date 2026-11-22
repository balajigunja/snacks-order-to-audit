
import db from '../db/connection.js';

// Current stock of an item, in base units (g, ml, pcs).
export function getBalance(itemId) {
  const lastRow = db
    .prepare('SELECT balance_qty FROM stock_ledger WHERE item_id = ? ORDER BY id DESC LIMIT 1')
    .get(itemId);
  return lastRow ? lastRow.balance_qty : 0; 
}


export function addEntry({ itemId, changeQty, valuePaisa = 0, entryType, sourceDoc, userId = null }) {
  if (!Number.isInteger(changeQty) || changeQty === 0) {
    throw new Error('changeQty must be a non-zero whole number');
  }

  const newBalance = getBalance(itemId) + changeQty;
  if (newBalance < 0) {
    throw new Error(`Not enough stock for item ${itemId}: short by ${-newBalance}`);
  }

  const result = db
    .prepare(
      `INSERT INTO stock_ledger
        (item_id, change_qty, balance_qty, value_paisa, entry_type, source_doc, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(itemId, changeQty, newBalance, valuePaisa, entryType, sourceDoc, userId);

  return { id: Number(result.lastInsertRowid), balance: newBalance };
}

// All movements of an item between two dates (the "stock ledger" report).
export function getLedger(itemId, fromDate = '0000-01-01', toDate = '9999-12-31') {
  return db
    .prepare(
      `SELECT * FROM stock_ledger
       WHERE item_id = ? AND date(date) BETWEEN ? AND ?
       ORDER BY id`
    )
    .all(itemId, fromDate, toDate);
}
