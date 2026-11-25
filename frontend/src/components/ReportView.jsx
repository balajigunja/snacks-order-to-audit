import { useEffect, useState } from 'react';
import { api, downloadCsv } from '../api.js';
import DataTable from './DataTable.jsx';

// Loads one report from the server and shows it as a table (optionally with a CSV download button).
//   name   = report name, e.g. 'stock-summary'
//   params = '?from=2026-11-01&to=2026-11-30' (optional)
//   refresh = change this number to reload the report
export default function ReportView({ name, params = '', refresh = 0, csv = false, hideTitle = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setError('');
    api(`/reports/${name}${params}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [name, params, refresh]);

  if (error) return <div className="msg error">{error}</div>;
  if (!data) return <p className="muted">Loading...</p>;

  return (
    <div>
      <div className="order-head" style={{ marginBottom: 8 }}>
        {hideTitle ? <span /> : <h2 style={{ margin: 0 }}>{data.title}</h2>}
        {csv && (
          <button className="btn btn-small" onClick={() => downloadCsv(`/reports/${name}${params}`, `${name}_${data.from}_${data.to}.csv`)}>
            Download CSV
          </button>
        )}
      </div>
      <DataTable columns={data.columns} rows={data.rows} />
    </div>
  );
}
