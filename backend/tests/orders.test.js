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
const MURUKKU = itemId('Murukku 200 g');

let prod, admin, salA, salB;

test('setup: make 188 packets so finished goods = 238 (steps 1-3)', async () => {
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
  assert.strictEqual(getBalance(MURUKKU), 238);
});

test('step 4: Salesman A orders 150 for Retailer A, price auto-filled', async () => {
  const r = await call('/orders', 'POST',
    { customerId: custId('Retailer A'), clientUuid: 'phone-123', lines: [{ itemId: MURUKKU, qty: 150 }] }, salA);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.data.status, 'SUBMITTED');
  assert.strictEqual(r.data.total_paisa, 750000); // 150 x Rs 50
});

test('sending the same offline order again does not duplicate it', async () => {
  const r = await call('/orders', 'POST',
    { customerId: custId('Retailer A'), clientUuid: 'phone-123', lines: [{ itemId: MURUKKU, qty: 150 }] }, salA);
  assert.strictEqual(r.data.duplicate, true);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
});

test('step 5: admin sees stock is enough and approves', async () => {
  const d = await call('/orders/1', 'GET', null, admin);
  assert.strictEqual(d.data.stockCheck.ok, true);
  const r = await call('/orders/1/approve', 'POST', {}, admin);
  assert.strictEqual(r.data.status, 'APPROVED');
});

test('step 6: Salesman B orders 120 -> shortage of 32 flagged, approval blocked', async () => {
  const o = await call('/orders', 'POST', { customerId: custId('Distributor B'), lines: [{ itemId: MURUKKU, qty: 120 }] }, salB);
  assert.strictEqual(o.data.orderId, 2);
  const d = await call('/orders/2', 'GET', null, admin);
  assert.strictEqual(d.data.stockCheck.lines[0].available, 88);  // 238 - 150 promised to Retailer A
  assert.strictEqual(d.data.stockCheck.lines[0].shortage, 32);
  const r = await call('/orders/2/approve', 'POST', {}, admin);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.data.stockCheck.lines[0].shortage, 32);
});

test('admin edits qty to 88 (logged), then approval works', async () => {
  const e = await call('/orders/2', 'PUT', { lines: [{ itemId: MURUKKU, qty: 88 }] }, admin);
  assert.strictEqual(e.data.total_paisa, 440000);
  const log = db.prepare("SELECT * FROM audit_log WHERE action = 'ORDER_EDITED' AND record_id = 2").get();
  assert.ok(log.old_value.includes('120') && log.new_value.includes('88'));
  assert.strictEqual((await call('/orders/2/approve', 'POST', {}, admin)).data.status, 'APPROVED');
});

test('salesman sees only his own orders', async () => {
  assert.deepStrictEqual((await call('/orders', 'GET', null, salA)).data.map((o) => o.id), [1]);
  assert.strictEqual((await call('/orders/2', 'GET', null, salA)).status, 404);
  assert.strictEqual((await call('/orders', 'GET', null, admin)).data.length, 2);
});

test('guards: salesman cannot approve, bad lines are rejected', async () => {
  assert.strictEqual((await call('/orders/1/approve', 'POST', {}, salA)).status, 403);
  const raw = await call('/orders', 'POST', { customerId: 1, lines: [{ itemId: itemId('Flour'), qty: 5 }] }, salA);
  assert.strictEqual(raw.status, 400);
  const zero = await call('/orders', 'POST', { customerId: 1, lines: [{ itemId: MURUKKU, qty: 0 }] }, salA);
  assert.strictEqual(zero.status, 400);
});

test('reject needs a reason and cancels the order', async () => {
  const o = await call('/orders', 'POST', { customerId: 1, lines: [{ itemId: MURUKKU, qty: 5 }] }, salA);
  assert.strictEqual((await call(`/orders/${o.data.orderId}/reject`, 'POST', {}, admin)).status, 400);
  const r = await call(`/orders/${o.data.orderId}/reject`, 'POST', { reason: 'Credit limit' }, admin);
  assert.strictEqual(r.data.status, 'CANCELLED');
});