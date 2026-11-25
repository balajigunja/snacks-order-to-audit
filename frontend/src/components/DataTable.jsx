// Shows any report: { columns: [{ key, label }], rows: [{ key: value }] }
const looksNumeric = (v) => typeof v === 'number' || (typeof v === 'string' && /^-?[\d,.]+%?$/.test(v));

export default function DataTable({ columns, rows }) {
  if (!rows.length) return <p className="muted">No data for this period.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={looksNumeric(rows[0][c.key]) ? 'num' : ''}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={String(Object.values(r)[0]).startsWith('TOTAL') ? 'total-row' : ''}>
              {columns.map((c) => (
                <td key={c.key} className={looksNumeric(r[c.key]) ? 'num' : ''}>{r[c.key] === undefined ? '' : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
