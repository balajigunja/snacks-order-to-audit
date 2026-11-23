import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

process.env.DB_FILE = ':memory:';
const { default: db } = await import('../src/db/connection.js');
db.exec(fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
await import('../src/db/seed_benchmark.js');
const { default: app } = await import('../src/app.js');
const { getBalance } = await import('../src/services/stockLedger.js');
const { toCsv } = await import('../src/services/csv.js');

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
test.after(() => server.close());

async function call(path, method = 'GET', body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, type, data: type.includes('json') ? await res.json() : await res.text() };
}
const login = async (email) => (await call('/auth/login', 'POST', { email, password: 'password123' })).data.token;
const itemId = (name) => db.prepare('SELECT id FROM items WHERE name = ?').get(name).id;
const custId = (name) => db.prepare('SELECT id FROM customers WHERE name = ?').get(name).id;
const FLOUR = itemId('Flour'), OIL = itemId('Cooking oil'), SPICE = itemId('Salt and spice mix');
const POUCH = itemId('200 g pouch'), CARTON = itemId('Carton (20 packets)'), MURUKKU = itemId('Murukku 200 g');

let prod, admin, salA, acct;
const rep = async (name, token = acct, qs = '') => (await call(`/reports/${name}${qs}`, 'GET', null, token)).data;
const rowOf = (r, key, value) => r.rows.find((x) => x[key] === value);

test('setup: run the benchmark so the reports have data', async () => {
  [prod, admin, salA, acct] = await Promise.all([
    login('production@snacks.test'), login('admin@snacks.test'), login('salesman.a@snacks.test'), login('accountant@snacks.test')
  ]);
  const salB = await login('salesman.b@snacks.test');
  await call('/purchases', 'POST', { supplier: 'Local mill', lines: [{ itemId: FLOUR, qty: 60, unit: 'kg', rate: 45 }] }, prod);
  await call('/production/start', 'POST', { bomId: 1, issued: [
    { itemId: FLOUR, qty: 40, unit: 'kg' }, { itemId: OIL, qty: 10.5, unit: 'litre' }, { itemId: SPICE, qty: 1.2, unit: 'kg' }] }, prod);
  await call('/production/1/complete', 'POST', { goodPackets: 188, damagedPouches: 6, packaging: [
    { itemId: POUCH, qty: 194, unit: 'pcs' }, { itemId: CARTON, qty: 9, unit: 'pcs' }] }, prod);
  await call('/production/1/overheads', 'POST', { labourRupees: 1200, powerRupees: 600 }, prod);
  await call('/orders', 'POST', { customerId: custId('Retailer A'), lines: [{ itemId: MURUKKU, qty: 150 }] }, salA);
  await call('/orders/1/approve', 'POST', {}, admin);
  await call('/invoices', 'POST', { orderId: 1 }, admin);
  await call('/dispatch', 'POST', { invoiceId: 1 }, admin);
  await call('/orders', 'POST', { customerId: custId('Distributor B'), lines: [{ itemId: MURUKKU, qty: 88 }] }, salB);
  await call('/orders/2/approve', 'POST', {}, admin);
  await call('/invoices', 'POST', { orderId: 2 }, admin);
  await call('/payments', 'POST', { invoiceId: 1, amountRupees: 4000, mode: 'UPI' }, admin);
  assert.strictEqual(getBalance(MURUKKU), 88);
});

test('sales register: both invoices and a total row', async () => {
  const r = await rep('sales-register');
  assert.strictEqual(r.rows.length, 3);
  const a = r.rows[0];
  assert.deepStrictEqual([a.taxable, a.cgst, a.sgst, a.igst, a.total], ['7500.00', '187.50', '187.50', '0.00', '7875.00']);
  assert.strictEqual(r.rows[1].igst, '220.00');
  const total = rowOf(r, 'invoice_no', 'TOTAL (posted)');
  assert.deepStrictEqual([total.taxable, total.total], ['11900.00', '12495.00']);
});

