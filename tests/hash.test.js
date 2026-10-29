import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileStylesheet } from '../src/compile/stylesheet.js';
import { hash53, makeName, resolveNaming } from '../src/hash.js';
import { atomClassName } from '../src/normalize.js';
import { css, createCss } from '../src/index.js';

const naming = resolveNaming();

test('names are deterministic, prefixed and 8 characters', () => {
  const a = makeName('|color|"var(--color-text)"', naming);
  assert.equal(a, makeName('|color|"var(--color-text)"', naming));
  assert.match(a, /^x[0-9a-z]{7}$/);
  assert.equal(hash53('abc'), hash53('abc'));
  assert.notEqual(hash53('abc'), hash53('abd'));
});

test('known names stay stable across releases', () => {
  // Changing the hash changes every class name in every app: treat as breaking.
  assert.equal(css.create({ a: { color: 'var(--color-text)' } }).a.color, 'xge9nck7');
  assert.equal(css.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } }), 'xzinow3x');
});

test('prefix and salt change names; invalid prefixes are rejected', () => {
  const e = { pe: '', prop: 'color', tree: 'var(--x)' };
  assert.notEqual(atomClassName(e, resolveNaming({ salt: 's' })), atomClassName(e, naming));
  assert.match(atomClassName(e, resolveNaming({ prefix: 'p_' })), /^p_[0-9a-z]{7}$/);
  assert.throws(() => resolveNaming({ prefix: '1x' }));
  assert.throws(() => resolveNaming({ prefix: 'a b' }));
  assert.equal(createCss({ prefix: 'q' }).create({ a: { opacity: 1 } }).a.opacity[0], 'q');
});

test('identical definitions dedupe to one class', () => {
  const a = css.create({ x: { color: 'var(--color-text)' } }).x;
  const b = css.create({ y: { color: 'var(--color-text)' } }).y;
  assert.equal(a.color, b.color);
  const { stats } = compileStylesheet({ calls: [{ kind: 'create', value: { x: { opacity: 1 } } }, { kind: 'create', value: { y: { opacity: 1 } } }] });
  assert.equal(stats.atoms, 1);
});

test('collisions are detected at build time and resolved by a salt', () => {
  // These two values hash to the same name with the default naming (found by search).
  const calls = [
    { kind: 'create', value: { a: { opacity: '105.478' } } },
    { kind: 'create', value: { b: { opacity: '175.273' } } },
  ];
  const r = compileStylesheet({ calls });
  assert.equal(r.css, null);
  assert.match(r.diagnostics[0].message, /collision on xqfw7cvd/);
  const salted = compileStylesheet({ calls, salt: 'v2' });
  assert.notEqual(salted.css, null);
  assert.equal(salted.stats.atoms, 2);
});
