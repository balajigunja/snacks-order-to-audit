import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

process.env.DB_FILE = ':memory:';
const { default: db } = await import('../src/db/connection.js');
db.exec(fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
const { addEntry } = await import('../src/services/stockLedger.js');
const { issueValue, costPerPacket, margin } = await import('../src/services/costing.js');
const { variancePctX100, isFlagged } = await import('../src/services/variance.js');

test('yield variance 188 vs 200 is -6% and flagged', () => {
  assert.strictEqual(variancePctX100(188, 200), -600);
  assert.strictEqual(isFlagged(-600), true);
});

test('oil 10.5 L vs 10 L is +5% and flagged', () => {
  assert.strictEqual(variancePctX100(10500, 10000), 500);
  assert.strictEqual(isFlagged(500), true);
});

test('exactly 3% is NOT flagged, 3.1% is', () => {
  assert.strictEqual(isFlagged(variancePctX100(194, 200)), false); // pouches -3%
  assert.strictEqual(isFlagged(310), true);
});

test('weighted average flour: 40 kg issued costs Rs 1,725', () => {
  db.prepare("INSERT INTO items (name, category, base_unit) VALUES ('Flour','RAW','g')").run();
  addEntry({ itemId: 1, changeQty: 100000, valuePaisa: 420000, entryType: 'OPENING', sourceDoc: 'Opening' });
  addEntry({ itemId: 1, changeQty: 60000, valuePaisa: 270000, entryType: 'PURCHASE', sourceDoc: 'Purchase #1' });
  assert.strictEqual(issueValue(1, 40000), 172500);
});

test('benchmark cost per packet is Rs 31.14, margin about 37.7%', () => {
  const r = costPerPacket({ materialPaisa: 405500, labourPaisa: 120000, powerPaisa: 60000, goodPackets: 188 });
  assert.strictEqual(r.totalPaisa, 585500);
  assert.strictEqual(r.perPacketPaisa, 3114);
  assert.strictEqual(margin(5000, 3114).profitPaisa, 1886);
});