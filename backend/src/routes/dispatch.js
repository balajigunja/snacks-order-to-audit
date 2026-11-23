import { Router } from 'express';
import db, { runInTransaction } from '../db/connection.js';
import { requireLogin } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import { addEntry } from '../services/stockLedger.js';
import { issueValue } from '../services/costing.js';
import { logAudit } from '../services/audit.js';
import { todayIST } from '../utils/dates.js';

const router = Router();
router.use(requireLogin);

// POST /api/dispatch   body: { invoiceId }   -> boxes leave the factory, finished-goods stock goes DOWN
router.post('/', allowRoles('ADMIN'), (req, res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number((req.body || {}).invoiceId));
    if (!inv) throw new Error('Invoice not found');
    if (inv.status !== 'POSTED') throw new Error('Cancelled invoices cannot be dispatched');
    if (inv.dispatched) throw new Error('Already dispatched');
    const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?').all(inv.id);

    const result = runInTransaction(() => {
      const after = [];
      for (const l of lines) {
        const value = issueValue(l.item_id, l.qty); // cost of the goods leaving (weighted average)
        const entry = addEntry({
          itemId: l.item_id, changeQty: -l.qty, valuePaisa: -value,
          entryType: 'DISPATCH', sourceDoc: `Invoice ${inv.invoice_no}`, userId: req.user.id
        });
        after.push({ item: l.item_name, dispatched: l.qty, stockLeft: entry.balance });
      }
      db.prepare('UPDATE invoices SET dispatched = 1, dispatched_at = ? WHERE id = ?').run(todayIST(), inv.id);
      db.prepare("UPDATE orders SET status = 'DISPATCHED' WHERE id = ?").run(inv.order_id);
      logAudit({ userId: req.user.id, action: 'DISPATCHED', tableName: 'invoices', recordId: inv.id });
      return { invoiceNo: inv.invoice_no, items: after };
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;