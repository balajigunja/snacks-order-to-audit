import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api.js';
import { formatINR, formatPct, toDisplayQty, serverUnit } from '../../format.js';
import Message from '../Message.jsx';

const unitName = (base) => ({ g: 'kg', ml: 'L', pcs: 'pcs' }[base]);

// One production run: complete it (good packets, packaging used) and add overheads.
function RunCard({ run, bom, reload }) {
  const batches = bom ? run.expected_output / bom.batch_output_qty : 1;
  const packLines = bom ? bom.lines.filter((l) => l.category === 'PACKAGING') : [];
  // the pouch line is the one with one piece per packet; its usage is good + damaged packets
  const pouch = bom ? packLines.find((l) => l.qty === bom.batch_output_qty) : null;

  const [good, setGood] = useState('');
  const [damaged, setDamaged] = useState('0');
  const [pack, setPack] = useState({});
  const [labour, setLabour] = useState(run.labour_paisa ? String(run.labour_paisa / 100) : '');
  const [power, setPower] = useState(run.power_gas_paisa ? String(run.power_gas_paisa / 100) : '');
  const [message, setMessage] = useState(null);

  useEffect(() => {
    const start = {};
    packLines.forEach((l) => { start[l.item_id] = String(toDisplayQty(l.qty * batches, l.base_unit)); });
    setPack(start);
  }, [run.id, bom && bom.id]);

  async function act(fn, okText) {
    setMessage(null);
    try {
      const r = await fn();
      setMessage({ type: 'ok', text: okText(r) });
      reload();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  const complete = () => act(
    () => api(`/production/${run.id}/complete`, 'POST', {
      goodPackets: Number(good),
      damagedPouches: Number(damaged || 0),
      packaging: packLines.map((l) => ({
        itemId: l.item_id,
        qty: l === pouch ? Number(good) + Number(damaged || 0) : Number(pack[l.item_id]),
        unit: serverUnit(l.base_unit)
      }))
    }),
    (r) => `Run completed: ${r.good_packets} good packets. Yield ${formatPct(r.yield_variance_pct_x100)}.`
  );

  const overheads = () => act(
    () => api(`/production/${run.id}/overheads`, 'POST', { labourRupees: Number(labour || 0), powerRupees: Number(power || 0) }),
    (r) => `Cost per packet ${formatINR(r.cost_per_packet_paisa)} · profit ${formatINR(r.profit_per_packet_paisa)} per packet (${formatPct(r.margin_pct_x100)} margin).`
  );

  return (
    <div className="card">
      <div className="order-head">
        <h2 style={{ margin: 0 }}>Run #{run.id} · {bom ? bom.product : ''}</h2>
        <span className={'chip ' + (run.status === 'COMPLETED' ? 'green' : 'orange')}>{run.status === 'COMPLETED' ? 'Completed' : 'In progress'}</span>
      </div>
      <p className="muted">
        {run.date} · expected {run.expected_output} packets
        {run.status === 'COMPLETED' && ` · made ${run.good_packets} (yield ${formatPct(run.yield_variance_pct_x100)})`}
        {run.cost_per_packet_paisa !== null && ` · cost per packet ${formatINR(run.cost_per_packet_paisa)}`}
      </p>
      {run.flags.length > 0 && (
        <div className="mb">
          {run.flags.map((f) => <span key={f.what} className="chip orange" style={{ marginRight: 6 }}>⚠ {f.what} {formatPct(f.pct_x100)}</span>)}
        </div>
      )}
      <Message msg={message} />

      {run.status === 'STARTED' && (
        <div>
          <strong>Finish the run</strong>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <div><label>Good packets made</label><input className="input" style={{ width: 130 }} inputMode="numeric" value={good} onChange={(e) => setGood(e.target.value)} /></div>
            <div><label>Damaged pouches</label><input className="input" style={{ width: 130 }} inputMode="numeric" value={damaged} onChange={(e) => setDamaged(e.target.value)} /></div>
            {packLines.map((l) => (
              <div key={l.item_id}>
                <label>{l.name} used ({unitName(l.base_unit)})</label>
                {l === pouch
                  ? <input className="input" style={{ width: 130 }} value={Number(good || 0) + Number(damaged || 0)} readOnly title="good + damaged packets" />
                  : <input className="input" style={{ width: 130 }} inputMode="decimal" value={pack[l.item_id] || ''} onChange={(e) => setPack({ ...pack, [l.item_id]: e.target.value })} />}
              </div>
            ))}
          </div>
          <button className="btn btn-buy" disabled={good === ''} onClick={complete}>Complete run</button>
        </div>
      )}

      {run.status === 'COMPLETED' && (
        <div>
          <strong>Overheads for this run</strong>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <div><label>Labour (₹)</label><input className="input" style={{ width: 130 }} inputMode="decimal" value={labour} onChange={(e) => setLabour(e.target.value)} /></div>
            <div><label>Gas / power (₹)</label><input className="input" style={{ width: 130 }} inputMode="decimal" value={power} onChange={(e) => setPower(e.target.value)} /></div>
            <button className="btn btn-primary" onClick={overheads}>Calculate cost per packet</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RunPanel({ onChange }) {
  const [boms, setBoms] = useState([]);
  const [runs, setRuns] = useState([]);
  const [bomId, setBomId] = useState('');
  const [batches, setBatches] = useState('1');
  const [issued, setIssued] = useState({});     // what the supervisor takes out of the store: { itemId: text }
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    const [b, r] = await Promise.all([api('/masters/boms'), api('/production')]);
    setBoms(b);
    setRuns(r);
    setBomId((prev) => prev || (b.length ? String(b[0].id) : ''));
  }, []);
  useEffect(() => { load(); }, [load]);

  const bom = boms.find((b) => String(b.id) === String(bomId));
  const rawLines = bom ? bom.lines.filter((l) => l.category === 'RAW') : [];

  // fill the boxes with the recipe quantities (the supervisor can change them if more or less was used)
  useEffect(() => {
    if (!bom) return;
    const n = Math.max(1, Number(batches) || 1);
    const start = {};
    bom.lines.filter((l) => l.category === 'RAW').forEach((l) => { start[l.item_id] = String(toDisplayQty(l.qty * n, l.base_unit)); });
    setIssued(start);
  }, [bomId, batches, boms]);

  const reload = () => { load(); onChange(); };

  async function start() {
    setMessage(null);
    try {
      const r = await api('/production/start', 'POST', {
        bomId: Number(bomId),
        batches: Number(batches),
        issued: rawLines.map((l) => ({ itemId: l.item_id, qty: Number(issued[l.item_id]), unit: serverUnit(l.base_unit) }))
      });
      const alerts = r.flags.map((f) => `${f.what} ${formatPct(f.pct_x100)}`).join(', ');
      setMessage({ type: r.flags.length ? 'info' : 'ok', text: `Run #${r.runId} started. Raw material taken from stock.${alerts ? ' Alert: ' + alerts + ' vs recipe.' : ''}` });
      reload();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Start a production run</h2>
        <Message msg={message} />
        {bom && (
          <div>
            <div className="toolbar">
              <div>
                <label>Recipe</label>
                <select style={{ width: 220 }} value={bomId} onChange={(e) => setBomId(e.target.value)}>
                  {boms.map((b) => <option key={b.id} value={b.id}>{b.product} ({b.batch_output_qty} packets per batch)</option>)}
                </select>
              </div>
              <div>
                <label>Batches</label>
                <input className="input" style={{ width: 90 }} inputMode="numeric" value={batches} onChange={(e) => setBatches(e.target.value)} />
              </div>
            </div>
            <p className="muted">Raw material issued to the kitchen (the recipe amounts are filled in; change them if more or less was used):</p>
            <div className="toolbar">
              {rawLines.map((l) => (
                <div key={l.item_id}>
                  <label>{l.name} ({unitName(l.base_unit)})</label>
                  <input className="input" style={{ width: 130 }} inputMode="decimal" value={issued[l.item_id] || ''} onChange={(e) => setIssued({ ...issued, [l.item_id]: e.target.value })} />
                </div>
              ))}
            </div>
            <button className="btn btn-buy" onClick={start}>Start run and issue materials</button>
          </div>
        )}
      </div>

      {runs.map((r) => <RunCard key={r.id} run={r} bom={boms.find((b) => b.id === r.bom_id)} reload={reload} />)}
    </div>
  );
}
