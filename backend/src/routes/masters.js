import { Router } from 'express';
import db from '../db/connection.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();
router.use(requireLogin);


router.get('/stock', (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.id, i.name, i.category, i.base_unit,
              COALESCE((SELECT balance_qty FROM stock_ledger
                        WHERE item_id = i.id ORDER BY id DESC LIMIT 1), 0) AS balance_qty
       FROM items i
       ORDER BY i.category, i.name`
    )
    .all();
  res.json(rows);
});

export default router;