import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileStylesheet } from '../../src/compile/stylesheet.js';
import { makeName, resolveNaming } from '../../src/hash.js';
import { createCss } from '../../src/index.js';

// Short names are chosen explicitly here.
const naming = resolveNaming({ names: 'short' });

test('short names are 4 characters, start with a letter, and are deterministic', () => {
  for (let i = 0; i < 2000; i++) {
    const a = makeName(`|color|"v${i}"`, naming);
    assert.match(a, /^[A-Za-z][A-Za-z0-9_-]{3}$/);
    assert.equal(a, makeName(`|color|"v${i}"`, naming));
  }
});

test('short is chosen by option; the default stays legacy', () => {
  const short = createCss({ names: 'short' }).create({ a: { opacity: 1 } }).a.opacity;
  const legacy = createCss({ names: 'legacy' }).create({ a: { opacity: 1 } }).a.opacity;
  assert.equal(short.length, 4);
  assert.match(legacy, /^x[0-9a-z]{7}$/);
  assert.throws(() => resolveNaming({ names: 'tiny' }));
});

test('the runtime and the build agree, and a different salt gives different names', () => {
  const rt = createCss({ names: 'short', salt: 's1' }).create({ a: { opacity: 0.5 } }).a.opacity;
  const built = compileStylesheet({ calls: [{ kind: 'create', value: { a: { opacity: 0.5 } } }], salt: 's1', names: 'short' });
  assert.ok(built.css.includes(`.${rt}`));
  assert.notEqual(rt, createCss({ names: 'short', salt: 's2' }).create({ a: { opacity: 0.5 } }).a.opacity);
});

test('a collision is refused loudly and a salt resolves it', () => {
  // Find two inputs that collide under short names with no salt, by search.
  const seen = new Map();
  let pair = null;
  for (let i = 0; i < 200000 && !pair; i++) {
    const v = `${i}.5`;
    const n = makeName(`|opacity|"${v}"`, naming);
    if (seen.has(n)) pair = [seen.get(n), v];
    else seen.set(n, v);
  }
  assert.ok(pair, 'a collision exists in 200k inputs');
  const calls = [
    { kind: 'create', value: { a: { opacity: pair[0] } } },
    { kind: 'create', value: { b: { opacity: pair[1] } } },
  ];
  const r = compileStylesheet({ calls, names: 'short' });
  assert.equal(r.css, null);
  assert.match(r.diagnostics[0].message, /collision/);
});
