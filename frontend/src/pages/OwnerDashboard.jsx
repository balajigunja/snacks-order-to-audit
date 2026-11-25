import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatINR, formatRupeeText, formatQty, formatPct, istDate, todayIST } from '../format.js';

const CATEGORY = { RAW: 'Raw material', PACKAGING: 'Packaging', FG: 'Finished goods' };

// The boss's one-page summary: today's orders, dues, cost per packet, alerts, stock.
export default function OwnerDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api('/orders'), api('/masters/stock'), api('/production'),
      api('/reports/outstanding'), api('/reports/production-cost')
    ])
      .then(([orders, stock, runs, dues, costs]) => setData({ orders, stock, runs, dues, costs }))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="msg error">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;

  const today = todayIST();
  const todays = data.orders.filter((o) => istDate(o.created_at) === today);
  const waiting = data.orders.filter((o) => o.status === 'SUBMITTED').length;
  const dueRow = data.dues.rows.find((r) => r.customer === 'TOTAL');
  const costed = data.costs.rows.filter((r) => r.margin !== '');
  const latest = costed[costed.length - 1];
  const alerts = data.runs.filter((r) => r.flags.length > 0);

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="muted">Today, {today}</p>

      <div className="kpis">
        <div className="card kpi">
          <div className="label">Today's orders</div>
          <div className="big">{todays.length}</div>
          <div className="muted">worth {formatINR(todays.reduce((t, o) => t + o.total_paisa, 0))} · {waiting} waiting for approval</div>
        </div>
        <div className="card kpi">
          <div className="label">Unpaid dues</div>
          <div className="big">{dueRow ? formatRupeeText(dueRow.total) : '₹0.00'}</div>
          <div className="muted">{dueRow ? `${dueRow.invoices} open invoice(s)` : 'nothing outstanding'}</div>
        </div>
        <div className="card kpi">
          <div className="label">Cost per packet (latest run)</div>
          <div className="big">{latest ? formatRupeeText(latest.cost) : '—'}</div>
          <div className="muted">{latest ? `${latest.product} · selling ${formatRupeeText(latest.price)} · margin ${latest.margin}` : 'no costed run yet'}</div>
        </div>
        <div className="card kpi">
          <div className="label">Wastage / variance alerts</div>
          <div className="big">{alerts.length}</div>
          <div className="muted">{alerts.length ? 'run(s) beyond tolerance' : 'all runs within tolerance'}</div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="card">
          <h2>Alerts</h2>
          {alerts.map((r) => (
            <div key={r.id} style={{ marginBottom: 6 }}>
              <strong>Run #{r.id}</strong> ({r.date}){' '}
              {r.flags.map((f) => <span key={f.what} className="chip orange" style={{ marginRight: 6 }}>⚠ {f.what} {formatPct(f.pct_x100)}</span>)}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Current stock</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Type</th><th className="num">In stock</th></tr></thead>
            <tbody>
              {data.stock.map((s) => (
                <tr key={s.id}><td>{s.name}</td><td>{CATEGORY[s.category]}</td><td className="num">{formatQty(s.balance_qty, s.base_unit)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
