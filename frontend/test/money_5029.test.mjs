/** D5029 — the shared money layer: exponents, exact parsing, exact formatting, refusals. */
import test from 'node:test';
import assert from 'node:assert/strict';
const plain = (s) => s && s.replace(/\u00a0/g, ' ');
import { CURRENCY_CODES, currencyCode, exponentOf, formatMinor, parseMinor, toMajorString, toMinorSafe } from '../src/lib/money.js';

const ok = (text, code) => { const r = parseMinor(text, code); assert.equal(r.ok, true, `${text} ${code}: ${r.message}`); return r.minor; };
const refused = (text, code, reason, opts) => { const r = parseMinor(text, code, opts); assert.equal(r.ok, false, `${text} ${code} should be refused`); assert.equal(r.reason, reason); return r; };

test('exponents: 2 for EUR and USD, 0 for JPY and KRW, 3 for KWD and BHD, null for what is not a currency', () => {
  assert.deepEqual(['EUR', 'USD', 'GBP'].map(exponentOf), [2, 2, 2]);
  assert.deepEqual(['JPY', 'KRW', 'VND', 'ISK'].map(exponentOf), [0, 0, 0, 0]);
  assert.deepEqual(['KWD', 'BHD', 'OMR', 'TND'].map(exponentOf), [3, 3, 3, 3]);
  for (const bad of ['ABC', 'eur', 'EU', '', null, undefined, 978, 'XAU', 'XXX']) assert.equal(exponentOf(bad), null, String(bad));
  assert.equal(currencyCode('EUR'), 'EUR');
  assert.equal(currencyCode(' EUR'), null, 'padding is not repaired');
  // Every listed currency has an exponent; the list has no duplicates.
  assert.equal(new Set(CURRENCY_CODES).size, CURRENCY_CODES.length);
  for (const c of CURRENCY_CODES) assert.ok([0, 2, 3].includes(exponentOf(c)), c);
});

test('parse: EUR and USD are hundredths, JPY and KRW are never multiplied, KWD and BHD keep three decimals', () => {
  assert.equal(ok('1234.56', 'EUR'), 123456);
  assert.equal(ok('19.99', 'USD'), 1999, 'the float 19.99 * 100 is 1998.9999999999998');
  assert.equal(ok('1.005', 'KWD'), 1005);
  assert.equal(ok('1234', 'JPY'), 1234, 'JPY input is not multiplied by 100');
  assert.equal(ok('5000', 'KRW'), 5000);
  assert.equal(ok('0.001', 'BHD'), 1);
  assert.equal(ok('12.5', 'EUR'), 1250);
  assert.equal(ok('12', 'EUR'), 1200);
  assert.equal(ok('.5', 'EUR'), 50, 'a leading point is read');
  assert.equal(ok('12.', 'EUR'), 1200);
  assert.equal(ok('  42  ', 'EUR'), 4200);
  assert.equal(ok('007.10', 'EUR'), 710);
});

test('parse: float traps are exact', () => {
  assert.equal(ok('1.15', 'EUR'), 115); // 1.15 * 100 = 114.99999999999999
  assert.equal(ok('8.2', 'EUR'), 820);
  assert.equal(ok('0.29', 'USD'), 29); // 0.29 * 100 = 28.999999999999996
  assert.equal(ok('4.35', 'EUR'), 435);
  assert.equal(ok('1.255', 'KWD'), 1255);
});

test('parse: too many decimals is refused, never rounded; trailing zeros are not decimals', () => {
  refused('10.005', 'EUR', 'decimals');
  refused('1.5', 'JPY', 'decimals');
  refused('0.0001', 'KWD', 'decimals');
  refused('1.2345', 'BHD', 'decimals');
  assert.equal(ok('10.50', 'EUR'), 1050);
  assert.equal(ok('10.000', 'EUR'), 1000, 'trailing zeros carry no value');
  assert.equal(ok('1500.0', 'JPY'), 1500);
  assert.match(refused('1.5', 'JPY', 'decimals').message, /no minor unit/);
});

test('parse: zero, empty, signs and shapes', () => {
  assert.equal(ok('0', 'EUR'), 0);
  assert.equal(ok('0.00', 'EUR'), 0);
  assert.equal(ok('0', 'JPY'), 0);
  refused('', 'EUR', 'empty'); refused('   ', 'EUR', 'empty'); refused(null, 'EUR', 'empty'); refused(undefined, 'EUR', 'empty');
  refused('-1', 'EUR', 'negative');
  assert.equal(parseMinor('-1.50', 'EUR', { allowNegative: true }).minor, -150);
  for (const bad of ['abc', '1e3', '1..2', '1.2.3', '$5', '5 EUR', '0x10', 'Infinity', 'NaN', '+5']) refused(bad, 'EUR', 'format');
});

