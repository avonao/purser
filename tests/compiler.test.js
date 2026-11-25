import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createCompiler } from '../src/compiler/index.js';
import { foldOutcomes, transformSource } from '../src/compiler/transform.js';
import { createCss, defineTokens } from '../src/index.js';
import { ROOT, tryRequire } from './helpers/host.js';

const ts = tryRequire('typescript');
const skip = ts ? false : 'typescript is not installed in the host project';
const t = defineTokens({ tokens: { color: { text: '#000', accent: '#f00' }, space: { 2: '8px', 4: '16px' } } });
const statics = { t, bp: { md: '@media (width >= 768px)' } };

function context(options = {}) {
  const naming = { prefix: 'x', salt: '', names: 'legacy', granularity: options.granularity ?? 'property' };
  return {
    ts,
    packageName: '@avonao/purser',
    naming,
    css: createCss(naming),
    resolveStatic: (spec) => (spec === './tokens' ? statics : undefined),
    isPure: (spec) => spec === './tokens',
  };
}
const compile = (code, options) => transformSource(code, '/virtual/app/c.tsx', context(options));
const css = createCss();
const tmp = fs.mkdtempSync(path.join(ROOT, 'tests/.compiler-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('css.create and a css.props call with static arguments become one string', { skip }, () => {
  const out = compile(`import { css } from '@avonao/purser';
import { t } from './tokens';
const s = css.create({
  a: { color: t.color.text, padding: t.space[4] },
  b: { color: t.color.accent },
});
export const C = () => <div className={css.props(s.a, s.b)} />;
`);
  const expected = css.props(...Object.values(css.create({ a: { color: 'var(--color-text)', padding: 'var(--space-4)' }, b: { color: 'var(--color-accent)' } })));
  const literal = /className=\{("[^"]*")\}/.exec(out.code)[1];
  assert.deepEqual(JSON.parse(literal).split(' ').sort(), expected.split(' ').sort());
  assert.ok(!out.code.includes('@avonao/purser'), 'the runtime import is gone');
  assert.ok(!out.code.includes('./tokens'), 'the tokens import is gone: nothing refers to it any more');
  assert.ok(!out.code.includes('css.create'));
  assert.deepEqual(out.stats, { create: 1, folded: 1, dynamic: 0, keyframes: 0, globals: 0, tokens: 0 });
});

test('line numbers are kept and the source map has one segment per line', { skip }, () => {
  const code = `import { css } from '@avonao/purser';
const s = css.create({
  a: {
    color: 'red',
  },
});
export function f() {
  return css.props(
    s.a,
  );
}
`;
  const out = compile(code);
  assert.equal(out.code.split('\n').length, code.split('\n').length);
  assert.equal(out.code.split('\n')[6], 'export function f() {');
  assert.equal(out.map.mappings.split(';').length, out.code.split('\n').length);
  assert.deepEqual(out.map.sourcesContent, [code]);
});

test('a style that is used some other way keeps its class map, and a dynamic css.props call keeps the merge', { skip }, () => {
  const out = compile(`import { css } from '@avonao/purser';
export const s = css.create({ a: { color: 'red' }, b: { color: 'blue' } });
export const pick = (name: 'a' | 'b', extra: unknown) => css.props(s[name], extra);
`);
  assert.match(out.code, /import \{ props as _purserProps, styles as _purserStyles \} from "@avonao\/purser\/compiled";/);
  assert.match(out.code, /export const s = _purserStyles\(\{"a":\{"color":"x[0-9a-z]{7}"\},"b":\{"color":"x[0-9a-z]{7}"\}\}\);/);
  assert.match(out.code, /_purserProps\(s\[name\], extra\)/);
  assert.equal(out.stats.dynamic, 1);
});

test('css.keyframes becomes its name, css.globals is removed, defineTokens becomes its result', { skip }, () => {
  const out = compile(`import { css, defineTokens } from '@avonao/purser';
export const fade = css.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
css.globals({ body: { margin: 0 } });
export const tokens = defineTokens({ tokens: { space: { 2: '8px' } } });
`);
  assert.match(out.code, /export const fade = "x[0-9a-z]{7}";/);
  assert.ok(!out.code.includes('css.globals'));
  assert.match(out.code, /export const tokens = \(\{"space":\{"2":"var\(--space-2\)"\}\}\);/);
  assert.ok(!out.code.includes('@avonao/purser'));
});

test('a module without Purser calls, or with an error the build reports, is left alone', { skip }, () => {
  assert.equal(compile(`export const x = 1;`), null);
  assert.equal(compile(`import { css } from '@avonao/purser';\nconst s = css.create({ a: { color: Math.random() > 0.5 ? 'red' : 'blue' } });`), null);
  assert.equal(compile(`import { css } from '@avonao/purser';\nconst s = css.create({ a: { border: '1px solid' } });\nexport const c = css.props(s.a);`), null);
});

test("'use client' stays first and other imports are untouched", { skip }, () => {
  const out = compile(`'use client';
import { useState } from 'react';
import { css } from '@avonao/purser';
import { helper } from './helper';
const s = css.create({ a: { color: 'red' } });
export const C = () => { const [on] = useState(false); return <i className={css.props(on && s.a)} data-x={helper()} />; };
`);
  assert.ok(out.code.startsWith("'use client';\nimport { useState } from 'react';\n"));
  assert.ok(out.code.includes("import { helper } from './helper';"));
  assert.match(out.code, /className=\{\(\(\(on\)\?" x[0-9a-z]{7}":""\)\)\.slice\(1\)\}/);
});

test('a guard that runs code is evaluated once, in place; a nested one leaves the call to the runtime', { skip }, () => {
  const top = compile(`import { css } from '@avonao/purser';
const s = css.create({ a: { color: 'red' }, b: { color: 'blue', gap: 4 } });
export const f = (x: { on(): boolean; big: boolean }) => css.props(s.a, x.on() && s.b, x.big && s.a);
`);
  assert.match(top.code, /\(\(_0,_1\)=>\(.*\)\)\(x\.on\(\),x\.big\)/);
  assert.equal(top.stats.folded, 1);
  const nested = compile(`import { css } from '@avonao/purser';
const s = css.create({ a: { color: 'red' }, b: { color: 'blue' } });
export const f = (x: { ok: boolean; on(): boolean }) => css.props(x.ok && (x.on() ? s.a : s.b));
`);
  assert.equal(nested.stats.dynamic, 1);
  assert.ok(nested.code.includes('_purserProps(x.ok && (x.on() ? s.a : s.b))'));
});

test('what a guard refers to is still imported', { skip }, () => {
  const out = compile(`import { css } from '@avonao/purser';
import { t } from './tokens';
const s = css.create({ a: { color: t.color.text } });
export const f = () => css.props(t.color.text === 'x' && s.a);
`);
  assert.ok(out.code.includes("import { t } from './tokens';"), 'the guard reads t');
});

test('folded calls give exactly the class names of the runtime, for every combination of guards', { skip }, async () => {
  const source = `import { css } from '@avonao/purser';
const s = css.create({
  base: { color: 'red', padding: 8, display: { default: 'block', ':hover': 'flex' }, '::before': { content: '"x"' } },
  primary: { color: 'blue', paddingTop: 4, marginInlineStart: 2 },
  quiet: { color: null, display: 'grid', marginLeft: 3 },
  wide: { paddingInline: 12, gap: { default: 1, '@media (width >= 768px)': 2 } },
});
export const cases = {
  none: () => css.props(),
  one: () => css.props(s.base),
  two: (g) => css.props(s.base, g.a && s.primary),
  three: (g) => css.props(s.base, g.a && s.primary, g.b && s.quiet, g.c && s.wide),
  ternary: (g) => css.props(g.a ? s.primary : s.quiet, s.base, g.b ? null : s.wide),
  nested: (g) => css.props(s.base, g.a && (g.b ? s.primary : [s.quiet, g.c && s.wide])),
  list: (g) => css.props([s.base, g.a && s.primary], false, undefined, g.a && s.wide),
  onlyGuarded: (g) => css.props(g.a && s.quiet, g.b && s.wide),
  repeated: (g) => css.props(g.a && s.base, g.b && s.primary, g.a && s.wide, !g.a && s.quiet),
};
`;
  for (const granularity of ['property', 'rule']) {
    const out = transformSource(source, path.join(tmp, 'cases.js'), { ...context({ granularity }), naming: { prefix: 'x', salt: '', names: 'legacy', granularity }, css: createCss({ granularity }) });
    assert.equal(out.stats.folded, 9);
    assert.equal(out.stats.dynamic, 0);
    assert.ok(!out.code.includes('@avonao/purser'));
    const compiledFile = path.join(tmp, `compiled-${granularity}.mjs`);
    fs.writeFileSync(compiledFile, out.code);
    const runtimeFile = path.join(tmp, `runtime-${granularity}.mjs`);
    fs.writeFileSync(runtimeFile, source.replace(`import { css } from '@avonao/purser';`, `import { createCss } from '@avonao/purser';\nconst css = createCss({ granularity: '${granularity}' });`));
    const compiled = (await import(pathToFileURL(compiledFile).href)).cases;
    const runtime = (await import(pathToFileURL(runtimeFile).href)).cases;
    for (const name of Object.keys(runtime)) {
      for (let bits = 0; bits < 8; bits++) {
        const g = { a: Boolean(bits & 1), b: Boolean(bits & 2), c: Boolean(bits & 4) };
        const want = runtime[name](g).split(' ').filter(Boolean).sort();
        const got = compiled[name](g).split(' ').filter(Boolean).sort();
        assert.deepEqual(got, want, `${granularity} ${name} ${JSON.stringify(g)}`);
        assert.ok(!/^ | $| {2}/.test(compiled[name](g)), 'no stray spaces');
      }
    }
  }
});

test('foldOutcomes: one expression for every outcome', () => {
  const guards = [{ text: 'a', simple: true, top: true }, { text: 'b', simple: true, top: true }];
  // bit 0 = a, bit 1 = b
  const outcomes = [['k'], ['k', 'x'], ['k', 'y'], ['k', 'x', 'y', 'z']];
  const expr = foldOutcomes(outcomes, guards);
  const run = new Function('a', 'b', `return ${expr}`);
  for (let bits = 0; bits < 4; bits++) assert.deepEqual(run(Boolean(bits & 1), Boolean(bits & 2)).split(' ').sort(), [...outcomes[bits]].sort());
  assert.equal(foldOutcomes([['b', 'aa', 'a']], []), '"a b aa"', 'shortest names first');
});

test('createCompiler: resolves the tokens module, skips other files and follows a changed tokens module', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'project-'));
  fs.writeFileSync(path.join(dir, 'tokens.js'), `import { defineTokens } from '@avonao/purser';\nexport const t = defineTokens({ tokens: { space: { 1: '4px' } } });\n`);
  const file = path.join(dir, 'a.js');
  const code = `import { css } from '@avonao/purser';\nimport { t } from './tokens.js';\nconst s = css.create({ a: { gap: t.space[1] } });\nexport const c = css.props(s.a);\n`;
  const compiler = createCompiler({ projectDir: dir, tokens: 'tokens.js' });
  const out = await compiler.transform(code, `${file}?v=1`);
  assert.match(out.code, /export const c = "x[0-9a-z]{7} x[0-9a-z]{7}";/, 'gap is row-gap and column-gap');
  assert.equal(await compiler.transform(`export const x = 1;`, path.join(dir, 'b.js')), null);
  assert.equal(await compiler.transform(code, path.join(dir, 'node_modules/pkg/a.js')), null);
  assert.equal(await compiler.transform(code, path.join(dir, 'a.css')), null);
  // a token that does not exist is an error the build reports: the module is left alone
  assert.equal(await compiler.transform(code.replace('t.space[1]', 't.space[9]'), file), null);
  fs.writeFileSync(path.join(dir, 'tokens.js'), `import { defineTokens } from '@avonao/purser';\nexport const t = defineTokens({ tokens: { space: { 1: '4px', 9: '36px' } } });\n// changed\n`);
  assert.ok(await compiler.transform(code.replace('t.space[1]', 't.space[9]'), file));
});
