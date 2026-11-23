import { Router } from 'express';
import db from '../db/connection.js';
import { requireLogin } from '../middleware/auth.js';
import { toCsv } from '../services/csv.js';
import { margin } from '../services/costing.js';
import { formatPct } from '../services/variance.js';
import { todayIST } from '../utils/dates.js';

const router = Router();
router.use(requireLogin);
const FACTORY_STATE = process.env.FACTORY_STATE || 'Tamil Nadu';

// ---------- small helpers (display only; the database always holds whole numbers) ----------
const rs = (paisa) => (paisa / 100).toFixed(2);                       // 787500 -> "7875.00"
const sum = (list, field) => list.reduce((t, r) => t + (r[field] || 0), 0);
const UNIT = { g: 'kg', ml: 'L', pcs: 'pcs' };                         // how stock is shown to people
const SHOW = { g: 1000, ml: 1000, pcs: 1 };
const qty = (n, base) => Number((n / SHOW[base]).toFixed(3));          // 120000 g -> 120 (kg)
const LEDGER_DAY = "date(l.date, '+330 minutes')";                     // ledger time is UTC; +5:30 = India date
const CATEGORY = { RAW: 'Raw material', PACKAGING: 'Packaging', FG: 'Finished goods' };

const ACCOUNTS = ['ADMIN', 'ACCOUNTANT', 'OWNER'];
const WITH_FLOOR = [...ACCOUNTS, 'PRODUCTION'];

