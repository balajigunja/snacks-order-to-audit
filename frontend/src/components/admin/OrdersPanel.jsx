import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api.js';
import { formatINR, formatDateTime } from '../../format.js';
import Message from '../Message.jsx';

const FILTERS = [
  ['SUBMITTED', 'Needs approval'], ['APPROVED', 'Approved'], ['INVOICED', 'Invoiced'],
  ['DISPATCHED', 'Dispatched'], ['CANCELLED', 'Rejected'], ['ALL', 'All']
];
const CHIP = { SUBMITTED: 'orange', APPROVED: 'blue', INVOICED: 'blue', DISPATCHED: 'green', CANCELLED: 'red' };
const NAME = { SUBMITTED: 'Submitted', APPROVED: 'Approved', INVOICED: 'Invoiced', DISPATCHED: 'Dispatched', CANCELLED: 'Rejected' };

export default function OrdersPanel({ goInvoices }) {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('SUBMITTED');
  const [order, setOrder] = useState(null);      // the order that is open (with its stock check)
  const [edits, setEdits] = useState({});        // what the admin typed: { itemId: { qty, price } }
  const [message, setMessage] = useState(null);
  const [shortage, setShortage] = useState(false); // true after approve was refused for lack of stock
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const loadList = useCallback(async () => setOrders(await api('/orders')), []);

  const openOrder = useCallback(async (id) => {
    const o = await api('/orders/' + id);
    const typed = {};
    for (const l of o.lines) typed[l.item_id] = { qty: String(l.qty), price: (l.price_paisa / 100).toFixed(2) };
    setOrder(o); setEdits(typed); setShortage(false); setRejecting(false); setReason('');
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const count = (s) => (s === 'ALL' ? orders.length : orders.filter((o) => o.status === s).length);
  const shown = filter === 'ALL' ? orders : orders.filter((o) => o.status === filter);

  // run one action, then refresh the list and the open order
  async function act(fn, okText) {
    setMessage(null);
    try {
      const r = await fn();
      if (okText) setMessage({ type: 'ok', text: okText(r) });
      await loadList();
      await openOrder(order.id);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  const editable = order && order.status === 'SUBMITTED';
  const lineTotal = (id) => Math.round(Number(edits[id].price) * 100) * (Number(edits[id].qty) || 0); // whole paisa
  const changed = order && order.lines.some((l) =>
    Number(edits[l.item_id].qty) !== l.qty || Math.round(Number(edits[l.item_id].price) * 100) !== l.price_paisa);

  const save = () => act(
    () => api(`/orders/${order.id}`, 'PUT', {
      lines: order.lines.map((l) => ({ itemId: l.item_id, qty: Number(edits[l.item_id].qty), priceRupees: Number(edits[l.item_id].price) }))
    }),
    () => 'Order updated. The change is saved in the audit log.'
  );

  async function approve(force) {
    setMessage(null);
    try {
      await api(`/orders/${order.id}/approve`, 'POST', { force });
      setMessage({ type: 'ok', text: `Order #${order.id} approved.` });
      await loadList();
      await openOrder(order.id);
    } catch (err) {
      if (err.status === 409) {
        await openOrder(order.id);
        setShortage(true);
        setMessage({ type: 'error', text: 'Not enough finished-goods stock for this order. See the stock check below.' });
      } else {
        setMessage({ type: 'error', text: err.message });
      }
    }
  }

  const reject = () => act(
    () => api(`/orders/${order.id}/reject`, 'POST', { reason }),
    () => `Order #${order.id} rejected.`
  );
  const invoice = () => act(
    () => api('/invoices', 'POST', { orderId: order.id }),
    (r) => `Invoice ${r.invoiceNo} created for ${formatINR(r.total_paisa)} (GST ${formatINR(r.cgst_paisa + r.sgst_paisa + r.igst_paisa)}).`
  );

  return (
    <div>
      <div className="pills">
        {FILTERS.map(([key, label]) => (
          <button key={key} className={filter === key ? 'pill active' : 'pill'} onClick={() => setFilter(key)}>
            {label} ({count(key)})
          </button>
        ))}
      </div>

      <div className="split">
        <div className="card" style={{ padding: 0 }}>
          {shown.length === 0 && <p className="muted" style={{ padding: 16 }}>No orders here.</p>}
          {shown.map((o) => (
            <div key={o.id} className={order && order.id === o.id ? 'list-item selected' : 'list-item'} onClick={() => { setMessage(null); openOrder(o.id); }}>
              <div>
                <strong>#{o.id} · {o.customer}</strong>
                <div className="muted">{o.salesman} · {formatDateTime(o.created_at)}</div>
              </div>
              <div className="right">
                <strong>{formatINR(o.total_paisa)}</strong>
                <div><span className={'chip ' + CHIP[o.status]}>{NAME[o.status]}</span></div>
              </div>
            </div>
          ))}
        </div>

        <div>
          <Message msg={message} />
          {!order && <div className="card muted">Select an order to see it here.</div>}
          {order && (
            <div className="card">
              <div className="order-head">
                <h2 style={{ margin: 0 }}>Order #{order.id} · {order.customer}</h2>
                <span className={'chip ' + CHIP[order.status]}>{NAME[order.status]}</span>
              </div>
              <p className="muted">{order.customer_state} · taken by {order.salesman} · {formatDateTime(order.created_at)}</p>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Product</th><th className="num">Qty</th><th className="num">Price (₹)</th><th className="num">Amount</th>{editable && <th>Stock check</th>}</tr>
                  </thead>
                  <tbody>
                    {order.lines.map((l) => {
                      const sc = order.stockCheck && order.stockCheck.lines.find((s) => s.itemId === l.item_id);
                      const e = edits[l.item_id];
                      return (
                        <tr key={l.item_id}>
                          <td>{l.name}</td>
                          <td className="num">{editable ? <input className="line-input" value={e.qty} onChange={(ev) => setEdits({ ...edits, [l.item_id]: { ...e, qty: ev.target.value } })} /> : l.qty}</td>
                          <td className="num">{editable ? <input className="line-input" value={e.price} onChange={(ev) => setEdits({ ...edits, [l.item_id]: { ...e, price: ev.target.value } })} /> : (l.price_paisa / 100).toFixed(2)}</td>
                          <td className="num">{formatINR(editable ? lineTotal(l.item_id) : l.line_total_paisa)}</td>
                          {editable && sc && (
                            <td>
                              {sc.shortage === 0
                                ? <span className="chip green">In stock ({sc.available} available)</span>
                                : <span className="chip red">Short by {sc.shortage} (only {sc.available} available)</span>}
                              {sc.promisedToOthers > 0 && <div className="muted">{sc.promisedToOthers} already promised to other orders</div>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="total"><span>Total before GST</span><span>{formatINR(order.lines.reduce((t, l) => t + (editable ? lineTotal(l.item_id) : l.line_total_paisa), 0))}</span></div>

              {editable && (
                <div className="actions">
                  {changed && <button className="btn btn-primary" onClick={save}>Save changes</button>}
                  <button className="btn btn-buy" disabled={changed} onClick={() => approve(false)}>Approve order</button>
                  {shortage && <button className="btn" onClick={() => approve(true)}>Approve anyway</button>}
                  <button className="btn btn-danger" onClick={() => setRejecting(!rejecting)}>Reject</button>
                  {changed && <span className="muted">Save your changes before approving.</span>}
                </div>
              )}
              {editable && shortage && <p className="muted">Stock is short. Reduce the quantity and save, or approve anyway to invoice later.</p>}
              {editable && rejecting && (
                <div className="actions">
                  <input className="input" style={{ maxWidth: 280 }} placeholder="Reason for rejecting" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button className="btn btn-danger" disabled={!reason.trim()} onClick={reject}>Confirm reject</button>
                </div>
              )}
              {order.status === 'APPROVED' && (
                <div className="actions"><button className="btn btn-buy" onClick={invoice}>Create GST invoice</button></div>
              )}
              {order.status === 'INVOICED' && (
                <div className="actions">
                  <span className="muted">Invoiced. Dispatch and payments are on the Invoices tab.</span>
                  <button className="btn" onClick={goInvoices}>Go to invoices</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
