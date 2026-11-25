import { useState } from 'react';
import OrdersPanel from '../components/admin/OrdersPanel.jsx';
import InvoicesPanel from '../components/admin/InvoicesPanel.jsx';

// The billing desk: approve orders, raise GST invoices, dispatch, record payments.
export default function AdminOrders() {
  const [tab, setTab] = useState('orders');
  return (
    <div>
      <h1>Orders and billing</h1>
      <p className="muted">Approve incoming orders, raise GST invoices, record dispatch and payments.</p>
      <div className="tabs" style={{ maxWidth: 420 }}>
        <button className={tab === 'orders' ? 'tab active' : 'tab'} onClick={() => setTab('orders')}>Orders</button>
        <button className={tab === 'invoices' ? 'tab active' : 'tab'} onClick={() => setTab('invoices')}>Invoices</button>
      </div>
      {tab === 'orders' ? <OrdersPanel goInvoices={() => setTab('invoices')} /> : <InvoicesPanel />}
    </div>
  );
}
