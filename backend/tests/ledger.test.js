import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

process.env.DB_FILE = ':memory:'; // throwaway database for this test
const { default: db } = await import('../src/db/connection.js');
db.exec(fs.readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8'));
const { addEntry, getBalance, getLedger } = await import('../src/services/stockLedger.js');

db.prepare("INSERT INTO items (name, category, base_unit) VALUES ('Flour','RAW','g')").run();
const FLOUR = 1;

test('opening + purchase + issue gives correct balance', () => {
  addEntry({ itemId: FLOUR, changeQty: 100000, valuePaisa: 420000, entryType: 'OPENING', sourceDoc: 'Opening' });
  addEntry({ itemId: FLOUR, changeQty: 60000, valuePaisa: 270000, entryType: 'PURCHASE', sourceDoc: 'Purchase #1' });
  addEntry({ itemId: FLOUR, changeQty: -40000, valuePaisa: -172500, entryType: 'PRODUCTION_ISSUE', sourceDoc: 'Production Run #1' });
  assert.strictEqual(getBalance(FLOUR), 120000); // 120 kg
  assert.strictEqual(getLedger(FLOUR).length, 3);
});

test('cannot issue more than available', () => {
  assert.throws(() => addEntry({ itemId: FLOUR, changeQty: -999999, entryType: 'DISPATCH', sourceDoc: 'X' }));
  assert.strictEqual(getBalance(FLOUR), 120000); // unchanged
});