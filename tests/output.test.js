// Output modes of the stylesheet: rule granularity, minified output with merged rules, minimal names.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileStylesheet } from '../src/compile/stylesheet.js';
import { createCss, defineTokens } from '../src/index.js';
import { createAnyCss, createCss as createRuleCss, css as ruleCss } from '../src/rule.js';
import { createNameRegistry, sequenceName } from '../src/names.js';
import { TOKENS } from '../src/tokens.js';
import { tryRequire } from './helpers/host.js';

const t = defineTokens({ axes: { mode: { light: ':not(.dark)', dark: '.dark' } }, tokens: { color: { text: { default: '#111', 'mode=dark': '#eee' }, accent: '#f00', line: '#ccc' } } });
const tokens = t[TOKENS];
const styles = {
  a: { color: { default: t.color.text, ':hover': t.color.accent }, display: 'flex', gap: 4 },
  b: { color: { default: t.color.text, ':hover': t.color.line }, display: 'flex', opacity: { ':disabled': 0.5 } },
  c: { color: { default: t.color.text, ':focus-visible': t.color.accent }, display: { default: 'flex', '@media (width >= 768px)': 'grid' } },
  d: { color: t.color.text, backgroundColor: { default: t.color.line, ':has(> img)': t.color.accent }, '::-webkit-scrollbar': { display: 'none' } },
};
const compile = (options = {}, calls = [{ kind: 'create', value: styles }]) => compileStylesheet({ tokens, calls, ...options });
const classesOf = (css) => new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]).filter((c) => c !== 'dark'));
const selfCheck = async (css) => {
  const postcss = tryRequire('postcss');
  if (!postcss) return [];
  return (await import('../src/build/selfcheck.js')).selfCheck(css, postcss);
};

test('rule granularity: styles share the rules they have in common', async () => {
  const property = compile();
  const rule = compile({ granularity: 'rule' });
  assert.deepEqual(rule.diagnostics, []);
  assert.deepEqual(await selfCheck(rule.css), []);
  // `color: text` outside hover is written for a and for b with property granularity, once with rule granularity
  const count = (css, re) => (css.match(re) ?? []).length;
  assert.equal(count(property.css, /:not\(:hover\) \{ color: var\(--color-text\); \}/g), 2);
  assert.equal(count(rule.css, /:not\(:hover\) \{ color: var\(--color-text\); \}/g), 1);
  assert.equal(count(rule.css, /^ {2}\.x\w{7} \{ display: flex; \}$/gm), 1);
  assert.ok(rule.stats.rules < property.stats.rules);
  // one class per rule: every selector has its own class
  assert.equal(rule.stats.atoms, rule.stats.rules + 1, 'plus the marker of the style with a gap (opacity only when disabled)');
});

test('rule granularity: the runtime gives exactly the classes the stylesheet has', () => {
  const { css } = compile({ granularity: 'rule' });
  const inSheet = classesOf(css);
  const runtime = createRuleCss().create(styles);
  const used = new Set(Object.values(runtime).flatMap((map) => Object.values(map).flatMap((v) => (v ? v.split(' ') : []))));
  for (const cls of used) assert.ok(inSheet.has(cls) || /* a marker has no rule of its own */ runtime.b.opacity.split(' ').includes(cls), `class ${cls}`);
  // a: color has two rules (not hover, hover), display one, gap two longhands
  assert.equal(runtime.a.color.split(' ').length, 2);
  assert.equal(runtime.a.display.split(' ').length, 1);
  // a and b share the class of "color: text outside hover" and of "display: flex"
  assert.equal(runtime.a.display, runtime.b.display);
  assert.ok(runtime.b.color.split(' ').includes(runtime.a.color.split(' ')[0]) || runtime.b.color.split(' ').includes(runtime.a.color.split(' ')[1]));
  // a style that leaves a gap (opacity is unset unless disabled) carries its marker as well
  assert.equal(runtime.b.opacity.split(' ').length, 2);
});

test('rule granularity: a global rule excludes every atom class and fills the gap of a style that has one', async () => {
  const calls = [
    { kind: 'create', value: { a: { opacity: 1 }, b: { opacity: { ':disabled': 0.5 } } } },
    { kind: 'globals', value: { button: { opacity: 0.9 } } },
  ];
  const { css, diagnostics } = compile({ granularity: 'rule' }, calls);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(await selfCheck(css), []);
  const runtime = ruleCss.create(calls[0].value);
  const [rule, marker] = runtime.b.opacity.split(' ');
  // elements without an opacity class get the global value; an element with b gets it while it is not disabled
  assert.match(css, new RegExp(`button:not\\((?:\\.x\\w{7}, )*\\.${runtime.a.opacity}`));
  assert.ok(css.includes(`button.${marker}:not(:disabled)`) || css.includes(`button:not(:disabled).${marker}`), css);
  assert.ok(css.includes(`.${rule}:disabled { opacity: 0.5; }`));
});

test('minify: no whitespace, rules that write the same declaration share a selector list', async () => {
  const { css, diagnostics } = compile({ minify: true });
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(await selfCheck(css), []);
  assert.ok(!/\n./.test(css), 'one line');
  assert.ok(css.startsWith('@layer purser.tokens,purser.globals,purser.atoms;@layer purser.tokens{'));
  // four styles write `color: text` (three of them outside one state): one rule with four selectors
  assert.match(css, /\.x\w{7}:not\(:focus-visible\),\.x\w{7}:not\(:hover\),\.x\w{7}:not\(:hover\),\.x\w{7}\{color:var\(--color-text\)\}/);
  // the same declarations as the readable output
  const decls = (text) => [...text.matchAll(/([a-z-]+): ?([^;{}]+)[;}]/g)].map((m) => `${m[1]}:${m[2].trim()}`).sort();
  assert.deepEqual([...new Set(decls(css))], [...new Set(decls(compile().css))]);
});

