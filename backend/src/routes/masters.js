import { Router } from 'express';
import db from '../db/connection.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();
router.use(requireLogin);

// GET /api/masters/stock -> current balance of every item (base units)
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

// GET /api/masters/customers -> for the salesman's "select customer" dropdown
router.get('/customers', (req, res) => {
  res.json(db.prepare('SELECT id, name, gstin, state FROM customers ORDER BY name').all());
});

// GET /api/masters/products -> sellable products with price (the master price list)
router.get('/products', (req, res) => {
  res.json(
    db.prepare(
      "SELECT id, name, price_paisa, gst_rate_bp, hsn_code FROM items WHERE category = 'FG' ORDER BY name"
    ).all()
  );
});

// GET /api/masters/boms -> recipes (Bill of Materials) with their lines, quantities in base units (g, ml, pcs)
router.get('/boms', (req, res) => {
  const boms = db.prepare(
    `SELECT b.id, b.fg_item_id, i.name AS product, b.batch_output_qty
     FROM boms b JOIN items i ON i.id = b.fg_item_id ORDER BY b.id`
  ).all();
  const lines = db.prepare(
    `SELECT bl.item_id, bl.qty, i.name, i.category, i.base_unit
     FROM bom_lines bl JOIN items i ON i.id = bl.item_id WHERE bl.bom_id = ? ORDER BY bl.id`
  );
  res.json(boms.map((b) => ({ ...b, lines: lines.all(b.id) })));
});

export default router;
