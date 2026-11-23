import { Router } from 'express';
import db, { runInTransaction } from '../db/connection.js';
import { requireLogin } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import { getBalance } from '../services/stockLedger.js';
import { logAudit } from '../services/audit.js';
import { rupeesToPaisa } from '../utils/money.js';

const router = Router();
router.use(requireLogin);

// ---------- helpers ----------
const orderTotal = (orderId) =>
  db.prepare('SELECT COALESCE(SUM(qty * price_paisa), 0) AS t FROM order_lines WHERE order_id = ?').get(orderId).t;

// Turn the lines sent by the app into clean rows. Price defaults to the master price list.
function cleanLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Add at least one product');
  const seen = new Set();
  return lines.map((l) => {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(l.itemId));
    if (!item) throw new Error('Product not found: ' + l.itemId);
    if (item.category !== 'FG') throw new Error(`${item.name} is not a sellable product`);
    if (seen.has(item.id)) throw new Error(`${item.name} is added twice`);
    seen.add(item.id);
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new Error(`Quantity for ${item.name} must be a whole number, 1 or more`);
    const price = l.priceRupees !== undefined ? rupeesToPaisa(Number(l.priceRupees)) : item.price_paisa;
    if (!(price > 0)) throw new Error(`${item.name} has no price`);
    return { itemId: item.id, qty: l.qty, price };
  });
}

// Does finished-goods stock cover this order?
// available = stock in warehouse - packets already promised to other approved/invoiced orders
function stockCheck(orderId) {
  const lines = db.prepare(
    `SELECT ol.item_id, ol.qty, i.name FROM order_lines ol JOIN items i ON i.id = ol.item_id WHERE ol.order_id = ?`
  ).all(orderId);

  const result = lines.map((l) => {
    const balance = getBalance(l.item_id);
    const committed = db.prepare(
      `SELECT COALESCE(SUM(ol.qty), 0) AS q FROM order_lines ol JOIN orders o ON o.id = ol.order_id
       WHERE ol.item_id = ? AND o.status IN ('APPROVED', 'INVOICED') AND o.id != ?`
    ).get(l.item_id, orderId).q;
    const available = balance - committed;
    return {
      itemId: l.item_id, name: l.name, ordered: l.qty,
      inStock: balance, promisedToOthers: committed, available,
      shortage: Math.max(0, l.qty - available)
    };
  });
  return { ok: result.every((r) => r.shortage === 0), lines: result };
}

function getOrderOr404(req, res) {
  const order = db.prepare(
    `SELECT o.*, c.name AS customer, c.state AS customer_state, u.name AS salesman
     FROM orders o JOIN customers c ON c.id = o.customer_id JOIN users u ON u.id = o.salesman_id WHERE o.id = ?`
  ).get(Number(req.params.id));
  // a salesman may only open his OWN orders
  if (!order || (req.user.role === 'SALESMAN' && order.salesman_id !== req.user.id)) {
    res.status(404).json({ error: 'Order not found' });
    return null;
  }
  return order;
}

