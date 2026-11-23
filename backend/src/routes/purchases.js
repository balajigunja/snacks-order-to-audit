import { Router } from 'express';
import db, { runInTransaction } from '../db/connection.js';
import { requireLogin } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import { addEntry } from '../services/stockLedger.js';
import { toBase, baseUnitOf } from '../utils/units.js';
import { rupeesToPaisa } from '../utils/money.js';

const router = Router();
router.use(requireLogin);


router.post('/', allowRoles('PRODUCTION', 'ADMIN'), (req, res) => {
  try {
    const { date, supplier, lines } = req.body || {};
    if (!Array.isArray(lines) || lines.length === 0) throw new Error('Add at least one line');
    const purchaseDate = date || new Date().toISOString().slice(0, 10);

    // One transaction: the purchase and ALL its stock entries succeed together, or none do.
    const result = runInTransaction(() => {
      const purchaseId = Number(
        db.prepare('INSERT INTO purchases (date, supplier, created_by) VALUES (?, ?, ?)')
          .run(purchaseDate, supplier || null, req.user.id).lastInsertRowid
      );

      const done = [];
      for (const line of lines) {
        const item = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(line.itemId));
        if (!item) throw new Error('Item not found: ' + line.itemId);
        if (item.category === 'FG') throw new Error('Finished goods are produced, not purchased');
        if (baseUnitOf(line.unit) !== item.base_unit) {
          throw new Error(`${item.name} is counted in ${item.base_unit}, but you sent "${line.unit}"`);
        }
        if (!(line.qty > 0) || !(line.rate > 0)) throw new Error('qty and rate must be more than 0');

        const qtyBase = toBase(line.qty, line.unit);                       // 60 kg -> 60000 g
        const totalPaisa = Math.round(line.qty * rupeesToPaisa(line.rate)); // 60 * 4500 = 270000

        db.prepare(
          'INSERT INTO purchase_lines (purchase_id, item_id, qty, total_paisa) VALUES (?, ?, ?, ?)'
        ).run(purchaseId, item.id, qtyBase, totalPaisa);

        // Raw stock goes UP. The value is stored so costing can average it later.
        const entry = addEntry({
          itemId: item.id,
          changeQty: qtyBase,
          valuePaisa: totalPaisa,
          entryType: 'PURCHASE',
          sourceDoc: `Purchase #${purchaseId}`,
          userId: req.user.id
        });
        done.push({ item: item.name, added: qtyBase, balance: entry.balance, total_paisa: totalPaisa });
      }
      return { purchaseId, lines: done };
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/purchases -> purchase register (one row per line)
router.get('/', allowRoles('PRODUCTION', 'ADMIN', 'ACCOUNTANT', 'OWNER'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id AS purchase_id, p.date, p.supplier, i.name AS item,
              pl.qty, i.base_unit, pl.total_paisa
       FROM purchases p
       JOIN purchase_lines pl ON pl.purchase_id = p.id
       JOIN items i ON i.id = pl.item_id
       ORDER BY p.id DESC`
    )
    .all();
  res.json(rows);
});

export default router;