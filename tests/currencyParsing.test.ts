import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseLocalizedNonNegativeDecimal,
  parseNonNegativeMoney,
  parseNonNegativeUnitCost,
} from '../src/domain/services/currencyCatalog.ts';

test('monetary grouped formats are interpreted without losing thousands', () => {
  assert.equal(parseNonNegativeMoney('1.250,50', 'USD'), 1250.5);
  assert.equal(parseNonNegativeMoney('1,250.50', 'USD'), 1250.5);
  assert.equal(parseNonNegativeMoney('1.250.000', 'COP'), 1250000);
  assert.equal(parseNonNegativeMoney('15.000', 'COP'), 15000);
  assert.equal(parseNonNegativeMoney('12,50', 'COP'), 13);
  assert.equal(parseNonNegativeUnitCost('1.250,50', 'COP'), 1250.5);
  assert.equal(parseNonNegativeMoney('0,99', 'USD'), 0.99);
});

test('ambiguous or malformed grouped values are rejected by strict parser', () => {
  assert.equal(parseLocalizedNonNegativeDecimal('1.250', 2), null);
  assert.equal(parseLocalizedNonNegativeDecimal('1,250', 2), null);
  assert.equal(parseLocalizedNonNegativeDecimal('1.25.00', 2), null);
  assert.equal(parseLocalizedNonNegativeDecimal('1.250,500', 2), null);
  assert.equal(parseLocalizedNonNegativeDecimal('-2', 2), null);
});
