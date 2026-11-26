import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import jwt from 'jsonwebtoken';

process.env.DB_FILE = ':memory:';
const { default: db } = await import('../src/db/connection.js');
db.exec(fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
await import('../src/db/seed_benchmark.js');
const { default: app } = await import('../src/app.js');
const { amountInWords, invoiceFileName } = await import('../src/services/invoicePdf.js');
const { JWT_SECRET } = await import('../src/middleware/auth.js');

const server = app.listen(0);
const base = `http://localhost:${server.address().port}/api`;
test.after(() => server.close());

async function call(path, method = 'GET', body, token) {
  return fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}
const login = async (email) => (await (await call('/auth/login', 'POST', { email, password: 'password123' })).json()).token;
const itemId = (name) => db.prepare('SELECT id FROM items WHERE name = ?').get(name).id;

test('amount in words uses the Indian lakh / crore style', () => {
  assert.strictEqual(amountInWords(787500), 'Rupees Seven Thousand Eight Hundred Seventy Five Only');
  assert.strictEqual(amountInWords(1234567800), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
  assert.strictEqual(amountInWords(10050), 'Rupees One Hundred and Fifty Paise Only');
  assert.strictEqual(amountInWords(0), 'Rupees Zero Only');
});

test('the file name has no slashes', () => {
  assert.strictEqual(invoiceFileName('INV/2026-27/0001'), 'INV-2026-27-0001.pdf');
});

let admin, acct, sal;
test('setup: one invoice exists', async () => {
  const prod = await login('production@snacks.test');
  admin = await login('admin@snacks.test'); acct = await login('accountant@snacks.test'); sal = await login('salesman.a@snacks.test');
  await call('/purchases', 'POST', { lines: [{ itemId: itemId('Flour'), qty: 60, unit: 'kg', rate: 45 }] }, prod);
  await call('/production/start', 'POST', { bomId: 1, issued: [
    { itemId: itemId('Flour'), qty: 40, unit: 'kg' }, { itemId: itemId('Cooking oil'), qty: 10.5, unit: 'litre' },
    { itemId: itemId('Salt and spice mix'), qty: 1.2, unit: 'kg' }] }, prod);
  await call('/production/1/complete', 'POST', { goodPackets: 188, damagedPouches: 6, packaging: [
    { itemId: itemId('200 g pouch'), qty: 194, unit: 'pcs' }, { itemId: itemId('Carton (20 packets)'), qty: 9, unit: 'pcs' }] }, prod);
  await call('/orders', 'POST', { customerId: 1, lines: [{ itemId: itemId('Murukku 200 g'), qty: 150 }] }, sal);
  await call('/orders/1/approve', 'POST', {}, admin);
  assert.strictEqual((await call('/invoices', 'POST', { orderId: 1 }, admin)).status, 201);
});

test('admin and accountant can download the PDF', async () => {
  for (const token of [admin, acct]) {
    const r = await call('/invoices/1/pdf', 'GET', null, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('content-type'), 'application/pdf');
    assert.ok(r.headers.get('content-disposition').includes('INV-'));
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.strictEqual(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(bytes.length > 1500);
  }
});

test('no login = 401, salesman = 403, missing invoice = 404', async () => {
  assert.strictEqual((await call('/invoices/1/pdf')).status, 401);
  assert.strictEqual((await call('/invoices/1/pdf', 'GET', null, sal)).status, 403);
  assert.strictEqual((await call('/invoices/99/pdf', 'GET', null, admin)).status, 404);
});

test('share links: WhatsApp, email and a PDF link that opens without login', async () => {
  const s = await (await call('/invoices/1/share', 'GET', null, admin)).json();
  assert.ok(s.whatsappUrl.startsWith('https://wa.me/?text='));
  assert.ok(decodeURIComponent(s.whatsappUrl).includes('INV/2026-27/0001'));
  assert.ok(s.message.includes('Rs. 7875.00'));
  assert.ok(s.emailUrl.startsWith('mailto:?subject='));
  assert.ok(s.pdfUrl.includes('/api/invoices/share/'));

  const open = await fetch(s.pdfUrl); // no token header: this is what the customer does
  assert.strictEqual(open.status, 200);
  assert.strictEqual(open.headers.get('content-type'), 'application/pdf');
  assert.strictEqual(Buffer.from(await open.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});

test('only the admin can make share links; bad, expired and login tokens do not open', async () => {
  assert.strictEqual((await call('/invoices/1/share', 'GET', null, acct)).status, 403);
  assert.strictEqual((await call('/invoices/share/not-a-token')).status, 404);
  assert.strictEqual((await call('/invoices/share/' + admin)).status, 404); // a login token is not a share token
  const expired = jwt.sign({ invoiceId: 1, purpose: 'invoice-share' }, JWT_SECRET, { expiresIn: -10 });
  assert.strictEqual((await call('/invoices/share/' + expired)).status, 404);
});
