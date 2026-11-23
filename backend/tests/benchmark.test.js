// SECTION 5 BENCHMARK - the exact scenario from the problem statement, through the real API.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

process.env.DB_FILE = ':memory:';
const { default: db } = await import('../src/db/connection.js');
db.exec(fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
await import('../src/db/seed_benchmark.js');
const { default: app } = await import('../src/app.js');
const { getBalance } = await import('../src/services/stockLedger.js');

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
test.after(() => server.close());

async function call(path, method = 'GET', body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json() };
}
const login = async (email) => (await call('/auth/login', 'POST', { email, password: 'password123' })).data.token;
const itemId = (name) => db.prepare('SELECT id FROM items WHERE name = ?').get(name).id;
const custId = (name) => db.prepare('SELECT id FROM customers WHERE name = ?').get(name).id;
const FLOUR = itemId('Flour'), OIL = itemId('Cooking oil'), SPICE = itemId('Salt and spice mix');
const POUCH = itemId('200 g pouch'), CARTON = itemId('Carton (20 packets)'), MURUKKU = itemId('Murukku 200 g');

let prod, admin, salA, salB, bOrderId;

test('logins for every role work', async () => {
  [prod, admin, salA, salB] = await Promise.all([
    login('production@snacks.test'), login('admin@snacks.test'),
    login('salesman.a@snacks.test'), login('salesman.b@snacks.test')
  ]);
  assert.ok(prod && admin && salA && salB);
  assert.ok(await login('accountant@snacks.test'));
  assert.ok(await login('owner@snacks.test'));
});

test('opening stock matches the PDF', () => {
  assert.strictEqual(getBalance(FLOUR), 100000);   // 100 kg
  assert.strictEqual(getBalance(OIL), 30000);      // 30 L
  assert.strictEqual(getBalance(SPICE), 5000);     // 5 kg
  assert.strictEqual(getBalance(POUCH), 500);
  assert.strictEqual(getBalance(CARTON), 30);
  assert.strictEqual(getBalance(MURUKKU), 50);
});

test('step 1: purchase 60 kg flour at Rs 45/kg', async () => {
  const r = await call('/purchases', 'POST', { lines: [{ itemId: FLOUR, qty: 60, unit: 'kg', rate: 45 }] }, prod);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(getBalance(FLOUR), 160000);
});

test('step 2: issue 40 kg flour, 10.5 L oil, 1.2 kg spice', async () => {
  const r = await call('/production/start', 'POST', { bomId: 1, issued: [
    { itemId: FLOUR, qty: 40, unit: 'kg' }, { itemId: OIL, qty: 10.5, unit: 'litre' }, { itemId: SPICE, qty: 1.2, unit: 'kg' }] }, prod);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.data.expected_output, 200);
});

test('step 3: 188 good, 6 damaged pouches, 9 cartons -> balances and variances', async () => {
  const r = await call('/production/1/complete', 'POST', { goodPackets: 188, damagedPouches: 6, packaging: [
    { itemId: POUCH, qty: 194, unit: 'pcs' }, { itemId: CARTON, qty: 9, unit: 'pcs' }] }, prod);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(getBalance(FLOUR), 120000);  // 120 kg
  assert.strictEqual(getBalance(OIL), 19500);     // 19.5 L
  assert.strictEqual(getBalance(POUCH), 306);
  assert.strictEqual(getBalance(MURUKKU), 238);   // 50 + 188
  assert.strictEqual(r.data.yield_variance_pct_x100, -600);
  const detail = (await call('/production/1', 'GET', null, prod)).data;
  const oil = detail.consumption.find((c) => c.name === 'Cooking oil');
  assert.strictEqual(oil.variance_pct_x100, 500);
  assert.strictEqual(oil.flagged, 1);
  assert.ok(detail.flags.some((f) => f.what === 'Yield'));
});

test('step 4: Salesman A orders 150 packets for Retailer A', async () => {
  const r = await call('/orders', 'POST', { customerId: custId('Retailer A'), lines: [{ itemId: MURUKKU, qty: 150 }] }, salA);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.data.total_paisa, 750000);
});

