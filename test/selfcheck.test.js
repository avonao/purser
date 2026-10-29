import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selfCheck } from '../src/build/selfcheck.js';
import { tryRequire } from './helpers/host.js';

const postcss = tryRequire('postcss');
const skip = postcss ? false : 'postcss is not installed in the host project';

test('the output self-check catches broken output', { skip }, () => {
  assert.deepEqual(selfCheck('.a { color: lab(1 2 3); }', postcss), []);
  assert.match(selfCheck('.a { color: var(--x) !important; }', postcss)[0], /!important/);
  assert.match(selfCheck('.a { color: #fff; }', postcss)[0], /not lab\(\)/);
  assert.match(selfCheck(':root { --color-a: red; }', postcss)[0], /not lab\(\)/);
  assert.match(selfCheck('@media (x) { .a { color: lab(1 1 1); } .a { color: lab(2 2 2); } }', postcss)[0], /declared twice/);
  assert.deepEqual(selfCheck('@font-face { font-family: A; } @font-face { font-family: B; }', postcss), []);
  assert.match(selfCheck('.a {', postcss)[0], /does not parse/);
});