// ---------- the reports: each one returns { columns, rows } ----------
const REPORTS = {
  // ===== SALES =====
  'sales-register': {
    title: 'Sales register', roles: ACCOUNTS,
    build({ from, to }) {
      const inv = db.prepare(
        'SELECT * FROM invoices WHERE date BETWEEN ? AND ? ORDER BY id'
      ).all(from, to);
      const rows = inv.map((v) => ({
        invoice_no: v.invoice_no, date: v.date, customer: v.customer_name, gstin: v.customer_gstin || '',
        place: v.place_of_supply, taxable: rs(v.taxable_paisa), cgst: rs(v.cgst_paisa),
        sgst: rs(v.sgst_paisa), igst: rs(v.igst_paisa), total: rs(v.total_paisa), status: v.status
      }));
      const posted = inv.filter((v) => v.status === 'POSTED');
      if (inv.length) {
        rows.push({
          invoice_no: 'TOTAL (posted)', taxable: rs(sum(posted, 'taxable_paisa')), cgst: rs(sum(posted, 'cgst_paisa')),
          sgst: rs(sum(posted, 'sgst_paisa')), igst: rs(sum(posted, 'igst_paisa')), total: rs(sum(posted, 'total_paisa'))
        });
      }
      return {
        columns: [
          { key: 'invoice_no', label: 'Invoice no' }, { key: 'date', label: 'Date' }, { key: 'customer', label: 'Customer' },
          { key: 'gstin', label: 'GSTIN' }, { key: 'place', label: 'Place of supply' },
          { key: 'taxable', label: 'Taxable value (Rs)' }, { key: 'cgst', label: 'CGST (Rs)' },
          { key: 'sgst', label: 'SGST (Rs)' }, { key: 'igst', label: 'IGST (Rs)' },
          { key: 'total', label: 'Invoice total (Rs)' }, { key: 'status', label: 'Status' }
        ], rows
      };
    }
  },

  // a salesman sees only the sales of customers he took orders from
  'sales-by-customer': {
    title: 'Customer-wise sales', roles: [...ACCOUNTS, 'SALESMAN'],
    build({ from, to, user }) {
      const mine = user.role === 'SALESMAN';
      const data = db.prepare(
        `SELECT v.customer_name, COUNT(*) AS invoices, SUM(v.taxable_paisa) AS taxable, SUM(v.total_paisa) AS total
         FROM invoices v JOIN orders o ON o.id = v.order_id
         WHERE v.status = 'POSTED' AND v.date BETWEEN ? AND ? ${mine ? 'AND o.salesman_id = ?' : ''}
         GROUP BY v.customer_id ORDER BY total DESC`
      ).all(...(mine ? [from, to, user.id] : [from, to]));
      return {
        columns: [
          { key: 'customer', label: 'Customer' }, { key: 'invoices', label: 'Invoices' },
          { key: 'taxable', label: 'Taxable sales (Rs)' }, { key: 'total', label: 'Total with GST (Rs)' }
        ],
        rows: data.map((r) => ({ customer: r.customer_name, invoices: r.invoices, taxable: rs(r.taxable), total: rs(r.total) }))
      };
    }
  },

  'sales-by-product': {
    title: 'Product-wise sales', roles: ACCOUNTS,
    build({ from, to }) {
      const data = db.prepare(
        `SELECT il.item_name, il.hsn_code, SUM(il.qty) AS qty, SUM(il.taxable_paisa) AS taxable
         FROM invoice_lines il JOIN invoices v ON v.id = il.invoice_id
         WHERE v.status = 'POSTED' AND v.date BETWEEN ? AND ?
         GROUP BY il.item_id ORDER BY taxable DESC`
      ).all(from, to);
      return {
        columns: [
          { key: 'product', label: 'Product' }, { key: 'hsn', label: 'HSN' },
          { key: 'qty', label: 'Packets sold' }, { key: 'taxable', label: 'Taxable sales (Rs)' }
        ],
        rows: data.map((r) => ({ product: r.item_name, hsn: r.hsn_code, qty: r.qty, taxable: rs(r.taxable) }))
      };
    }
  },

  // ===== PURCHASES =====
  'purchase-register': {
    title: 'Purchase register', roles: WITH_FLOOR,
    build({ from, to }) {
      const data = db.prepare(
        `SELECT p.id, p.date, p.supplier, i.name, i.base_unit, pl.qty, pl.total_paisa
         FROM purchases p JOIN purchase_lines pl ON pl.purchase_id = p.id JOIN items i ON i.id = pl.item_id
         WHERE p.date BETWEEN ? AND ? ORDER BY p.id, pl.id`
      ).all(from, to);
      const rows = data.map((r) => ({
        purchase_no: r.id, date: r.date, supplier: r.supplier || '', item: r.name,
        qty: qty(r.qty, r.base_unit), unit: UNIT[r.base_unit],
        rate: rs(Math.round((r.total_paisa * SHOW[r.base_unit]) / r.qty)), amount: rs(r.total_paisa)
      }));
      if (data.length) rows.push({ purchase_no: 'TOTAL', amount: rs(sum(data, 'total_paisa')) });
      return {
        columns: [
          { key: 'purchase_no', label: 'Purchase no' }, { key: 'date', label: 'Date' }, { key: 'supplier', label: 'Supplier' },
          { key: 'item', label: 'Item' }, { key: 'qty', label: 'Quantity' }, { key: 'unit', label: 'Unit' },
          { key: 'rate', label: 'Rate per unit (Rs)' }, { key: 'amount', label: 'Amount (Rs)' }
        ], rows
      };
    }
  },

  // ===== STOCK =====
  // Opening + Receipts - Issues +/- Adjustments = Closing, for every item
  'stock-summary': {
    title: 'Stock summary', roles: WITH_FLOOR,
    build({ from, to, query }) {
      const items = db.prepare(
        `SELECT * FROM items ${query.category ? 'WHERE category = ?' : ''} ORDER BY category, name`
      ).all(...(query.category ? [String(query.category)] : []));
      const one = (sql, ...args) => db.prepare(sql).get(...args).v;
      const rows = items.map((it) => {
        const opening = one(
          `SELECT COALESCE(SUM(change_qty), 0) AS v FROM stock_ledger l WHERE item_id = ?
           AND (${LEDGER_DAY} < ? OR (entry_type = 'OPENING' AND ${LEDGER_DAY} <= ?))`, it.id, from, to);
        const inRange = (types, expr) => one(
          `SELECT COALESCE(SUM(${expr}), 0) AS v FROM stock_ledger l WHERE item_id = ? AND ${LEDGER_DAY} BETWEEN ? AND ?
           AND entry_type IN (${types.map(() => '?').join(',')})`, it.id, from, to, ...types);
        const receipts = inRange(['PURCHASE', 'PRODUCTION_OUTPUT'], 'change_qty');
        const issues = inRange(['PRODUCTION_ISSUE', 'DISPATCH', 'WASTAGE'], '-change_qty');
        const adjustments = inRange(['ADJUSTMENT'], 'change_qty');
        const closing = opening + receipts - issues + adjustments;
        const value = one(`SELECT COALESCE(SUM(value_paisa), 0) AS v FROM stock_ledger l WHERE item_id = ? AND ${LEDGER_DAY} <= ?`, it.id, to);
        return {
          item: it.name, category: CATEGORY[it.category], unit: UNIT[it.base_unit],
          opening: qty(opening, it.base_unit), receipts: qty(receipts, it.base_unit), issues: qty(issues, it.base_unit),
          adjustments: qty(adjustments, it.base_unit), closing: qty(closing, it.base_unit), value: rs(value)
        };
      });
      return {
        columns: [
          { key: 'item', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'unit', label: 'Unit' },
          { key: 'opening', label: 'Opening' }, { key: 'receipts', label: 'Receipts' }, { key: 'issues', label: 'Issues / sales' },
          { key: 'adjustments', label: 'Adjustments' }, { key: 'closing', label: 'Closing' }, { key: 'value', label: 'Closing value (Rs)' }
        ], rows
      };
    }
  },

  'stock-ledger': {
    title: 'Stock ledger', roles: WITH_FLOOR,
    build({ from, to, query }) {
      const where = [`${LEDGER_DAY} BETWEEN ? AND ?`];
      const args = [from, to];
      if (query.item) { where.push('l.item_id = ?'); args.push(Number(query.item)); }
      if (query.category) { where.push('i.category = ?'); args.push(String(query.category)); }
      const data = db.prepare(
        `SELECT datetime(l.date, '+330 minutes') AS at, i.name, i.category, i.base_unit, l.entry_type, l.source_doc,
                l.change_qty, l.balance_qty, l.value_paisa
         FROM stock_ledger l JOIN items i ON i.id = l.item_id WHERE ${where.join(' AND ')} ORDER BY l.id`
      ).all(...args);
      return {
        columns: [
          { key: 'at', label: 'Date and time (IST)' }, { key: 'item', label: 'Item' }, { key: 'category', label: 'Category' },
          { key: 'type', label: 'Movement' }, { key: 'source', label: 'Source document' },
          { key: 'change', label: 'Change' }, { key: 'balance', label: 'Balance' }, { key: 'unit', label: 'Unit' },
          { key: 'value', label: 'Value of movement (Rs)' }
        ],
        rows: data.map((r) => ({
          at: r.at, item: r.name, category: CATEGORY[r.category], type: r.entry_type, source: r.source_doc,
          change: qty(r.change_qty, r.base_unit), balance: qty(r.balance_qty, r.base_unit),
          unit: UNIT[r.base_unit], value: rs(r.value_paisa)
        }))
      };
    }
  },

  // ===== PRODUCTION =====
  'production-variance': {
    title: 'Production: planned vs actual', roles: WITH_FLOOR,
    build({ from, to }) {
      const runs = db.prepare(
        `SELECT r.*, i.name AS product FROM production_runs r JOIN boms b ON b.id = r.bom_id JOIN items i ON i.id = b.fg_item_id
         WHERE r.date BETWEEN ? AND ? ORDER BY r.id`
      ).all(from, to);
      const rows = [];
      for (const r of runs) {
        const lines = db.prepare(
          `SELECT i.name, i.base_unit, pc.standard_qty, pc.actual_qty, pc.variance_pct_x100, pc.flagged
           FROM production_consumption pc JOIN items i ON i.id = pc.item_id WHERE pc.run_id = ? ORDER BY pc.id`
        ).all(r.id);
        for (const l of lines) {
          rows.push({
            run: r.id, date: r.date, product: r.product, what: l.name, unit: UNIT[l.base_unit],
            planned: qty(l.standard_qty, l.base_unit), actual: qty(l.actual_qty, l.base_unit),
            variance: l.variance_pct_x100 === null ? '' : formatPct(l.variance_pct_x100), flagged: l.flagged ? 'YES' : ''
          });
        }
        if (r.status === 'COMPLETED') {
          rows.push({
            run: r.id, date: r.date, product: r.product, what: 'Yield (good packets)', unit: 'packets',
            planned: r.expected_output, actual: r.good_packets, variance: formatPct(r.yield_variance_pct_x100),
            flagged: Math.abs(r.yield_variance_pct_x100) > Number(process.env.VARIANCE_TOLERANCE_PCT || 3) * 100 ? 'YES' : ''
          });
        }
      }
      return {
        columns: [
          { key: 'run', label: 'Run no' }, { key: 'date', label: 'Date' }, { key: 'product', label: 'Product' },
          { key: 'what', label: 'Material / measure' }, { key: 'unit', label: 'Unit' }, { key: 'planned', label: 'Planned' },
          { key: 'actual', label: 'Actual' }, { key: 'variance', label: 'Variance' }, { key: 'flagged', label: 'Flagged' }
        ], rows
      };
    }
  },

  'production-cost': {
    title: 'Cost per packet', roles: WITH_FLOOR,
    build({ from, to }) {
      const runs = db.prepare(
        `SELECT r.*, i.name AS product, i.price_paisa FROM production_runs r JOIN boms b ON b.id = r.bom_id
         JOIN items i ON i.id = b.fg_item_id WHERE r.status = 'COMPLETED' AND r.date BETWEEN ? AND ? ORDER BY r.id`
      ).all(from, to);
      return {
        columns: [
          { key: 'run', label: 'Run no' }, { key: 'date', label: 'Date' }, { key: 'product', label: 'Product' },
          { key: 'good', label: 'Good packets' }, { key: 'material', label: 'Materials (Rs)' }, { key: 'labour', label: 'Labour (Rs)' },
          { key: 'power', label: 'Gas / power (Rs)' }, { key: 'total', label: 'Total cost (Rs)' },
          { key: 'cost', label: 'Cost per packet (Rs)' }, { key: 'price', label: 'Selling price (Rs)' }, { key: 'margin', label: 'Margin' }
        ],
        rows: runs.map((r) => {
          const done = r.cost_per_packet_paisa !== null;
          return {
            run: r.id, date: r.date, product: r.product, good: r.good_packets, material: rs(r.material_cost_paisa),
            labour: rs(r.labour_paisa), power: rs(r.power_gas_paisa),
            total: rs(r.material_cost_paisa + r.labour_paisa + r.power_gas_paisa),
            cost: done ? rs(r.cost_per_packet_paisa) : 'overheads not entered', price: rs(r.price_paisa),
            margin: done ? formatPct(margin(r.price_paisa, r.cost_per_packet_paisa).marginPctX100) : ''
          };
        })
      };
    }
  },

  // ===== MONEY IN =====
  collections: {
    title: 'Payments and collections', roles: ACCOUNTS,
    build({ from, to }) {
      const data = db.prepare(
        `SELECT p.date, v.invoice_no, v.customer_name, p.mode, p.amount_paisa
         FROM payments p JOIN invoices v ON v.id = p.invoice_id WHERE p.date BETWEEN ? AND ? ORDER BY p.id`
      ).all(from, to);
      const rows = data.map((r) => ({ date: r.date, invoice: r.invoice_no, customer: r.customer_name, mode: r.mode, amount: rs(r.amount_paisa) }));
      if (data.length) rows.push({ date: 'TOTAL', amount: rs(sum(data, 'amount_paisa')) });
      return {
        columns: [
          { key: 'date', label: 'Date' }, { key: 'invoice', label: 'Invoice' }, { key: 'customer', label: 'Customer' },
          { key: 'mode', label: 'Mode' }, { key: 'amount', label: 'Amount received (Rs)' }
        ], rows
      };
    }
  },

  // customer-wise receivables, aged from the invoice date up to the "to" date
  outstanding: {
    title: 'Outstanding receivables with ageing', roles: ACCOUNTS,
    build({ to }) {
      const invoices = db.prepare(
        `SELECT v.customer_id, v.customer_name, v.date, v.total_paisa,
                COALESCE((SELECT SUM(amount_paisa) FROM payments WHERE invoice_id = v.id AND date <= ?), 0) AS paid,
                COALESCE((SELECT SUM(amount_paisa) FROM credit_notes WHERE invoice_id = v.id AND date <= ?), 0) AS credited
         FROM invoices v WHERE v.status = 'POSTED' AND v.date <= ? ORDER BY v.customer_name, v.date`
      ).all(to, to, to);

      const byCustomer = new Map();
      for (const v of invoices) {
        const owed = v.total_paisa - v.paid - v.credited;
        if (owed <= 0) continue;
        const days = Math.floor((Date.parse(to) - Date.parse(v.date)) / 86400000);
        const bucket = days <= 30 ? 'b0' : days <= 60 ? 'b31' : days <= 90 ? 'b61' : 'b90';
        const c = byCustomer.get(v.customer_id) || { name: v.customer_name, invoices: 0, b0: 0, b31: 0, b61: 0, b90: 0, total: 0 };
        c.invoices += 1; c[bucket] += owed; c.total += owed;
        byCustomer.set(v.customer_id, c);
      }
      const list = [...byCustomer.values()];
      const rows = list.map((c) => ({
        customer: c.name, invoices: c.invoices, d0_30: rs(c.b0), d31_60: rs(c.b31), d61_90: rs(c.b61), d90: rs(c.b90), total: rs(c.total)
      }));
      if (list.length) {
        rows.push({
          customer: 'TOTAL', invoices: sum(list, 'invoices'), d0_30: rs(sum(list, 'b0')), d31_60: rs(sum(list, 'b31')),
          d61_90: rs(sum(list, 'b61')), d90: rs(sum(list, 'b90')), total: rs(sum(list, 'total'))
        });
      }
      return {
        columns: [
          { key: 'customer', label: 'Customer' }, { key: 'invoices', label: 'Open invoices' },
          { key: 'd0_30', label: '0-30 days (Rs)' }, { key: 'd31_60', label: '31-60 days (Rs)' },
          { key: 'd61_90', label: '61-90 days (Rs)' }, { key: 'd90', label: 'Over 90 days (Rs)' }, { key: 'total', label: 'Total outstanding (Rs)' }
        ], rows
      };
    }
  },

  // ===== GST (shaped like the GST return tables) =====
  gstr1: {
    title: 'GSTR-1: outward supplies by invoice', roles: ACCOUNTS,
    build({ from, to }) {
      const data = db.prepare(
        `SELECT v.customer_gstin, v.customer_name, v.invoice_no, v.date, v.total_paisa, v.place_of_supply, il.gst_rate_bp,
                SUM(il.taxable_paisa) AS taxable, SUM(il.igst_paisa) AS igst, SUM(il.cgst_paisa) AS cgst, SUM(il.sgst_paisa) AS sgst
         FROM invoices v JOIN invoice_lines il ON il.invoice_id = v.id
         WHERE v.status = 'POSTED' AND v.date BETWEEN ? AND ? GROUP BY v.id, il.gst_rate_bp ORDER BY v.id`
      ).all(from, to);
      return {
        columns: [
          { key: 'type', label: 'Type' }, { key: 'gstin', label: 'GSTIN of recipient' }, { key: 'customer', label: 'Receiver name' },
          { key: 'invoice_no', label: 'Invoice number' }, { key: 'date', label: 'Invoice date' }, { key: 'value', label: 'Invoice value (Rs)' },
          { key: 'place', label: 'Place of supply' }, { key: 'rate', label: 'Rate %' }, { key: 'taxable', label: 'Taxable value (Rs)' },
          { key: 'igst', label: 'IGST (Rs)' }, { key: 'cgst', label: 'CGST (Rs)' }, { key: 'sgst', label: 'SGST (Rs)' }
        ],
        rows: data.map((r) => ({
          type: r.customer_gstin ? 'B2B' : 'B2C', gstin: r.customer_gstin || '', customer: r.customer_name, invoice_no: r.invoice_no,
          date: r.date, value: rs(r.total_paisa), place: r.place_of_supply, rate: r.gst_rate_bp / 100,
          taxable: rs(r.taxable), igst: rs(r.igst), cgst: rs(r.cgst), sgst: rs(r.sgst)
        }))
      };
    }
  },

  'gstr1-hsn': {
    title: 'GSTR-1: HSN-wise summary', roles: ACCOUNTS,
    build({ from, to }) {
      const data = db.prepare(
        `SELECT il.hsn_code, il.item_name, il.gst_rate_bp, SUM(il.qty) AS qty, SUM(il.taxable_paisa) AS taxable,
                SUM(il.igst_paisa) AS igst, SUM(il.cgst_paisa) AS cgst, SUM(il.sgst_paisa) AS sgst
         FROM invoice_lines il JOIN invoices v ON v.id = il.invoice_id
         WHERE v.status = 'POSTED' AND v.date BETWEEN ? AND ?
         GROUP BY il.hsn_code, il.item_name, il.gst_rate_bp ORDER BY il.hsn_code`
      ).all(from, to);
      return {
        columns: [
          { key: 'hsn', label: 'HSN' }, { key: 'desc', label: 'Description' }, { key: 'uqc', label: 'UQC' }, { key: 'qty', label: 'Total quantity' },
          { key: 'rate', label: 'Rate %' }, { key: 'taxable', label: 'Taxable value (Rs)' },
          { key: 'igst', label: 'IGST (Rs)' }, { key: 'cgst', label: 'CGST (Rs)' }, { key: 'sgst', label: 'SGST (Rs)' }
        ],
        rows: data.map((r) => ({
          hsn: r.hsn_code, desc: r.item_name, uqc: 'PCS', qty: r.qty, rate: r.gst_rate_bp / 100,
          taxable: rs(r.taxable), igst: rs(r.igst), cgst: rs(r.cgst), sgst: rs(r.sgst)
        }))
      };
    }
  },

  gstr3b: {
    title: 'GSTR-3B: outward taxable supplies (table 3.1)', roles: ACCOUNTS,
    build({ from, to }) {
      const totals = (sameState) => db.prepare(
        `SELECT COALESCE(SUM(taxable_paisa), 0) AS taxable, COALESCE(SUM(igst_paisa), 0) AS igst,
                COALESCE(SUM(cgst_paisa), 0) AS cgst, COALESCE(SUM(sgst_paisa), 0) AS sgst
         FROM invoices WHERE status = 'POSTED' AND date BETWEEN ? AND ? AND place_of_supply ${sameState ? '=' : '!='} ?`
      ).get(from, to, FACTORY_STATE);
      const intra = totals(true);
      const inter = totals(false);
      const line = (nature, t) => ({ nature, taxable: rs(t.taxable), igst: rs(t.igst), cgst: rs(t.cgst), sgst: rs(t.sgst) });
      const all = {
        taxable: intra.taxable + inter.taxable, igst: intra.igst + inter.igst,
        cgst: intra.cgst + inter.cgst, sgst: intra.sgst + inter.sgst
      };
      return {
        columns: [
          { key: 'nature', label: 'Nature of supplies' }, { key: 'taxable', label: 'Taxable value (Rs)' },
          { key: 'igst', label: 'IGST (Rs)' }, { key: 'cgst', label: 'CGST (Rs)' }, { key: 'sgst', label: 'SGST (Rs)' }
        ],
        rows: [
          line(`Within ${FACTORY_STATE} (CGST + SGST)`, intra),
          line('To other states (IGST)', inter),
          line('Total outward taxable supplies', all)
        ]
      };
    }
  }
};

