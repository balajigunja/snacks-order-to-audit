import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

process.env.DB_FILE = ':memory:';
const { default: db } = await import('../src/db/connection.js');
db.exec(fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
await import('../src/db/seed_benchmark.js'); // loads the Section 5 data
const { default: app } = await import('../src/app.js');

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
const flourId = () => db.prepare("SELECT id FROM items WHERE name = 'Flour'").get().id;

test('wrong password is rejected', async () => {
  const r = await call('/auth/login', 'POST', { email: 'admin@snacks.test', password: 'nope' });
  assert.strictEqual(r.status, 401);
});

test('no token = 401, salesman = 403', async () => {
  assert.strictEqual((await call('/purchases', 'GET')).status, 401);
  const t = await login('salesman.a@snacks.test');
  assert.strictEqual((await call('/purchases', 'POST', { lines: [] }, t)).status, 403);
});

test('benchmark step 1: buy 60 kg flour at Rs 45/kg -> 160 kg', async () => {
  const t = await login('production@snacks.test');
  const r = await call('/purchases', 'POST',
    { supplier: 'Local mill', lines: [{ itemId: flourId(), qty: 60, unit: 'kg', rate: 45 }] }, t);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.data.lines[0].balance, 160000);     // 160 kg in grams
  assert.strictEqual(r.data.lines[0].total_paisa, 270000); // Rs 2,700
  const row = db.prepare("SELECT * FROM stock_ledger WHERE source_doc = 'Purchase #1'").get();
  assert.strictEqual(row.entry_type, 'PURCHASE');
});

test('wrong unit for an item is rejected and nothing is saved', async () => {
  const t = await login('production@snacks.test');
  const before = db.prepare('SELECT COUNT(*) AS n FROM purchases').get().n;
  const r = await call('/purchases', 'POST', { lines: [{ itemId: flourId(), qty: 5, unit: 'litre', rate: 40 }] }, t);
  assert.strictEqual(r.status, 400);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM purchases').get().n, before); // rolled back
});