test('minify: a selector some browser may not parse never shares a rule', () => {
  const value = {
    a: { color: { default: t.color.text, ':has(> img)': t.color.accent } },
    b: { color: { default: t.color.text, ':has(> img)': t.color.accent }, opacity: 1 },
    c: { color: { default: t.color.line, ':has(> img)': t.color.accent } },
    d: { '::-webkit-scrollbar': { display: 'none' }, '::before': { display: 'none' } },
    e: { '::-moz-range-thumb': { display: 'none' } },
  };
  const { css } = compile({ minify: true, granularity: 'rule' }, [{ kind: 'create', value }]);
  for (const list of css.match(/[^{}]+(?=\{)/g).filter((sel) => sel.includes(','))) {
    assert.ok(!/:has\(|::-webkit|::-moz/.test(list), `merged: ${list}`);
  }
  // both vendor pseudo-elements write display:none, each in a rule of its own
  assert.match(css, /\.x\w{7}::-webkit-scrollbar\{display:none\}/);
  assert.match(css, /\.x\w{7}::-moz-range-thumb\{display:none\}/);
});

test('minimal names: the most used class gets the shortest name, and the registry never renames', () => {
  const registry = createNameRegistry();
  const first = compile({ names: 'min', granularity: 'rule', registry });
  assert.deepEqual(first.diagnostics, []);
  const names = registry.toJSON();
  assert.ok(Object.values(names).every((n) => /^_[\w-]{1,2}$/.test(n)));
  assert.equal(new Set(Object.values(names)).size, Object.keys(names).length, 'no two classes share a name');
  // `display: flex` is used by three styles: nothing is used more, so it is among the first names
  const flex = /\.(_[\w-]+) \{ display: flex; \}/.exec(first.css)[1];
  assert.ok(['_a', '_b'].includes(flex), flex);
  // more styles later: the old names stay
  const more = compile({ names: 'min', granularity: 'rule', registry }, [{ kind: 'create', value: { ...styles, z: { display: 'none', gap: 9 } } }]);
  const after = registry.toJSON();
  for (const [id, name] of Object.entries(names)) assert.equal(after[id], name);
  assert.ok(Object.keys(after).length > Object.keys(names).length);
  assert.ok(more.css.includes(`.${flex} { display: flex; }`));
  // the same source always gives the same names
  assert.equal(compile({ names: 'min', granularity: 'rule' }).css, first.css);
  // keyframes keep their hashed name: it is part of the values that use it
  const kf = compile({ names: 'min' }, [{ kind: 'keyframes', value: { from: { opacity: 0 }, to: { opacity: 1 } } }]);
  assert.match(kf.css, /@keyframes x[0-9a-z]{7} /);
});

test('minimal names: the runtime cannot compute them, the compiler can', () => {
  assert.throws(() => createCss({ names: 'min' }).create({ a: { color: 'red' } }), /names "min" are given by the build/);
  const registry = createNameRegistry({ prefix: '' });
  const css = createAnyCss({ names: 'min', rename: (id) => registry.get(id) });
  assert.deepEqual(css.create({ a: { color: 'red', display: 'block' } }).a, { color: 'a', display: 'b' });
  assert.match(css.keyframes({ from: { opacity: 0 } }), /^x[0-9a-z]{7}$/);
});

test('the main entry stays small: rule granularity is computed by @avonao/purser/rule or by the compiler', () => {
  assert.throws(() => createCss({ granularity: 'rule' }).create({ a: { color: 'red' } }), /granularity "rule" is computed by the compiler .* or by the runtime in @avonao\/purser\/rule/);
  assert.equal(createRuleCss({ granularity: 'property' }).create({ a: { gap: 1 } }).a['row-gap'], createCss().create({ a: { gap: 1 } }).a['row-gap']);
  assert.throws(() => createCss({ granularity: 'atom' }), /granularity must be/);
});

test('sequenceName: every name once, shortest first, always a valid class name', () => {
  for (const prefix of ['_', '']) {
    const seen = new Set();
    let last = 0;
    for (let i = 0; i < 6000; i++) {
      const name = sequenceName(i, prefix);
      assert.match(name, /^[A-Za-z_][\w-]*$/);
      assert.ok(!seen.has(name));
      assert.ok(name.length >= last);
      last = name.length;
      seen.add(name);
    }
  }
  assert.equal(sequenceName(0, '_'), '_a');
  assert.equal(sequenceName(64, '_'), '_aa');
  assert.equal(sequenceName(0, ''), 'a');
  assert.equal(sequenceName(52, ''), 'aa');
  assert.throws(() => createNameRegistry({ prefix: '1x' }), /prefix/);
});

test('a saved registry is continued, not restarted', () => {
  const registry = createNameRegistry({ names: { xaaaaaaa: '_a', xbbbbbbb: '_c' } });
  registry.assign(new Map([['xbbbbbbb', 9], ['xccccccc', 5], ['xddddddd', 7]]));
  assert.deepEqual(registry.toJSON(), { xaaaaaaa: '_a', xbbbbbbb: '_c', xccccccc: '_d', xddddddd: '_b' });
});