test('date filter: an empty period gives no rows', async () => {
  const r = await rep('sales-register', acct, '?from=2000-01-01&to=2000-01-31');
  assert.strictEqual(r.rows.length, 0);
  assert.strictEqual((await call('/reports/sales-register?from=2026-13-99x&to=2026-01-01', 'GET', null, acct)).status, 400);
  assert.strictEqual((await call('/reports/sales-register?from=2026-02-01&to=2026-01-01', 'GET', null, acct)).status, 400);
});

test('customer-wise and product-wise sales', async () => {
  const c = await rep('sales-by-customer');
  assert.strictEqual(rowOf(c, 'customer', 'Retailer A').total, '7875.00');
  const p = await rep('sales-by-product');
  assert.strictEqual(p.rows[0].qty, 238); // 150 + 88
});

test('a salesman sees only his own customers, and no other report', async () => {
  const c = await rep('sales-by-customer', salA);
  assert.deepStrictEqual(c.rows.map((r) => r.customer), ['Retailer A']);
  assert.strictEqual((await call('/reports/sales-register', 'GET', null, salA)).status, 403);
  const list = (await call('/reports', 'GET', null, salA)).data;
  assert.deepStrictEqual(list.map((r) => r.name), ['sales-by-customer']);
});

test('purchase register: 60 kg at Rs 45 = Rs 2,700', async () => {
  const r = await rep('purchase-register');
  assert.deepStrictEqual([r.rows[0].qty, r.rows[0].unit, r.rows[0].rate, r.rows[0].amount], [60, 'kg', '45.00', '2700.00']);
});

test('stock summary: opening + receipts - issues = closing, and matches the ledger', async () => {
  const r = await rep('stock-summary');
  const flour = rowOf(r, 'item', 'Flour');
  assert.deepStrictEqual([flour.opening, flour.receipts, flour.issues, flour.closing, flour.unit], [100, 60, 40, 120, 'kg']);
  assert.strictEqual(flour.value, '5175.00'); // 4,200 + 2,700 - 1,725
  const oil = rowOf(r, 'item', 'Cooking oil');
  assert.deepStrictEqual([oil.issues, oil.closing, oil.unit], [10.5, 19.5, 'L']);
  const fg = rowOf(r, 'item', 'Murukku 200 g');
  assert.deepStrictEqual([fg.opening, fg.receipts, fg.issues, fg.closing], [50, 188, 150, 88]);
  for (const it of db.prepare('SELECT id, name, base_unit FROM items').all()) {
    const row = rowOf(r, 'item', it.name);
    const shown = it.base_unit === 'pcs' ? getBalance(it.id) : getBalance(it.id) / 1000;
    assert.strictEqual(row.closing, shown);
    assert.strictEqual(row.opening + row.receipts - row.issues + row.adjustments, row.closing);
  }
});

test('stock ledger: every movement traces to its source document', async () => {
  const r = await rep('stock-ledger', acct, `?item=${FLOUR}`);
  assert.deepStrictEqual(r.rows.map((x) => x.source), ['Opening balance', 'Purchase #1', 'Production Run #1']);
  assert.deepStrictEqual(r.rows.map((x) => x.balance), [100, 160, 120]);
  const raw = await rep('stock-ledger', acct, '?category=PACKAGING');
  assert.ok(raw.rows.every((x) => x.category === 'Packaging'));
});

test('production variance: yield -6% and oil +5% flagged', async () => {
  const r = await rep('production-variance');
  const y = rowOf(r, 'what', 'Yield (good packets)');
  assert.deepStrictEqual([y.planned, y.actual, y.variance, y.flagged], [200, 188, '-6.00%', 'YES']);
  const oil = rowOf(r, 'what', 'Cooking oil');
  assert.deepStrictEqual([oil.planned, oil.actual, oil.variance, oil.flagged], [10, 10.5, '5.00%', 'YES']);
});

