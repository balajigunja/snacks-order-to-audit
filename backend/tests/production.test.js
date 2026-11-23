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
const id = (name) => db.prepare('SELECT id FROM items WHERE name = ?').get(name).id;
const FLOUR = id('Flour'), OIL = id('Cooking oil'), SPICE = id('Salt and spice mix');
const POUCH = id('200 g pouch'), CARTON = id('Carton (20 packets)'), MURUKKU = id('Murukku 200 g');

let token;
test('setup: login + buy 60 kg flour (step 1)', async () => {
  token = (await call('/auth/login', 'POST', { email: 'production@snacks.test', password: 'password123' })).data.token;
  const r = await call('/purchases', 'POST', { lines: [{ itemId: FLOUR, qty: 60, unit: 'kg', rate: 45 }] }, token);
  assert.strictEqual(r.status, 201);
});

test('not enough stock: whole run is rolled back', async () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM production_runs').get().n;
  const r = await call('/production/start', 'POST',
    { bomId: 1, issued: [{ itemId: OIL, qty: 5, unit: 'litre' }, { itemId: FLOUR, qty: 999, unit: 'kg' }] }, token);
  assert.strictEqual(r.status, 400);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM production_runs').get().n, before);
  assert.strictEqual(getBalance(OIL), 30000); // the oil issue was undone too
});

test('step 2: start run, issue 40 kg flour, 10.5 L oil, 1.2 kg spice', async () => {
  const r = await call('/production/start', 'POST', { bomId: 1, issued: [
    { itemId: FLOUR, qty: 40, unit: 'kg' }, { itemId: OIL, qty: 10.5, unit: 'litre' }, { itemId: SPICE, qty: 1.2, unit: 'kg' }
  ] }, token);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.data.expected_output, 200);
  assert.deepStrictEqual(r.data.flags.map((f) => f.what), ['Cooking oil']); // +5%
  assert.strictEqual(getBalance(FLOUR), 120000);
  assert.strictEqual(getBalance(OIL), 19500);
  assert.strictEqual(getBalance(SPICE), 3800);
});

test('step 3: 188 good packets, 6 damaged pouches, 9 cartons', async () => {
  const r = await call('/production/1/complete', 'POST', {
    goodPackets: 188, damagedPouches: 6,
    packaging: [{ itemId: POUCH, qty: 194, unit: 'pcs' }, { itemId: CARTON, qty: 9, unit: 'pcs' }]
  }, token);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.yield_variance_pct_x100, -600);
  assert.strictEqual(r.data.material_cost_paisa, 405500);
  assert.strictEqual(getBalance(POUCH), 306);
  assert.strictEqual(getBalance(CARTON), 21);
  assert.strictEqual(getBalance(MURUKKU), 238);
  const flagged = r.data.flags.map((f) => f.what).sort();
  assert.ok(flagged.includes('Yield') && flagged.includes('Cooking oil'));
});

test('cannot complete the same run twice', async () => {
  const r = await call('/production/1/complete', 'POST', { goodPackets: 1 }, token);
  assert.strictEqual(r.status, 400);
});

test('step 8: overheads Rs 1,200 + Rs 600 -> Rs 31.14 per packet', async () => {
  const r = await call('/production/1/overheads', 'POST', { labourRupees: 1200, powerRupees: 600 }, token);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.total_paisa, 585500);
  assert.strictEqual(r.data.cost_per_packet_paisa, 3114);
  assert.strictEqual(r.data.profit_per_packet_paisa, 1886);
  const log = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE record_id = 1").get().n;
  assert.ok(log >= 3); // started, completed, overheads
});

test('salesman cannot start a run', async () => {
  const t = (await call('/auth/login', 'POST', { email: 'salesman.a@snacks.test', password: 'password123' })).data.token;
  assert.strictEqual((await call('/production/start', 'POST', {}, t)).status, 403);
});