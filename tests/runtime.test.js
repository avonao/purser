import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCss, css } from '../src/index.js';

const s = css.create({
  base: { color: 'var(--color-text)', paddingTop: '1px', display: { default: 'block', ':hover': 'flex' } },
  accent: { color: 'var(--color-accent)' },
  unset: { color: null },
  before: { '::before': { content: '""', color: 'var(--color-accent)' } },
  logical: { marginBlockStart: '2px' },
  physical: { marginTop: '3px', paddingInline: '4px' },
});

test('css.create returns frozen class maps keyed by pseudo-element and property', () => {
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.base));
  assert.deepEqual(Object.keys(s.base), ['color', 'padding-top', 'display']);
  assert.deepEqual(Object.keys(s.before), ['::before content', '::before color']);
});

test('css.props merges left to right; later wins per property', () => {
  const both = css.props(s.base, s.accent).split(' ');
  assert.equal(both.length, 3);
  assert.ok(both.includes(s.accent.color) && !both.includes(s.base.color));
  assert.equal(css.props(s.accent, s.base).split(' ').includes(s.base.color), true);
});

test('falsy arguments are ignored and arrays are flattened', () => {
  assert.equal(css.props(s.base, false, null, undefined, 0, ''), css.props(s.base));
  assert.equal(css.props([s.base, [s.accent]]), css.props(s.base, s.accent));
  assert.equal(css.props(), '');
});

test('null unsets a property from earlier styles', () => {
  assert.ok(!css.props(s.base, s.unset).split(' ').includes(s.base.color));
});

test('pseudo-element properties merge separately from the element', () => {
  assert.equal(css.props(s.accent, s.before).split(' ').length, 3);
});

test('logical and physical twins replace each other', () => {
  const a = css.props(s.logical, s.physical).split(' ');
  assert.ok(!a.includes(s.logical['margin-block-start']) && a.includes(s.physical['margin-top']));
  const b = css.props(s.physical, s.logical).split(' ');
  assert.ok(!b.includes(s.physical['margin-top']) && b.includes(s.logical['margin-block-start']));
  // inline-start/end may be left or right, so both physical sides give way.
  const c = css.props(css.create({ p: { padding: '1px' } }).p, s.physical);
  assert.equal(c.split(' ').length, 5); // top, bottom, inline-start, inline-end, margin-top
});

test('css.props rejects anything that is not a compiled style', () => {
  assert.throws(() => css.props({ color: 'red' }), /only accepts styles returned by css.create/);
});

test('custom naming applies to classes and keyframes', () => {
  const p = createCss({ prefix: 'p' });
  assert.match(p.create({ a: { opacity: 1 } }).a.opacity, /^p[0-9a-z]{7}$/);
  assert.match(p.keyframes({ to: { opacity: 1 } }), /^p[0-9a-z]{7}$/);
  assert.equal(p.globals({}), undefined);
});
