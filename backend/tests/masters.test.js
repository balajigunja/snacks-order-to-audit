import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

process.env.DB_FILE = ':memory:';
const { default: db } = await import('../src/db/connection.js');
db.exec(fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
await import('../src/db/seed_benchmark.js');
const { default: app } = await import('../src/app.js');

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
test.after(() => server.close());

async function call(path, token) {
  const res = await fetch(base + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  return { status: res.status, data: await res.json() };
}
async function login(email) {
  const res = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' })
  });
  return (await res.json()).token;
}

test('recipes need a login', async () => {
  assert.strictEqual((await call('/masters/boms')).status, 401);
});

test('the Murukku recipe comes with its 5 lines in base units', async () => {
  const r = await call('/masters/boms', await login('production@snacks.test'));
  assert.strictEqual(r.data.length, 1);
  const b = r.data[0];
  assert.deepStrictEqual([b.product, b.batch_output_qty, b.lines.length], ['Murukku 200 g', 200, 5]);
  assert.deepStrictEqual([b.lines[0].name, b.lines[0].qty, b.lines[0].base_unit, b.lines[0].category], ['Flour', 40000, 'g', 'RAW']);
  assert.strictEqual(b.lines.filter((l) => l.category === 'PACKAGING').length, 2);
});

test('customers and products lists work', async () => {
  const t = await login('salesman.a@snacks.test');
  const names = (await call('/masters/customers', t)).data.map((c) => c.name);
   assert.ok(names.includes('Retailer A') && names.includes('Distributor B'));
  assert.deepStrictEqual((await call('/masters/products', t)).data.map((p) => p.price_paisa), [5000]);
});
