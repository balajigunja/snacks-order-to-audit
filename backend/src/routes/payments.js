import { Router } from 'express';
import db, { runInTransaction } from '../db/connection.js';
import { requireLogin } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import { logAudit } from '../services/audit.js';
import { rupeesToPaisa } from '../utils/money.js';
import { todayIST } from '../utils/dates.js';

const router = Router();
router.use(requireLogin);
const MODES = ['CASH', 'UPI', 'BANK'];

// POST /api/payments   body: { invoiceId, amountRupees, mode, date? }
// A customer can pay in parts: every payment is a new row, and outstanding = invoice total - sum of payments.
router.post('/', allowRoles('ADMIN'), (req, res) => {
  try {
    const { invoiceId, amountRupees, mode = 'CASH', date } = req.body || {};
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(invoiceId));
    if (!inv) throw new Error('Invoice not found');
    if (inv.status !== 'POSTED') throw new Error('Cannot record a payment on a cancelled invoice');
    if (!MODES.includes(mode)) throw new Error('mode must be CASH, UPI or BANK');
    if (!(Number(amountRupees) > 0)) throw new Error('Amount must be more than 0');

    const amount = rupeesToPaisa(Number(amountRupees));
    const paidBefore = db.prepare('SELECT COALESCE(SUM(amount_paisa), 0) AS p FROM payments WHERE invoice_id = ?').get(inv.id).p;
    const owed = inv.total_paisa - paidBefore;
    if (amount > owed) throw new Error(`Payment is more than the outstanding amount (${owed} paisa)`);

    const result = runInTransaction(() => {
      const id = Number(
        db.prepare('INSERT INTO payments (invoice_id, date, amount_paisa, mode) VALUES (?, ?, ?, ?)')
          .run(inv.id, date || todayIST(), amount, mode).lastInsertRowid
      );
      logAudit({ userId: req.user.id, action: 'PAYMENT_RECORDED', tableName: 'payments', recordId: id,
                 newValue: { invoice: inv.invoice_no, amount, mode } });
      return id;
    });
    res.status(201).json({
      paymentId: result, invoiceNo: inv.invoice_no, amount_paisa: amount,
      paid_paisa: paidBefore + amount, outstanding_paisa: owed - amount
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/payments -> collections list
router.get('/', allowRoles('ADMIN', 'ACCOUNTANT', 'OWNER'), (req, res) => {
  res.json(db.prepare(
    `SELECT p.id, p.date, p.amount_paisa, p.mode, v.invoice_no, v.customer_name
     FROM payments p JOIN invoices v ON v.id = p.invoice_id ORDER BY p.id DESC`
  ).all());
});

export default router;
