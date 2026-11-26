import { Router } from 'express';
import jwt from 'jsonwebtoken';
import db, { runInTransaction } from '../db/connection.js';
import { requireLogin, JWT_SECRET } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import { calculateGst } from '../utils/gst.js';
import { todayIST } from '../utils/dates.js';
import { nextInvoiceNo } from '../services/invoiceNumber.js';
import { buildInvoicePdf, invoiceFileName } from '../services/invoicePdf.js';
import { addEntry } from '../services/stockLedger.js';
import { logAudit } from '../services/audit.js';

const router = Router();
const FACTORY_STATE = process.env.FACTORY_STATE || 'Tamil Nadu';

function sendPdf(res, pdf, invoiceNo) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoiceFileName(invoiceNo)}"`);
  res.send(pdf);
}

// ---------- PUBLIC: the customer opens the link from WhatsApp or email (no login) ----------
// The link carries a signed token (valid 30 days). Nobody can guess another invoice's link.
router.get('/share/:token', async (req, res) => {
  try {
    const t = jwt.verify(req.params.token, JWT_SECRET);
    if (t.purpose !== 'invoice-share') throw new Error('wrong kind of token'); // a login token must not work here
    const inv = db.prepare('SELECT invoice_no FROM invoices WHERE id = ?').get(t.invoiceId);
    if (!inv) throw new Error('Invoice not found');
    sendPdf(res, await buildInvoicePdf(t.invoiceId), inv.invoice_no);
  } catch {
    res.status(404).json({ error: 'This link is invalid or has expired' });
  }
});

// everything below needs a login
router.use(requireLogin);

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

// POST /api/invoices/:id/cancel   body: { reason }   -> cancels a posted invoice with a credit note (never deleted)
router.post('/:id/cancel', allowRoles('ADMIN'), (req, res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.status === 'CANCELLED') throw new Error('Invoice is already cancelled');

    const reason = String((req.body || {}).reason || '').trim();
    if (!reason) throw new Error('Please provide a cancellation reason');

    const paid = db.prepare('SELECT COALESCE(SUM(amount_paisa), 0) AS p FROM payments WHERE invoice_id = ?').get(inv.id).p;
    if (paid > 0) throw new Error('Cannot cancel an invoice that has recorded payments');

    const result = runInTransaction(() => {
      const creditNoteId = Number(
        db.prepare('INSERT INTO credit_notes (invoice_id, date, reason, amount_paisa) VALUES (?, ?, ?, ?)')
          .run(inv.id, todayIST(), reason, inv.total_paisa).lastInsertRowid
      );

      if (inv.dispatched === 1) {
        const dispatchedRows = db.prepare(
          `SELECT item_id, change_qty, value_paisa FROM stock_ledger
           WHERE source_doc = ? AND entry_type = 'DISPATCH'`
        ).all(`Invoice ${inv.invoice_no}`);

        for (const row of dispatchedRows) {
          addEntry({
            itemId: row.item_id,
            changeQty: -row.change_qty,
            valuePaisa: -row.value_paisa,
            entryType: 'ADJUSTMENT',
            sourceDoc: `Credit Note #${creditNoteId} (${inv.invoice_no})`,
            userId: req.user.id
          });
        }
      }

      db.prepare("UPDATE invoices SET status = 'CANCELLED' WHERE id = ?").run(inv.id);
      db.prepare("UPDATE orders SET status = 'CANCELLED' WHERE id = ?").run(inv.order_id);

      logAudit({
        userId: req.user.id,
        action: 'INVOICE_CANCELLED',
        tableName: 'invoices',
        recordId: inv.id,
        oldValue: { status: inv.status, dispatched: inv.dispatched },
        newValue: { status: 'CANCELLED', creditNoteId, reason }
      });

      return {
        invoiceId: inv.id,
        invoiceNo: inv.invoice_no,
        status: 'CANCELLED',
        creditNoteId,
        credited_paisa: inv.total_paisa,
        stockRestored: inv.dispatched === 1
      };
    });

    res.json(result);
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

// GET /api/invoices/:id/pdf -> the invoice as a PDF file
router.get('/:id/pdf', allowRoles('ADMIN', 'ACCOUNTANT', 'OWNER'), async (req, res) => {
  const inv = db.prepare('SELECT invoice_no FROM invoices WHERE id = ?').get(Number(req.params.id));
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  sendPdf(res, await buildInvoicePdf(Number(req.params.id)), inv.invoice_no);
});

// GET /api/invoices/:id/share -> links to send the invoice by WhatsApp or email
router.get('/:id/share', allowRoles('ADMIN'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(req.params.id));
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  const token = jwt.sign({ invoiceId: inv.id, purpose: 'invoice-share' }, JWT_SECRET, { expiresIn: '30d' });
  // When the app is online for real, set PUBLIC_URL in .env so the link works for the customer
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const pdfUrl = `${base}/api/invoices/share/${token}`;
  const message =
    `Hello ${inv.customer_name}, your tax invoice ${inv.invoice_no} dated ${inv.date} ` +
    `for Rs. ${(inv.total_paisa / 100).toFixed(2)} is ready. You can download it here: ${pdfUrl}`;

  res.json({
    pdfUrl, message,
    whatsappUrl: 'https://wa.me/?text=' + encodeURIComponent(message),
    emailUrl: `mailto:?subject=${encodeURIComponent('Tax invoice ' + inv.invoice_no)}&body=${encodeURIComponent(message)}`
  });
});

export default router;
