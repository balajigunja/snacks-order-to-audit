import { Router } from 'express';
import db, { runInTransaction } from '../db/connection.js';
import { requireLogin } from '../middleware/auth.js';
import { allowRoles } from '../middleware/roles.js';
import { addEntry } from '../services/stockLedger.js';
import { issueValue, costPerPacket, margin } from '../services/costing.js';
import { variancePctX100, isFlagged } from '../services/variance.js';
import { logAudit } from '../services/audit.js';
import { toBase, baseUnitOf } from '../utils/units.js';
import { rupeesToPaisa } from '../utils/money.js';
import { todayIST } from '../utils/dates.js';

const router = Router();
router.use(requireLogin);
const MAKERS = ['PRODUCTION', 'ADMIN'];
const today = todayIST;

// ---------- small helpers ----------
const getBomLines = (bomId) =>
  db.prepare(
    `SELECT bl.item_id, bl.qty, i.name, i.category, i.base_unit
     FROM bom_lines bl JOIN items i ON i.id = bl.item_id WHERE bl.bom_id = ?`
  ).all(bomId);

// "10.5 litre" -> 10500 ml, and make sure the unit fits the item (no flour in litres).
function toBaseChecked(row, line) {
  if (baseUnitOf(row.unit) !== line.base_unit) {
    throw new Error(`${line.name} is counted in ${line.base_unit}, but you sent "${row.unit}"`);
  }
  if (!(row.qty > 0)) throw new Error('Quantity must be more than 0');
  return toBase(row.qty, row.unit);
}

// Take stock OUT for this run, valued at the current weighted average cost.
function issueStock(itemId, qtyBase, runId, userId) {
  const value = issueValue(itemId, qtyBase); // must be read BEFORE the ledger row is added
  addEntry({
    itemId, changeQty: -qtyBase, valuePaisa: -value,
    entryType: 'PRODUCTION_ISSUE', sourceDoc: `Production Run #${runId}`, userId
  });
}

// Save the ACTUAL quantity for one recipe line and work out its variance.
function setActual(runId, itemId, actualQty) {
  const row = db.prepare('SELECT * FROM production_consumption WHERE run_id = ? AND item_id = ?').get(runId, itemId);
  const pct = variancePctX100(actualQty, row.standard_qty);
  db.prepare(
    'UPDATE production_consumption SET actual_qty = ?, variance_pct_x100 = ?, flagged = ? WHERE id = ?'
  ).run(actualQty, pct, isFlagged(pct) ? 1 : 0, row.id);
}

// All alerts of a run: every flagged recipe line + yield.
function getFlags(runId) {
  const run = db.prepare('SELECT * FROM production_runs WHERE id = ?').get(runId);
  const flags = db.prepare(
    `SELECT i.name AS what, pc.variance_pct_x100 AS pct_x100
     FROM production_consumption pc JOIN items i ON i.id = pc.item_id
     WHERE pc.run_id = ? AND pc.flagged = 1`
  ).all(runId);
  if (run.yield_variance_pct_x100 !== null && isFlagged(run.yield_variance_pct_x100)) {
    flags.push({ what: 'Yield', pct_x100: run.yield_variance_pct_x100 });
  }
  return flags;
}

