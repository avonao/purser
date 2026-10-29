import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertColorsInValue, findColors, formatNumber, parseColor, toLab } from '../src/color.js';

test('the reference vector matches Chrome', () => {
  assert.equal(toLab('oklch(71.57% 0.1797 33.51)'), 'lab(65.4459 53.8462 44.2739)');
});

test('white and black in every input syntax', () => {
  for (const w of ['#fff', '#ffffff', '#FFFFFFFF', 'white', 'rgb(255 255 255)', 'rgba(255, 255, 255, 1)', 'oklch(100% 0 0)', 'oklab(1 0 0)', 'hsl(0 0% 100%)', 'lab(100 0 0)', 'color(srgb 1 1 1)']) {
    assert.equal(toLab(w), 'lab(100 0 0)', w);
  }
  for (const b of ['#000', 'black', 'rgb(0 0 0)', 'oklch(0% 0 0)', 'hwb(0 0% 100%)']) assert.equal(toLab(b), 'lab(0 0 0)', b);
});

test('alpha is kept as "/ a" and dropped when opaque', () => {
  assert.equal(toLab('rgb(0 0 0 / 0.1)'), 'lab(0 0 0 / 0.1)');
  assert.equal(toLab('rgba(0, 0, 0, 50%)'), 'lab(0 0 0 / 0.5)');
  assert.equal(toLab('#00000080'), 'lab(0 0 0 / 0.502)');
  assert.equal(toLab('transparent'), 'lab(0 0 0 / 0)');
  assert.equal(toLab('oklch(100% 0 0 / 1)'), 'lab(100 0 0)');
});

test('known conversions', () => {
  // Reference values from the CSS Color 4 sample code (sRGB red / green / blue in D50 Lab).
  const red = parseColor('#ff0000');
  assert.ok(Math.abs(red.l - 54.29) < 0.01 && Math.abs(red.a - 80.8) < 0.05 && Math.abs(red.b - 69.89) < 0.05, JSON.stringify(red));
  assert.equal(toLab('lch(50% 0 0)'), 'lab(50 0 0)');
  assert.equal(toLab('lab(50% 50% -50%)'), 'lab(50 62.5 -62.5)');
  assert.equal(toLab('oklch(0.7157 0.1797 33.51deg)'), 'lab(65.4459 53.8462 44.2739)');
  assert.equal(toLab('oklch(50% 0.1 0.25turn)'), toLab('oklch(50% 0.1 90)'));
  assert.match(toLab('color(display-p3 1 0 0)'), /^lab\(\d/);
});

test('number formatting: 4 decimals, no trailing zeros, no -0', () => {
  assert.equal(formatNumber(1.23456789), '1.2346');
  assert.equal(formatNumber(2.5), '2.5');
  assert.equal(formatNumber(-0.00001), '0');
  assert.equal(formatNumber(-0), '0');
  assert.equal(formatNumber(100.00000001), '100');
});

test('findColors finds hex, functions and (optionally) named colours, skipping strings and urls', () => {
  const hits = (v, named) => findColors(v, { named }).map((h) => h.text);
  assert.deepEqual(hits('0 1px 2px #000, 0 0 0 1px rgb(0 0 0 / .1)', false), ['#000', 'rgb(0 0 0 / .1)']);
  assert.deepEqual(hits('1px solid red', true), ['red']);
  assert.deepEqual(hits('1px solid red', false), []);
  assert.deepEqual(hits('"red" url(#red) var(--x, blue)', true), ['blue']);
  assert.deepEqual(hits('currentColor var(--color-text)', true), []);
  assert.deepEqual(hits('#abcde', false), []); // 5 hex digits is not a colour
});

test('convertColorsInValue rewrites every colour in a shadow', () => {
  assert.equal(convertColorsInValue('0 1px 2px rgb(0 0 0 / 0.2), 0 0 0 1px black', { named: true }), '0 1px 2px lab(0 0 0 / 0.2), 0 0 0 1px lab(0 0 0)');
});

test('invalid colours throw', () => {
  assert.throws(() => toLab('#12'));
  assert.throws(() => toLab('rgb(1 2)'));
  assert.throws(() => toLab('oklch(from red l c h)'));
  assert.throws(() => toLab('notacolor'));
});
