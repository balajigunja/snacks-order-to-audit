import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { todayIST } from '../format.js';
import ReportView from '../components/ReportView.jsx';

// Every report the logged-in role may open. The list comes from the server.
export default function Reports() {
  const today = todayIST();
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [from, setFrom] = useState(today.slice(0, 8) + '01'); // first day of this month
  const [to, setTo] = useState(today);

  useEffect(() => {
    api('/reports').then((l) => { setList(l); if (l.length) setName(l[0].name); });
  }, []);

  return (
    <div>
      <h1>Reports</h1>
      <p className="muted">Pick a report and a date range. Every report can be downloaded as a CSV file that opens in Excel.</p>
      <div className="split" style={{ gridTemplateColumns: 'minmax(230px, 1fr) 4fr' }}>
        <div className="card report-menu" style={{ padding: 0 }}>
          {list.map((r) => (
            <a key={r.name} className={r.name === name ? 'active' : ''} onClick={() => setName(r.name)}>{r.title}</a>
          ))}
        </div>
        <div className="card">
          <div className="toolbar">
            <div><label>From</label><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><label>To</label><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          {name && <ReportView name={name} params={`?from=${from}&to=${to}`} csv />}
        </div>
      </div>
    </div>
  );
}