test('parse: thousands commas only in their plain grouping; European style is refused, not guessed', () => {
  assert.equal(ok('1,234.56', 'EUR'), 123456);
  assert.equal(ok('1,234,567', 'JPY'), 1234567);
  assert.match(refused('1.234,56', 'EUR', 'format').message, /point for the decimals/);
  refused('12,5', 'EUR', 'format');
  refused('1,23,456', 'EUR', 'format');
  refused(',5', 'EUR', 'format');
});

test('parse: an unknown or missing currency is refused, not guessed', () => {
  refused('10', 'ABC', 'currency'); refused('10', undefined, 'currency'); refused('10', '', 'currency'); refused('10', 'eur', 'currency');
});

test('parse: the largest safe integer of minor units is the boundary', () => {
  assert.equal(ok('90071992547409.91', 'EUR'), Number.MAX_SAFE_INTEGER, '9007199254740991 minor units exactly');
  refused('90071992547409.92', 'EUR', 'range');
  assert.equal(ok('9007199254740991', 'JPY'), Number.MAX_SAFE_INTEGER);
  refused('9007199254740992', 'JPY', 'range');
  refused('9007199254740.992', 'KWD', 'range');
  refused('99999999999999999999', 'JPY', 'range');
});

test('format: EUR 1,234.56 is never 1,235; JPY and KWD show their own decimals', () => {
  assert.equal(formatMinor(123456, 'EUR', { locale: 'en-US' }), '€1,234.56');
  assert.equal(formatMinor(123456, 'USD', { locale: 'en-US' }), '$1,234.56');
  assert.equal(formatMinor(100, 'EUR', { locale: 'en-US' }), '€1.00', 'whole euros keep their cents');
  assert.equal(formatMinor(1235, 'JPY', { locale: 'en-US' }), '¥1,235');
  assert.equal(formatMinor(5000, 'KRW', { locale: 'en-US' }), '₩5,000');
  assert.equal(plain(formatMinor(1235, 'KWD', { locale: 'en-US' })), 'KWD 1.235');
  assert.equal(plain(formatMinor(1, 'BHD', { locale: 'en-US' })), 'BHD 0.001');
  assert.equal(formatMinor(0, 'EUR', { locale: 'en-US' }), '€0.00');
  assert.equal(formatMinor(-250, 'EUR', { locale: 'en-US' }), '-€2.50');
});

test('format: exact at the safe boundary, and refuses what it cannot show truly', () => {
  assert.equal(formatMinor(Number.MAX_SAFE_INTEGER, 'EUR', { locale: 'en-US' }), '€90,071,992,547,409.91');
  assert.equal(formatMinor('123456', 'EUR', { locale: 'en-US' }), '€1,234.56', 'a digit string is an integer too');
  for (const bad of [null, undefined, '', 'x', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '12.5']) assert.equal(formatMinor(bad, 'EUR'), null, String(bad));
  for (const code of [undefined, null, '', 'ABC', 'eur']) assert.equal(formatMinor(100, code), null, `no currency is never a guessed EUR: ${code}`);
});

test('round trips: format(parse(x)) and toMajorString(parse(x)) return what went in, for every exponent', () => {
  const cases = [['EUR', ['0', '0.01', '1234.56', '99999.99']], ['JPY', ['0', '1', '1234567']], ['KWD', ['0', '0.001', '1.005', '12345.678']], ['BHD', ['0.5', '3.250']]];
  for (const [code, values] of cases) {
    for (const v of values) {
      const minor = ok(v, code);
      const major = toMajorString(minor, code);
      assert.equal(ok(major, code), minor, `${v} ${code}`);
      assert.equal(parseMinor(formatMinor(minor, code, { locale: 'en-US' }).replace(/[^\d.]/g, ''), code).minor, minor, `${v} ${code} through the formatted text`);
    }
  }
  assert.equal(toMajorString(123456, 'EUR'), '1234.56');
  assert.equal(toMajorString(5, 'EUR'), '0.05');
  assert.equal(toMajorString(5, 'KWD'), '0.005');
  assert.equal(toMajorString(1234, 'JPY'), '1234');
  assert.equal(toMajorString(100, 'ABC'), null);
  assert.equal(toMajorString(1.5, 'EUR'), null);
});

test('every listed currency parses and formats a one-unit amount at its own exponent', () => {
  for (const code of CURRENCY_CODES) {
    const exp = exponentOf(code);
    const minor = ok('1', code);
    assert.equal(minor, 10 ** exp, code);
    assert.ok(formatMinor(minor, code, { locale: 'en-US' }), code);
  }
});

test('toMinorSafe takes only safe non-negative integers', () => {
  assert.equal(toMinorSafe(0), 0);
  assert.equal(toMinorSafe(123456), 123456);
  assert.equal(toMinorSafe('123456'), 123456);
  for (const bad of [-1, 1.5, NaN, Infinity, null, undefined, '', '1.5', '-1', Number.MAX_SAFE_INTEGER + 1, '99999999999999999']) assert.equal(toMinorSafe(bad), null, String(bad));
});
