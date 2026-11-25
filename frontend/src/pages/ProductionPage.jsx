import { useState } from 'react';
import PurchasePanel from '../components/production/PurchasePanel.jsx';
import RunPanel from '../components/production/RunPanel.jsx';
import StockPanel from '../components/production/StockPanel.jsx';
import ReportView from '../components/ReportView.jsx';

// The factory floor: raw material in, production runs, stock.
export default function ProductionPage() {
  const [tab, setTab] = useState('runs');
  const [version, setVersion] = useState(0);        // bump this to reload the tables after any change
  const changed = () => setVersion((v) => v + 1);

  return (
    <div>
      <h1>Production</h1>
      <p className="muted">Receive raw material, run batches against the recipe, see stock and wastage.</p>
      <div className="tabs" style={{ maxWidth: 520 }}>
        <button className={tab === 'purchase' ? 'tab active' : 'tab'} onClick={() => setTab('purchase')}>Raw material in</button>
        <button className={tab === 'runs' ? 'tab active' : 'tab'} onClick={() => setTab('runs')}>Production runs</button>
        <button className={tab === 'stock' ? 'tab active' : 'tab'} onClick={() => setTab('stock')}>Stock</button>
      </div>

      {tab === 'purchase' && <PurchasePanel onChange={changed} />}
      {tab === 'runs' && (
        <div>
          <RunPanel onChange={changed} />
          <div className="card"><ReportView name="production-variance" refresh={version} /></div>
          <div className="card"><ReportView name="production-cost" refresh={version} /></div>
        </div>
      )}
      {tab === 'stock' && <StockPanel refresh={version} />}
    </div>
  );
}
