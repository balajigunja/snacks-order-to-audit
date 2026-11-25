import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { formatQty, unitChoices } from '../../format.js';
import Message from '../Message.jsx';
import ReportView from '../ReportView.jsx';

const emptyLine = { itemId: '', qty: '', unit: '', rate: '' };

// Record raw material / packaging that arrived at the factory (stock goes UP).
export default function PurchasePanel({ onChange }) {
  const [items, setItems] = useState([]);       // raw materials and packaging
  const [supplier, setSupplier] = useState('');
  const [lines, setLines] = useState([{ ...emptyLine }]);
  const [message, setMessage] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    api('/masters/stock').then((all) => setItems(all.filter((i) => i.category !== 'FG')));
  }, [refresh]);

  const itemOf = (id) => items.find((i) => String(i.id) === String(id));

  function setLine(index, patch) {
    setLines(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  // choosing an item also picks a sensible unit (flour -> kg, oil -> litre, pouches -> pcs)
  function chooseItem(index, id) {
    const it = itemOf(id);
    setLine(index, { itemId: id, unit: it ? unitChoices(it.base_unit)[0] : '' });
  }

  async function save() {
    setMessage(null);
    try {
      const r = await api('/purchases', 'POST', {
        supplier,
        lines: lines.map((l) => ({ itemId: Number(l.itemId), qty: Number(l.qty), unit: l.unit, rate: Number(l.rate) }))
      });
      const text = r.lines.map((l) => `${l.item}: stock now ${formatQty(l.balance, itemOf(items.find((i) => i.name === l.item).id).base_unit)}`).join(' · ');
      setMessage({ type: 'ok', text: `Purchase #${r.purchaseId} saved. ${text}` });
      setLines([{ ...emptyLine }]);
      setRefresh(refresh + 1);
      onChange();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  return (
    <div>
      <div className="card">
        <h2>New purchase</h2>
        <Message msg={message} />
        <label style={{ marginTop: 0 }}>Supplier (optional)</label>
        <input className="input" style={{ maxWidth: 320 }} value={supplier} onChange={(e) => setSupplier(e.target.value)} />

        {lines.map((l, i) => {
          const it = itemOf(l.itemId);
          return (
            <div className="toolbar" key={i} style={{ marginTop: 12 }}>
              <div>
                <label>Item</label>
                <select style={{ width: 200 }} value={l.itemId} onChange={(e) => chooseItem(i, e.target.value)}>
                  <option value="">Choose item</option>
                  {items.map((x) => <option key={x.id} value={x.id}>{x.name} (have {formatQty(x.balance_qty, x.base_unit)})</option>)}
                </select>
              </div>
              <div>
                <label>Quantity</label>
                <input className="input" style={{ width: 100 }} inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
              </div>
              <div>
                <label>Unit</label>
                <select style={{ width: 100 }} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })}>
                  {(it ? unitChoices(it.base_unit) : []).map((u) => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label>Rate (₹ per {l.unit || 'unit'})</label>
                <input className="input" style={{ width: 120 }} inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
              </div>
              {lines.length > 1 && <button className="btn btn-small btn-danger" onClick={() => setLines(lines.filter((_, k) => k !== i))}>Remove</button>}
            </div>
          );
        })}
        <div className="actions">
          <button className="btn" onClick={() => setLines([...lines, { ...emptyLine }])}>Add another item</button>
          <button className="btn btn-buy" onClick={save}>Save purchase</button>
        </div>
      </div>

      <div className="card">
        <ReportView name="purchase-register" refresh={refresh} />
      </div>
    </div>
  );
}