// ---------- 1. Salesman places an order ----------
// body: { customerId, lines: [{ itemId, qty }], clientUuid? }
// clientUuid lets the phone resend the same order after being offline without creating a duplicate.
router.post('/', allowRoles('SALESMAN'), (req, res) => {
  try {
    const { customerId, lines, clientUuid } = req.body || {};
    if (clientUuid) {
      const existing = db.prepare('SELECT id FROM orders WHERE client_uuid = ?').get(String(clientUuid));
      if (existing) return res.json({ orderId: existing.id, duplicate: true });
    }
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(customerId));
    if (!customer) throw new Error('Select a customer');
    const clean = cleanLines(lines);

    const orderId = runInTransaction(() => {
      const id = Number(
        db.prepare('INSERT INTO orders (customer_id, salesman_id, client_uuid) VALUES (?, ?, ?)')
          .run(customer.id, req.user.id, clientUuid ? String(clientUuid) : null).lastInsertRowid
      );
      for (const l of clean) {
        db.prepare('INSERT INTO order_lines (order_id, item_id, qty, price_paisa) VALUES (?, ?, ?, ?)')
          .run(id, l.itemId, l.qty, l.price);
      }
      logAudit({ userId: req.user.id, action: 'ORDER_SUBMITTED', tableName: 'orders', recordId: id });
      return id;
    });
    res.status(201).json({ orderId, status: 'SUBMITTED', total_paisa: orderTotal(orderId) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 2. List orders (salesman: only his own) ----------
router.get('/', allowRoles('SALESMAN', 'ADMIN', 'OWNER', 'ACCOUNTANT'), (req, res) => {
  const where = [];
  const params = [];
  if (req.user.role === 'SALESMAN') { where.push('o.salesman_id = ?'); params.push(req.user.id); }
  if (req.query.status) { where.push('o.status = ?'); params.push(String(req.query.status)); }

  const rows = db.prepare(
    `SELECT o.id, o.status, o.created_at, c.name AS customer, c.state, u.name AS salesman,
            (SELECT COALESCE(SUM(qty * price_paisa), 0) FROM order_lines WHERE order_id = o.id) AS total_paisa
     FROM orders o JOIN customers c ON c.id = o.customer_id JOIN users u ON u.id = o.salesman_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY o.id DESC`
  ).all(...params);
  res.json(rows);
});

// ---------- 3. One order (admin also gets the stock check) ----------
router.get('/:id', allowRoles('SALESMAN', 'ADMIN', 'OWNER', 'ACCOUNTANT'), (req, res) => {
  const order = getOrderOr404(req, res);
  if (!order) return;
  const lines = db.prepare(
    `SELECT ol.item_id, i.name, ol.qty, ol.price_paisa, ol.qty * ol.price_paisa AS line_total_paisa
     FROM order_lines ol JOIN items i ON i.id = ol.item_id WHERE ol.order_id = ?`
  ).all(order.id);
  const body = { ...order, lines, total_paisa: orderTotal(order.id) };
  if (req.user.role !== 'SALESMAN') body.stockCheck = stockCheck(order.id);
  res.json(body);
});

// ---------- 4. Admin edits quantities / prices (only before approval) ----------
// body: { lines: [{ itemId, qty, priceRupees? }] }
router.put('/:id', allowRoles('ADMIN'), (req, res) => {
  try {
    const order = getOrderOr404(req, res);
    if (!order) return;
    if (order.status !== 'SUBMITTED') throw new Error('Only a SUBMITTED order can be edited');
    const clean = cleanLines((req.body || {}).lines);

    const oldLines = db.prepare('SELECT item_id, qty, price_paisa FROM order_lines WHERE order_id = ?').all(order.id);
    runInTransaction(() => {
      db.prepare('DELETE FROM order_lines WHERE order_id = ?').run(order.id); // fine: order is not a posted document yet
      for (const l of clean) {
        db.prepare('INSERT INTO order_lines (order_id, item_id, qty, price_paisa) VALUES (?, ?, ?, ?)')
          .run(order.id, l.itemId, l.qty, l.price);
      }
      logAudit({
        userId: req.user.id, action: 'ORDER_EDITED', tableName: 'orders', recordId: order.id,
        oldValue: oldLines, newValue: clean.map((l) => ({ item_id: l.itemId, qty: l.qty, price_paisa: l.price }))
      });
    });
    res.json({ orderId: order.id, total_paisa: orderTotal(order.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 5. Admin approves (stock check first) ----------
// body: { force?: true }  -> approve even though stock is short (logged)
router.post('/:id/approve', allowRoles('ADMIN'), (req, res) => {
  try {
    const order = getOrderOr404(req, res);
    if (!order) return;
    if (order.status !== 'SUBMITTED') throw new Error('Only a SUBMITTED order can be approved');

    const check = stockCheck(order.id);
    const force = (req.body || {}).force === true;
    if (!check.ok && !force) {
      return res.status(409).json({
        error: 'Not enough finished-goods stock. Reduce the quantity, or approve with force=true.',
        stockCheck: check
      });
    }

    db.prepare("UPDATE orders SET status = 'APPROVED' WHERE id = ?").run(order.id);
    logAudit({
      userId: req.user.id, action: 'ORDER_APPROVED', tableName: 'orders', recordId: order.id,
      newValue: { forced: force && !check.ok, shortages: check.lines.filter((l) => l.shortage > 0) }
    });
    res.json({ orderId: order.id, status: 'APPROVED', stockCheck: check });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 6. Admin rejects ----------
// body: { reason }
router.post('/:id/reject', allowRoles('ADMIN'), (req, res) => {
  try {
    const order = getOrderOr404(req, res);
    if (!order) return;
    if (order.status !== 'SUBMITTED') throw new Error('Only a SUBMITTED order can be rejected');
    const reason = String((req.body || {}).reason || '').trim();
    if (!reason) throw new Error('Please give a reason');

    db.prepare("UPDATE orders SET status = 'CANCELLED' WHERE id = ?").run(order.id);
    logAudit({ userId: req.user.id, action: 'ORDER_REJECTED', tableName: 'orders', recordId: order.id, newValue: { reason } });
    res.json({ orderId: order.id, status: 'CANCELLED' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;