test('cost per packet report: Rs 31.14 and margin', async () => {
  const r = await rep('production-cost');
  assert.deepStrictEqual([r.rows[0].total, r.rows[0].cost, r.rows[0].margin], ['5855.00', '31.14', '37.72%']);
});

test('collections and outstanding with ageing', async () => {
  const c = await rep('collections');
  assert.deepStrictEqual([c.rows[0].mode, c.rows[0].amount], ['UPI', '4000.00']);
  const o = await rep('outstanding');
  assert.strictEqual(rowOf(o, 'customer', 'Retailer A').d0_30, '3875.00');
  assert.strictEqual(rowOf(o, 'customer', 'Distributor B').d0_30, '4620.00');
  assert.strictEqual(rowOf(o, 'customer', 'TOTAL').total, '8495.00');
});

test('ageing puts old invoices in the right bucket', async () => {
  const od = await rep('outstanding', acct, '?to=2027-02-15'); // about 85-90 days later
  const d = db.prepare('SELECT date FROM invoices WHERE id = 1').get().date;
  const days = Math.floor((Date.parse('2027-02-15') - Date.parse(d)) / 86400000);
  const bucket = days <= 30 ? 'd0_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90';
  assert.strictEqual(rowOf(od, 'customer', 'Retailer A')[bucket], '3875.00');
  assert.strictEqual(od.rows.length > 0 && bucket !== 'd0_30', true);
});

test('GST reports: GSTR-1 invoices, HSN summary and GSTR-3B', async () => {
  const g1 = await rep('gstr1');
  assert.strictEqual(g1.rows.length, 2);
  assert.deepStrictEqual([g1.rows[0].type, g1.rows[0].gstin, g1.rows[0].rate], ['B2B', '33AAAAA1111A1Z1', 5]);
  const hsn = await rep('gstr1-hsn');
  assert.deepStrictEqual([hsn.rows[0].hsn, hsn.rows[0].qty, hsn.rows[0].taxable], ['21069099', 238, '11900.00']);
  const b = await rep('gstr3b');
  assert.deepStrictEqual([b.rows[0].taxable, b.rows[0].cgst, b.rows[0].sgst], ['7500.00', '187.50', '187.50']);
  assert.deepStrictEqual([b.rows[1].taxable, b.rows[1].igst], ['4400.00', '220.00']);
  assert.deepStrictEqual([b.rows[2].taxable, b.rows[2].igst, b.rows[2].cgst], ['11900.00', '220.00', '187.50']);
});

test('CSV export: a download Excel can open', async () => {
  const r = await call('/reports/sales-register?format=csv', 'GET', null, acct);
  assert.strictEqual(r.status, 200);
  assert.ok(r.type.includes('text/csv'));
  assert.ok(r.data.startsWith('Invoice no,Date,Customer')); // (fetch hides the BOM, checked below)
  assert.strictEqual(r.data.trim().split('\r\n').length, 4); // header + 2 invoices + total
  const raw = await fetch(base + '/reports/sales-register?format=csv', { headers: { Authorization: 'Bearer ' + acct } });
  const bytes = new Uint8Array(await raw.arrayBuffer());
  assert.deepStrictEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]); // BOM so Excel reads UTF-8
  assert.ok(raw.headers.get('content-disposition').includes('sales-register_'));
});

test('CSV escaping: commas, quotes and formulas are safe', () => {
  const csv = toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: 'Ravi, "Sons"', b: '=1+1' }, { a: '-5', b: '' }]);
  assert.strictEqual(csv, 'A,B\r\n"Ravi, ""Sons""",\'=1+1\r\n-5,\r\n');
});

test('production and owner can read what they need; unknown report is 404', async () => {
  assert.strictEqual((await call('/reports/stock-summary', 'GET', null, prod)).status, 200);
  assert.strictEqual((await call('/reports/sales-register', 'GET', null, prod)).status, 403);
  assert.strictEqual((await call('/reports/outstanding', 'GET', null, await login('owner@snacks.test'))).status, 200);
  assert.strictEqual((await call('/reports/nope', 'GET', null, acct)).status, 404);
});