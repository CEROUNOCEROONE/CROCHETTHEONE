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
  assert.equal(parseNonNegativeMoney('12,50', 'COP'), 12.5);
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

test('COP money preserves cents across parsing, storage units and display rounding', async () => {
  const { toMinorUnits, fromMinorUnits, roundCurrencyAmount, getMoneyInputStep } = await import('../src/domain/services/currencyCatalog.ts');
  assert.equal(parseNonNegativeMoney('39000,50', 'COP'), 39000.5);
  assert.equal(roundCurrencyAmount(39000.5, 'COP'), 39000.5);
  assert.equal(toMinorUnits(39000.5, 'COP'), 3900050);
  assert.equal(fromMinorUnits(3900050, 'COP'), 39000.5);
  assert.equal(getMoneyInputStep('COP'), '0.01');
  assert.equal(parseNonNegativeMoney('15.000', 'COP'), 15000);
});