// ---------- 1. START a run: issue raw materials ----------
// body: { bomId, batches?, issued: [{ itemId, qty, unit }] }
router.post('/start', allowRoles(...MAKERS), (req, res) => {
  try {
    const { bomId, batches = 1, issued } = req.body || {};
    const bom = db.prepare('SELECT * FROM boms WHERE id = ?').get(Number(bomId));
    if (!bom) throw new Error('Recipe (BOM) not found');
    if (!Number.isInteger(batches) || batches < 1) throw new Error('batches must be a whole number, 1 or more');
    if (!Array.isArray(issued) || issued.length === 0) throw new Error('Issue at least one raw material');
    const lines = getBomLines(bom.id);

    const result = runInTransaction(() => {
      const runId = Number(
        db.prepare('INSERT INTO production_runs (date, bom_id, expected_output, created_by) VALUES (?, ?, ?, ?)')
          .run(today(), bom.id, bom.batch_output_qty * batches, req.user.id).lastInsertRowid
      );

      // one row per recipe line: standard = recipe x batches, actual = filled in as we go
      for (const l of lines) {
        db.prepare('INSERT INTO production_consumption (run_id, item_id, standard_qty, actual_qty) VALUES (?, ?, ?, 0)')
          .run(runId, l.item_id, l.qty * batches);
      }

      for (const row of issued) {
        const line = lines.find((l) => l.item_id === Number(row.itemId));
        if (!line) throw new Error('That item is not in this recipe');
        const qtyBase = toBaseChecked(row, line);
        issueStock(line.item_id, qtyBase, runId, req.user.id);
        setActual(runId, line.item_id, qtyBase);
      }

      logAudit({ userId: req.user.id, action: 'PRODUCTION_STARTED', tableName: 'production_runs', recordId: runId });
      return { runId, expected_output: bom.batch_output_qty * batches, flags: getFlags(runId) };
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 2. COMPLETE a run: packaging used, good packets made ----------
// body: { goodPackets, damagedPouches?, packaging: [{ itemId, qty, unit }] }
// packaging = ACTUAL pouches and cartons used (pouches = good + damaged)
router.post('/:id/complete', allowRoles(...MAKERS), (req, res) => {
  try {
    const runId = Number(req.params.id);
    const run = db.prepare('SELECT * FROM production_runs WHERE id = ?').get(runId);
    if (!run) throw new Error('Run not found');
    if (run.status !== 'STARTED') throw new Error('This run is already completed');

    const { goodPackets, damagedPouches = 0, packaging = [] } = req.body || {};
    if (!Number.isInteger(goodPackets) || goodPackets < 0) throw new Error('goodPackets must be a whole number');
    const bom = db.prepare('SELECT * FROM boms WHERE id = ?').get(run.bom_id);
    const lines = getBomLines(run.bom_id);

    const result = runInTransaction(() => {
      // packaging goes OUT (pouches, cartons)
      for (const row of packaging) {
        const line = lines.find((l) => l.item_id === Number(row.itemId));
        if (!line) throw new Error('That item is not in this recipe');
        const qtyBase = toBaseChecked(row, line);
        issueStock(line.item_id, qtyBase, runId, req.user.id);
        setActual(runId, line.item_id, qtyBase);
      }
      // recipe lines never issued at all -> actual 0 (shows as -100%)
      db.prepare('SELECT * FROM production_consumption WHERE run_id = ? AND variance_pct_x100 IS NULL').all(runId)
        .forEach((r) => setActual(runId, r.item_id, 0));

      // material cost of this run = value of everything issued to it
      const material = db.prepare(
        `SELECT COALESCE(-SUM(value_paisa), 0) AS v FROM stock_ledger
         WHERE source_doc = ? AND entry_type = 'PRODUCTION_ISSUE'`
      ).get(`Production Run #${runId}`).v;

      // finished goods go UP
      if (goodPackets > 0) {
        addEntry({
          itemId: bom.fg_item_id, changeQty: goodPackets, valuePaisa: material,
          entryType: 'PRODUCTION_OUTPUT', sourceDoc: `Production Run #${runId}`, userId: req.user.id
        });
      }

      const yieldPct = variancePctX100(goodPackets, run.expected_output);
      db.prepare(
        `UPDATE production_runs SET good_packets = ?, damaged_pouches = ?, material_cost_paisa = ?,
                yield_variance_pct_x100 = ?, status = 'COMPLETED' WHERE id = ?`
      ).run(goodPackets, damagedPouches, material, yieldPct, runId);

      logAudit({
        userId: req.user.id, action: 'PRODUCTION_COMPLETED', tableName: 'production_runs', recordId: runId,
        newValue: { goodPackets, damagedPouches }
      });
      return { runId, good_packets: goodPackets, material_cost_paisa: material, yield_variance_pct_x100: yieldPct, flags: getFlags(runId) };
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 3. OVERHEADS -> cost per packet ----------
// body: { labourRupees, powerRupees }   (can be sent again to correct; the change is logged)
router.post('/:id/overheads', allowRoles(...MAKERS), (req, res) => {
  try {
    const runId = Number(req.params.id);
    const run = db.prepare('SELECT * FROM production_runs WHERE id = ?').get(runId);
    if (!run) throw new Error('Run not found');
    if (run.status !== 'COMPLETED') throw new Error('Complete the run first');

    const labour = rupeesToPaisa(Number((req.body || {}).labourRupees || 0));
    const power = rupeesToPaisa(Number((req.body || {}).powerRupees || 0));
    const cost = costPerPacket({
      materialPaisa: run.material_cost_paisa, labourPaisa: labour, powerPaisa: power, goodPackets: run.good_packets
    });
    const fg = db.prepare('SELECT i.price_paisa FROM boms b JOIN items i ON i.id = b.fg_item_id WHERE b.id = ?').get(run.bom_id);
    const m = margin(fg.price_paisa, cost.perPacketPaisa);

    runInTransaction(() => {
      db.prepare('UPDATE production_runs SET labour_paisa = ?, power_gas_paisa = ?, cost_per_packet_paisa = ? WHERE id = ?')
        .run(labour, power, cost.perPacketPaisa, runId);
      logAudit({
        userId: req.user.id, action: 'OVERHEADS_SET', tableName: 'production_runs', recordId: runId,
        oldValue: { labour: run.labour_paisa, power: run.power_gas_paisa, cost_per_packet: run.cost_per_packet_paisa },
        newValue: { labour, power, cost_per_packet: cost.perPacketPaisa }
      });
    });

    res.json({
      runId, material_paisa: run.material_cost_paisa, labour_paisa: labour, power_paisa: power,
      total_paisa: cost.totalPaisa, cost_per_packet_paisa: cost.perPacketPaisa,
      selling_price_paisa: fg.price_paisa, profit_per_packet_paisa: m.profitPaisa, margin_pct_x100: m.marginPctX100
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- read: list and detail (variance report) ----------
const VIEWERS = ['PRODUCTION', 'ADMIN', 'OWNER', 'ACCOUNTANT'];

router.get('/', allowRoles(...VIEWERS), (req, res) => {
  const runs = db.prepare('SELECT * FROM production_runs ORDER BY id DESC').all();
  res.json(runs.map((r) => ({ ...r, flags: getFlags(r.id) })));
});

router.get('/:id', allowRoles(...VIEWERS), (req, res) => {
  const run = db.prepare('SELECT * FROM production_runs WHERE id = ?').get(Number(req.params.id));
  if (!run) return res.status(404).json({ error: 'Run not found' });
  const consumption = db.prepare(
    `SELECT i.name, i.base_unit, pc.standard_qty, pc.actual_qty, pc.variance_pct_x100, pc.flagged
     FROM production_consumption pc JOIN items i ON i.id = pc.item_id WHERE pc.run_id = ?`
  ).all(run.id);
  res.json({ ...run, consumption, flags: getFlags(run.id) });
});

export default router;