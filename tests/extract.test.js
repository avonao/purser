import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractFile } from '../src/build/extract.js';
import { defineTokens } from '../src/index.js';
import { tryRequire } from './helpers/host.js';

const ts = tryRequire('typescript');
const skip = ts ? false : 'typescript is not installed in the host project';
const t = defineTokens({ tokens: { color: { text: '#000', accent: '#f00' }, space: { 4: '16px' } } });
const statics = { t, bp: { md: '@media (width >= 768px)' } };
const ctx = () => ({
  ts,
  packageName: '@avonao/purser',
  naming: { prefix: 'x', salt: '' },
  resolveStatic: (spec) => (spec === '@/tokens' || spec === './tokens' ? statics : undefined),
});
const run = (code, file = '/virtual/app/c.tsx') => extractFile(file, code, ctx());

test('extracts create, keyframes and globals with statically evaluated arguments', { skip }, () => {
  const { calls, diagnostics } = run(`
import { css } from '@avonao/purser';
import { t, bp } from '@/tokens';
const base = { color: t.color.text } as const;
const gap = 4;
const fade = css.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const key = 'paddingTop';
export const s = css.create({
  a: { ...base, [key]: t.space[4], marginTop: -gap, display: { default: 'block', [bp.md]: 'flex' } },
  b: { gap: \`calc(\${t.space[4]} * 2)\`, animationName: fade, content: '""' } satisfies Record<string, unknown>,
});
css.globals({ body: { color: t.color.text } });
export function C() { return <div className={css.props(s.a, s.b)} />; }
`);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(calls.map((c) => c.kind), ['keyframes', 'create', 'globals']);
  const create = calls[1].value;
  assert.deepEqual(create.a, { color: 'var(--color-text)', paddingTop: 'var(--space-4)', marginTop: -4, display: { default: 'block', '@media (width >= 768px)': 'flex' } });
  assert.equal(create.b.gap, 'calc(var(--space-4) * 2)');
  assert.match(create.b.animationName, /^x[0-9a-z]{7}$/);
  assert.equal(calls[1].line, 8);
});

test('css.globals takes an optional options object; the others take one argument', { skip }, () => {
  const { calls, diagnostics } = run(`
import { css } from '@avonao/purser';
const over = { layer: 'overrides' } as const;
css.globals({ '.hc *': { opacity: 1 } }, over);
css.globals({}, {}, {});
css.create({ a: { opacity: 1 } }, {});
`);
  assert.deepEqual(calls.map((c) => [c.kind, c.options]), [['globals', { layer: 'overrides' }]]);
  assert.deepEqual(diagnostics.map((d) => d.message), [
    'css.globals takes one argument and an optional options object',
    'css.create takes exactly one argument',
  ]);
});

test('renamed and namespace imports are recognised', { skip }, () => {
  const { calls } = run(`
import { css as c } from '@avonao/purser';
import * as P from '@avonao/purser';
c.create({ a: { opacity: 1 } });
P.css.create({ b: { opacity: 0 } });
`);
  assert.equal(calls.length, 2);
});

test('non-static values are errors with file:line', { skip }, () => {
  const cases = [
    [`const s = css.create({ a: { color: pick() } });`, /a function call is not static/],
    [`let w = 1;\nconst s = css.create({ a: { width: w } });`, /declared with let\/var/],
    [`function f(x) { return css.create({ a: { width: x } }); }`, /function parameter/],
    [`import { other } from './other';\nconst s = css.create({ a: { width: other } });`, /not statically known/],
    [`const s = css.create({ a: { width: 1 + 2 } });`, /an operator expression is not static/],
    [`const s = css.create({ a: { color: t.color.nope } });`, /unknown property "nope" \(no such token\)/],
    [`const s = css.create({ a: { get color() { return 'x'; } } });`, /methods, getters and setters/],
    [`const s = css.create({ a: { width: cond ? 1 : 2 } });`, /conditional/],
  ];
  for (const [body, message] of cases) {
    const code = `import { css } from '@avonao/purser';\nimport { t } from './tokens';\n${body}\n`;
    const { diagnostics } = run(code);
    assert.equal(diagnostics.length, 1, body);
    assert.match(diagnostics[0].message, message, body);
    assert.equal(diagnostics[0].file, '/virtual/app/c.tsx');
    const expectedLine = 3 + body.split('\n').length - 1;
    assert.equal(diagnostics[0].line, expectedLine, body);
  }
});

test('indirect uses of css are errors (the build could not see them)', { skip }, () => {
  const { diagnostics } = run(`import { css } from '@avonao/purser';\nconst create = css.create;\nconst x = css;\n`);
  assert.deepEqual(diagnostics.map((d) => [d.line, /called directly|must be used as/.test(d.message)]), [[2, true], [3, true]]);
});

test('files that do not import the runtime are ignored', { skip }, () => {
  assert.deepEqual(run(`const css = { create() {} };\ncss.create({ a: { color: 'red' } });`), { calls: [], diagnostics: [] });
});

test('locate() maps a value path to the line of that property', { skip }, () => {
  const { calls } = run(`import { css } from '@avonao/purser';
const s = css.create({
  a: {
    color: {
      default: 'x',
      ':hover': 'y',
    },
  },
});
`);
  assert.equal(calls[0].locate(['a', 'color', ':hover']).line, 6);
  assert.equal(calls[0].locate(['a']).line, 3);
});
