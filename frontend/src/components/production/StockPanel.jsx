import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import ReportView from '../ReportView.jsx';

// Stock summary for everything, and the movement-by-movement ledger for one item.
export default function StockPanel({ refresh }) {
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState('');
  useEffect(() => { api('/masters/stock').then(setItems); }, [refresh]);

  return (
    <div>
      <div className="card"><ReportView name="stock-summary" refresh={refresh} /></div>
      <div className="card">
        <h2>Stock ledger</h2>
        <select style={{ maxWidth: 280 }} value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">All items</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <div style={{ marginTop: 12 }}>
          <ReportView name="stock-ledger" params={itemId ? `?item=${itemId}` : ''} refresh={refresh} hideTitle />
        </div>
      </div>
    </div>
  );
}
