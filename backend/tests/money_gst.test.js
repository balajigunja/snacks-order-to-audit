import test from 'node:test';
import assert from 'node:assert';
import { calculateGst } from '../src/utils/gst.js';
import { toBase } from '../src/utils/units.js';

test('Tamil Nadu customer gets CGST + SGST', () => {
  const g = calculateGst(10000, 500, 'Tamil Nadu');
  assert.deepStrictEqual(g, { cgst: 250, sgst: 250, igst: 0, total: 500 });
});
test('Karnataka customer gets IGST', () => {
  assert.strictEqual(calculateGst(10000, 500, 'Karnataka').igst, 500);
});
test('40 kg = 40000 g', () => assert.strictEqual(toBase(40, 'kg'), 40000));