test('step 5: approve, GST invoice (CGST+SGST), dispatch -> 88 packets', async () => {
  assert.strictEqual((await call('/orders/1/approve', 'POST', {}, admin)).data.status, 'APPROVED');
  const inv = await call('/invoices', 'POST', { orderId: 1 }, admin);
  assert.strictEqual(inv.data.taxable_paisa, 750000);   // Rs 7,500
  assert.strictEqual(inv.data.cgst_paisa, 18750);       // Rs 187.50
  assert.strictEqual(inv.data.sgst_paisa, 18750);       // Rs 187.50
  assert.strictEqual(inv.data.igst_paisa, 0);
  assert.strictEqual(inv.data.total_paisa, 787500);     // Rs 7,875
  assert.strictEqual((await call('/dispatch', 'POST', { invoiceId: 1 }, admin)).status, 200);
  assert.strictEqual(getBalance(MURUKKU), 88);
});

test('step 6: Salesman B orders 120 for Distributor B -> shortage of 32 flagged', async () => {
  const o = await call('/orders', 'POST', { customerId: custId('Distributor B'), lines: [{ itemId: MURUKKU, qty: 120 }] }, salB);
  bOrderId = o.data.orderId;
  const d = (await call(`/orders/${bOrderId}`, 'GET', null, admin)).data;
  assert.strictEqual(d.stockCheck.ok, false);
  assert.strictEqual(d.stockCheck.lines[0].shortage, 32);
  const blocked = await call(`/orders/${bOrderId}/approve`, 'POST', {}, admin);
  assert.strictEqual(blocked.status, 409);
});

test('step 6: IGST applies if invoiced (order trimmed to the 88 in stock)', async () => {
  await call(`/orders/${bOrderId}`, 'PUT', { lines: [{ itemId: MURUKKU, qty: 88 }] }, admin);
  await call(`/orders/${bOrderId}/approve`, 'POST', {}, admin);
  const inv = await call('/invoices', 'POST', { orderId: bOrderId }, admin);
  assert.strictEqual(inv.data.cgst_paisa, 0);
  assert.strictEqual(inv.data.sgst_paisa, 0);
  assert.strictEqual(inv.data.igst_paisa, 22000);
});

test('step 7: Retailer A pays Rs 4,000 -> outstanding Rs 3,875', async () => {
  const r = await call('/payments', 'POST', { invoiceId: 1, amountRupees: 4000, mode: 'UPI' }, admin);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.data.outstanding_paisa, 387500);
  const inv = (await call('/invoices/1', 'GET', null, admin)).data;
  assert.strictEqual(inv.outstanding_paisa, 387500);
});

test('payments: overpaying, zero and salesman are rejected', async () => {
  assert.strictEqual((await call('/payments', 'POST', { invoiceId: 1, amountRupees: 9999 }, admin)).status, 400);
  assert.strictEqual((await call('/payments', 'POST', { invoiceId: 1, amountRupees: 0 }, admin)).status, 400);
  assert.strictEqual((await call('/payments', 'POST', { invoiceId: 1, amountRupees: 10 }, salA)).status, 403);
  assert.strictEqual((await call('/invoices/1', 'GET', null, admin)).data.outstanding_paisa, 387500); // unchanged
});

test('step 8: labour Rs 1,200 + gas Rs 600 -> cost per packet Rs 31.14 (weighted average)', async () => {
  const r = await call('/production/1/overheads', 'POST', { labourRupees: 1200, powerRupees: 600 }, prod);
  assert.strictEqual(r.data.material_paisa, 405500);
  assert.strictEqual(r.data.total_paisa, 585500);
  assert.strictEqual(r.data.cost_per_packet_paisa, 3114);
  assert.strictEqual(r.data.profit_per_packet_paisa, 1886);
});

test('audit: every stock movement has a source document and balances reconcile', () => {
  const missing = db.prepare("SELECT COUNT(*) AS n FROM stock_ledger WHERE source_doc IS NULL OR source_doc = ''").get().n;
  assert.strictEqual(missing, 0);
  // opening + receipts - issues = closing, for every item
  for (const it of db.prepare('SELECT id FROM items').all()) {
    const sum = db.prepare('SELECT COALESCE(SUM(change_qty), 0) AS s FROM stock_ledger WHERE item_id = ?').get(it.id).s;
    assert.strictEqual(sum, getBalance(it.id));
  }
});

