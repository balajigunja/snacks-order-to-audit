import { Router } from 'express';
import db, { runInTransaction } from '../db/connection.js';
import { requireLogin } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import { calculateGst } from '../utils/gst.js';
import { todayIST } from '../utils/dates.js';
import { nextInvoiceNo } from '../services/invoiceNumber.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(requireLogin);
const FACTORY_STATE = process.env.FACTORY_STATE || 'Tamil Nadu';

// POST /api/invoices   body: { orderId }   -> turns an APPROVED order into a GST tax invoice
router.post('/', allowRoles('ADMIN'), (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number((req.body || {}).orderId));
    if (!order) throw new Error('Order not found');
    if (order.status !== 'APPROVED') throw new Error('Only an APPROVED order can be invoiced');
    if (db.prepare("SELECT id FROM invoices WHERE order_id = ? AND status = 'POSTED'").get(order.id)) {
      throw new Error('This order already has an invoice');
    }
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
    const lines = db.prepare(
      `SELECT ol.item_id, ol.qty, ol.price_paisa, i.name, i.hsn_code, i.gst_rate_bp
       FROM order_lines ol JOIN items i ON i.id = ol.item_id WHERE ol.order_id = ?`
    ).all(order.id);

    const result = runInTransaction(() => {
      const date = todayIST();
      const invoiceNo = nextInvoiceNo(date);

      // tax for every line: same state -> CGST + SGST, other state -> IGST
      let taxable = 0, cgst = 0, sgst = 0, igst = 0;
      const rows = lines.map((l) => {
        const lineTaxable = l.qty * l.price_paisa;
        const g = calculateGst(lineTaxable, l.gst_rate_bp, customer.state, FACTORY_STATE);
        taxable += lineTaxable; cgst += g.cgst; sgst += g.sgst; igst += g.igst;
        return { ...l, lineTaxable, g };
      });
      const total = taxable + cgst + sgst + igst;

      const invoiceId = Number(
        db.prepare(
          `INSERT INTO invoices (invoice_no, order_id, date, customer_id, customer_name, customer_gstin,
             place_of_supply, taxable_paisa, cgst_paisa, sgst_paisa, igst_paisa, total_paisa, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(invoiceNo, order.id, date, customer.id, customer.name, customer.gstin, customer.state,
              taxable, cgst, sgst, igst, total, req.user.id).lastInsertRowid
      );
      for (const r of rows) {
        db.prepare(
          `INSERT INTO invoice_lines (invoice_id, item_id, item_name, hsn_code, qty, price_paisa,
             taxable_paisa, gst_rate_bp, cgst_paisa, sgst_paisa, igst_paisa)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(invoiceId, r.item_id, r.name, r.hsn_code, r.qty, r.price_paisa,
              r.lineTaxable, r.gst_rate_bp, r.g.cgst, r.g.sgst, r.g.igst);
      }

      db.prepare("UPDATE orders SET status = 'INVOICED' WHERE id = ?").run(order.id);
      logAudit({ userId: req.user.id, action: 'INVOICE_CREATED', tableName: 'invoices', recordId: invoiceId,
                 newValue: { invoiceNo, total } });
      return { invoiceId, invoiceNo, date, place_of_supply: customer.state,
               taxable_paisa: taxable, cgst_paisa: cgst, sgst_paisa: sgst, igst_paisa: igst, total_paisa: total };
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/invoices -> list, with how much is paid and still owed
router.get('/', allowRoles('ADMIN', 'ACCOUNTANT', 'OWNER'), (req, res) => {
  const rows = db.prepare(
    `SELECT v.id, v.invoice_no, v.date, v.customer_name, v.total_paisa, v.status, v.dispatched,
            COALESCE((SELECT SUM(amount_paisa) FROM payments WHERE invoice_id = v.id), 0) AS paid_paisa
     FROM invoices v ORDER BY v.id DESC`
  ).all();
  res.json(rows.map((r) => ({ ...r, outstanding_paisa: r.total_paisa - r.paid_paisa })));
});

// GET /api/invoices/:id -> full invoice with lines
router.get('/:id', allowRoles('ADMIN', 'ACCOUNTANT', 'OWNER'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(req.params.id));
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?').all(inv.id);
  const paid = db.prepare('SELECT COALESCE(SUM(amount_paisa), 0) AS p FROM payments WHERE invoice_id = ?').get(inv.id).p;
  res.json({ ...inv, lines, paid_paisa: paid, outstanding_paisa: inv.total_paisa - paid });
});

export default router;
