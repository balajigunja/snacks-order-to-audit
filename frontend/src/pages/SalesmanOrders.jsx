import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { getUser } from '../auth.js';
import { formatINR, formatDateTime } from '../format.js';
import { getPending, queueOrder, syncPending, newId } from '../offlineQueue.js';
import StatusSteps from '../components/StatusSteps.jsx';
import DataTable from '../components/DataTable.jsx';

// Customer and product lists are saved on the phone, so the screen still opens with no internet.
async function loadMasters() {
  try {
    const [customers, products] = await Promise.all([api('/masters/customers'), api('/masters/products')]);
    localStorage.setItem('masters', JSON.stringify({ customers, products }));
    return { customers, products };
  } catch {
    return JSON.parse(localStorage.getItem('masters') || '{"customers":[],"products":[]}');
  }
}

export default function SalesmanOrders() {
  const user = getUser();
  const [tab, setTab] = useState('new');
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [qtys, setQtys] = useState({});            // { productId: quantity }
  const [orders, setOrders] = useState([]);
  const [sales, setSales] = useState(null);
  const [message, setMessage] = useState(null);   // { type: 'ok' | 'error' | 'info', text }
  const [pending, setPending] = useState(getPending(user.id).length);
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);

  const loadOrders = useCallback(async () => {
    try { setOrders(await api('/orders')); } catch { /* offline: keep what we have */ }
  }, []);

  const loadSales = useCallback(async () => {
    try { setSales(await api('/reports/sales-by-customer')); } catch { /* offline */ }
  }, []);

  // send orders that were saved while offline
  const flush = useCallback(async () => {
    if (getPending(user.id).length === 0) return;
    const { sent, failed } = await syncPending(user.id);
    setPending(getPending(user.id).length);
    if (failed.length) setMessage({ type: 'error', text: `A saved order was refused: ${failed[0].error}` });
    else if (sent) setMessage({ type: 'ok', text: `${sent} saved order(s) sent to the factory.` });
    loadOrders();
  }, [user.id, loadOrders]);

  useEffect(() => {
    loadMasters().then(({ customers: c, products: p }) => { setCustomers(c); setProducts(p); });
    loadOrders();
    flush();
    const goOnline = () => { setOnline(true); flush(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, [flush, loadOrders]);

  useEffect(() => { if (tab === 'sales') loadSales(); if (tab === 'orders') loadOrders(); }, [tab, loadSales, loadOrders]);

  const setQty = (id, value) => setQtys({ ...qtys, [id]: Math.max(0, Math.floor(Number(value) || 0)) });
  const lines = products.filter((p) => qtys[p.id] > 0);
  const total = lines.reduce((t, p) => t + qtys[p.id] * p.price_paisa, 0); // whole paisa, no decimals

  async function placeOrder() {
    if (!customerId) return setMessage({ type: 'error', text: 'Please choose a customer.' });
    if (lines.length === 0) return setMessage({ type: 'error', text: 'Add at least one product.' });

    const order = {
      customerId: Number(customerId),
      lines: lines.map((p) => ({ itemId: p.id, qty: qtys[p.id] })),
      clientUuid: newId()
    };
    setBusy(true);
    try {
      const r = await api('/orders', 'POST', order);
      setMessage({ type: 'ok', text: `Order #${r.orderId} sent to the factory.` });
      setQtys({});
      loadOrders();
    } catch (err) {
      if (err.status === 0) {
        queueOrder(user.id, order); // no internet: keep it on the phone
        setPending(getPending(user.id).length);
        setQtys({});
        setMessage({ type: 'info', text: 'No internet. The order is saved on this phone and will be sent automatically.' });
      } else {
        setMessage({ type: 'error', text: err.message });
      }
    }
    setBusy(false);
  }

  return (
    <div>
      <h1>Hello, {user.name}</h1>
      <p className="muted">{online ? 'Online' : 'Offline'}{pending > 0 && ` · ${pending} order(s) waiting to be sent`}</p>

      {message && <div className={'msg ' + message.type}>{message.text}</div>}

      <div className="tabs">
        <button className={tab === 'new' ? 'tab active' : 'tab'} onClick={() => setTab('new')}>New order</button>
        <button className={tab === 'orders' ? 'tab active' : 'tab'} onClick={() => setTab('orders')}>My orders</button>
        <button className={tab === 'sales' ? 'tab active' : 'tab'} onClick={() => setTab('sales')}>My sales</button>
      </div>

      {tab === 'new' && (
        <div className="card">
          <label style={{ marginTop: 0 }}>Customer</label>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select a customer</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.state})</option>)}
          </select>

          <label>Products</label>
          {products.map((p) => (
            <div className="product" key={p.id}>
              <div>
                <div>{p.name}</div>
                <div className="muted">{formatINR(p.price_paisa)} per packet</div>
              </div>
              <div className="stepper">
                <button onClick={() => setQty(p.id, (qtys[p.id] || 0) - 1)}>−</button>
                <input inputMode="numeric" value={qtys[p.id] || ''} placeholder="0" onChange={(e) => setQty(p.id, e.target.value)} />
                <button onClick={() => setQty(p.id, (qtys[p.id] || 0) + 1)}>+</button>
              </div>
            </div>
          ))}

          <div className="total"><span>Total (before GST)</span><span>{formatINR(total)}</span></div>
          <button className="btn btn-buy btn-block" onClick={placeOrder} disabled={busy}>
            {busy ? 'Sending...' : 'Place order'}
          </button>
        </div>
      )}

      {tab === 'orders' && (
        <div>
          {orders.length === 0 && <p className="muted">No orders yet.</p>}
          {orders.map((o) => (
            <div className="card" key={o.id}>
              <div className="order-head">
                <strong>#{o.id} · {o.customer}</strong>
                <strong>{formatINR(o.total_paisa)}</strong>
              </div>
              <div className="muted">{formatDateTime(o.created_at)}</div>
              <StatusSteps status={o.status} />
            </div>
          ))}
        </div>
      )}

      {tab === 'sales' && (
        <div className="card">
          <h2>Customer-wise sales (this month)</h2>
          {sales ? <DataTable columns={sales.columns} rows={sales.rows} /> : <p className="muted">Loading...</p>}
        </div>
      )}
    </div>
  );
}
