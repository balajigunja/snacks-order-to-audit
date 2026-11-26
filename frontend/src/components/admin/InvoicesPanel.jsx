import { useEffect, useState, useCallback } from 'react';
import { api, downloadFile } from '../../api.js';
import { formatINR } from '../../format.js';
import Message from '../Message.jsx';

export default function InvoicesPanel() {
  const [invoices, setInvoices] = useState([]);
  const [inv, setInv] = useState(null);          // the invoice that is open
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('UPI');
  const [message, setMessage] = useState(null);
  const [share, setShare] = useState(null);      // WhatsApp / email / copy links for the open invoice

  const loadList = useCallback(async () => setInvoices(await api('/invoices')), []);
  const openInvoice = useCallback(async (id) => {
    setInv(await api('/invoices/' + id));
    setAmount('');
    try { setShare(await api(`/invoices/${id}/share`)); } catch { setShare(null); }
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  async function act(fn, okText) {
    setMessage(null);
    try {
      const r = await fn();
      setMessage({ type: 'ok', text: okText(r) });
      await loadList();
      await openInvoice(inv.id);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  }

  async function downloadPdf() {
    try { await downloadFile(`/invoices/${inv.id}/pdf`, inv.invoice_no.replace(/\//g, '-') + '.pdf'); }
    catch (err) { setMessage({ type: 'error', text: err.message }); }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(share.pdfUrl);
      setMessage({ type: 'ok', text: 'Link copied. Paste it in any chat or email.' });
    } catch {
      setMessage({ type: 'info', text: 'Copy this link: ' + share.pdfUrl });
    }
  }

  const dispatch = () => act(
    () => api('/dispatch', 'POST', { invoiceId: inv.id }),
    (r) => `Dispatched. Stock left: ${r.items.map((i) => `${i.stockLeft} ${i.item}`).join(', ')}.`
  );
  const pay = () => act(
    () => api('/payments', 'POST', { invoiceId: inv.id, amountRupees: Number(amount), mode }),
    (r) => `Payment recorded. Outstanding now ${formatINR(r.outstanding_paisa)}.`
  );

  return (
    <div className="split">
      <div className="card" style={{ padding: 0 }}>
        {invoices.length === 0 && <p className="muted" style={{ padding: 16 }}>No invoices yet.</p>}
        {invoices.map((v) => (
          <div key={v.id} className={inv && inv.id === v.id ? 'list-item selected' : 'list-item'} onClick={() => { setMessage(null); openInvoice(v.id); }}>
            <div>
              <strong>{v.invoice_no}</strong>
              <div className="muted">{v.customer_name} · {v.date}</div>
              <div>
                <span className={'chip ' + (v.dispatched ? 'green' : 'orange')}>{v.dispatched ? 'Dispatched' : 'Not dispatched'}</span>{' '}
                <span className={'chip ' + (v.outstanding_paisa === 0 ? 'green' : 'red')}>{v.outstanding_paisa === 0 ? 'Paid' : 'Due ' + formatINR(v.outstanding_paisa)}</span>
              </div>
            </div>
            <strong>{formatINR(v.total_paisa)}</strong>
          </div>
        ))}
      </div>

      <div>
        <Message msg={message} />
        {!inv && <div className="card muted">Select an invoice to dispatch it or record a payment.</div>}
        {inv && (
          <div className="card">
            <div className="order-head">
              <h2 style={{ margin: 0 }}>{inv.invoice_no}</h2>
              <span className="muted">{inv.date}</span>
            </div>
            <p className="muted">{inv.customer_name} · GSTIN {inv.customer_gstin || 'none'} · Place of supply: {inv.place_of_supply}</p>

            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th>HSN</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Taxable value</th></tr></thead>
                <tbody>
                  {inv.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.item_name}</td><td>{l.hsn_code}</td><td className="num">{l.qty}</td>
                      <td className="num">{formatINR(l.price_paisa)}</td><td className="num">{formatINR(l.taxable_paisa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <table style={{ marginTop: 12 }}>
              <tbody>
                <tr><td>Taxable value</td><td className="num">{formatINR(inv.taxable_paisa)}</td></tr>
                {inv.cgst_paisa > 0 && <tr><td>CGST</td><td className="num">{formatINR(inv.cgst_paisa)}</td></tr>}
                {inv.sgst_paisa > 0 && <tr><td>SGST</td><td className="num">{formatINR(inv.sgst_paisa)}</td></tr>}
                {inv.igst_paisa > 0 && <tr><td>IGST</td><td className="num">{formatINR(inv.igst_paisa)}</td></tr>}
                <tr className="total-row"><td>Invoice total</td><td className="num">{formatINR(inv.total_paisa)}</td></tr>
                <tr><td>Paid</td><td className="num">{formatINR(inv.paid_paisa)}</td></tr>
                <tr className="total-row"><td>Outstanding</td><td className="num">{formatINR(inv.outstanding_paisa)}</td></tr>
              </tbody>
            </table>

            <div className="actions">
              <button className="btn btn-primary" onClick={downloadPdf}>Download PDF</button>
              {share && <a className="btn" href={share.whatsappUrl} target="_blank" rel="noreferrer">Share on WhatsApp</a>}
              {share && <a className="btn" href={share.emailUrl}>Share by email</a>}
              {share && <button className="btn" onClick={copyLink}>Copy link</button>}
            </div>

            <div className="actions">
              {!inv.dispatched && inv.status === 'POSTED' && <button className="btn btn-buy" onClick={dispatch}>Record dispatch</button>}
              {inv.dispatched === 1 && <span className="chip green">Dispatched on {inv.dispatched_at}</span>}
            </div>

            {inv.outstanding_paisa > 0 && inv.status === 'POSTED' && (
              <div className="actions">
                <input className="input" style={{ width: 160 }} placeholder="Amount received (₹)" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <select style={{ width: 110 }} value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option>UPI</option><option>CASH</option><option>BANK</option>
                </select>
                <button className="btn btn-primary" disabled={!(Number(amount) > 0)} onClick={pay}>Record payment</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
