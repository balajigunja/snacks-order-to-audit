import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

process.env.DB_FILE = ':memory:';
const { default: db } = await import('../src/db/connection.js');
db.exec(fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
await import('../src/db/seed_benchmark.js');
const { default: app } = await import('../src/app.js');
const { getBalance } = await import('../src/services/stockLedger.js');
const { getFinYear, todayIST } = await import('../src/utils/dates.js');

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
const MURUKKU = itemId('Murukku 200 g');

test('financial year runs April to March', () => {
  assert.strictEqual(getFinYear('2026-03-31'), '2025-26');
  assert.strictEqual(getFinYear('2026-04-01'), '2026-27');
  assert.strictEqual(getFinYear('2026-11-23'), '2026-27');
});

let prod, admin, salA, salB;
const FY = getFinYear(todayIST());

test('setup: finished goods = 238 and order 1 (Retailer A, 150) approved', async () => {
  [prod, admin, salA, salB] = await Promise.all([
    login('production@snacks.test'), login('admin@snacks.test'),
    login('salesman.a@snacks.test'), login('salesman.b@snacks.test')
  ]);
  await call('/purchases', 'POST', { lines: [{ itemId: itemId('Flour'), qty: 60, unit: 'kg', rate: 45 }] }, prod);
  await call('/production/start', 'POST', { bomId: 1, issued: [
    { itemId: itemId('Flour'), qty: 40, unit: 'kg' }, { itemId: itemId('Cooking oil'), qty: 10.5, unit: 'litre' },
    { itemId: itemId('Salt and spice mix'), qty: 1.2, unit: 'kg' }] }, prod);
  await call('/production/1/complete', 'POST', { goodPackets: 188, damagedPouches: 6, packaging: [
    { itemId: itemId('200 g pouch'), qty: 194, unit: 'pcs' }, { itemId: itemId('Carton (20 packets)'), qty: 9, unit: 'pcs' }] }, prod);
  await call('/orders', 'POST', { customerId: custId('Retailer A'), lines: [{ itemId: MURUKKU, qty: 150 }] }, salA);
  await call('/orders/1/approve', 'POST', {}, admin);
  assert.strictEqual(getBalance(MURUKKU), 238);
});

test('step 5: Retailer A (Tamil Nadu) invoice = 7,500 + 187.50 CGST + 187.50 SGST = 7,875', async () => {
  const r = await call('/invoices', 'POST', { orderId: 1 }, admin);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.data.invoiceNo, `INV/${FY}/0001`);
  assert.strictEqual(r.data.taxable_paisa, 750000);
  assert.strictEqual(r.data.cgst_paisa, 18750);
  assert.strictEqual(r.data.sgst_paisa, 18750);
  assert.strictEqual(r.data.igst_paisa, 0);
  assert.strictEqual(r.data.total_paisa, 787500);
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = 1').get().status, 'INVOICED');
  const line = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = 1').get();
  assert.strictEqual(line.hsn_code, '21069099');
});

test('an order cannot be invoiced twice, salesman cannot invoice', async () => {
  assert.strictEqual((await call('/invoices', 'POST', { orderId: 1 }, admin)).status, 400);
  assert.strictEqual((await call('/invoices', 'POST', { orderId: 1 }, salA)).status, 403);
});

test('step 5: dispatch takes finished goods from 238 to 88', async () => {
  const r = await call('/dispatch', 'POST', { invoiceId: 1 }, admin);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(getBalance(MURUKKU), 88);
  assert.strictEqual(db.prepare('SELECT status FROM orders WHERE id = 1').get().status, 'DISPATCHED');
  const row = db.prepare("SELECT * FROM stock_ledger WHERE entry_type = 'DISPATCH'").get();
  assert.strictEqual(row.source_doc, `Invoice INV/${FY}/0001`); // traceable to the invoice
  assert.strictEqual((await call('/dispatch', 'POST', { invoiceId: 1 }, admin)).status, 400); // not twice
});

test('step 6: Distributor B orders 120 -> 32 short; at 88 it gets IGST', async () => {
  const o = await call('/orders', 'POST', { customerId: custId('Distributor B'), lines: [{ itemId: MURUKKU, qty: 120 }] }, salB);
  const d = await call(`/orders/${o.data.orderId}`, 'GET', null, admin);
  assert.strictEqual(d.data.stockCheck.lines[0].shortage, 32);
  await call(`/orders/${o.data.orderId}`, 'PUT', { lines: [{ itemId: MURUKKU, qty: 88 }] }, admin);
  await call(`/orders/${o.data.orderId}/approve`, 'POST', {}, admin);
  const r = await call('/invoices', 'POST', { orderId: o.data.orderId }, admin);
  assert.strictEqual(r.data.invoiceNo, `INV/${FY}/0002`);
  assert.strictEqual(r.data.cgst_paisa, 0);
  assert.strictEqual(r.data.sgst_paisa, 0);
  assert.strictEqual(r.data.igst_paisa, 22000); // 5% of Rs 4,400
  assert.strictEqual(r.data.total_paisa, 462000);
});

test('invoice list shows outstanding', async () => {
  const list = await call('/invoices', 'GET', null, admin);
  assert.strictEqual(list.data[1].outstanding_paisa, 787500); // nothing paid yet
});