// ---------- date range: defaults to this month, up to today ----------
function dateRange(query) {
  const today = todayIST();
  const from = String(query.from || today.slice(0, 8) + '01');
  const to = String(query.to || today);
  const ok = /^\d{4}-\d{2}-\d{2}$/;
  if (!ok.test(from) || !ok.test(to)) throw new Error('from and to must look like 2026-11-01');
  if (from > to) throw new Error('"from" must not be after "to"');
  return { from, to };
}

// GET /api/reports -> the reports this role may open
router.get('/', (req, res) => {
  res.json(
    Object.entries(REPORTS)
      .filter(([, r]) => r.roles.includes(req.user.role))
      .map(([name, r]) => ({ name, title: r.title }))
  );
});

// GET /api/reports/:name?from=2026-11-01&to=2026-11-30&format=csv
router.get('/:name', (req, res) => {
  const report = REPORTS[req.params.name];
  if (!report) return res.status(404).json({ error: 'Unknown report' });
  if (!report.roles.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed for your role' });
  try {
    const { from, to } = dateRange(req.query);
    const { columns, rows } = report.build({ from, to, user: req.user, query: req.query });
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}_${from}_${to}.csv"`);
      return res.send('\uFEFF' + toCsv(columns, rows)); // BOM so Excel reads it as UTF-8
    }
    res.json({ name: req.params.name, title: report.title, from, to, columns, rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
