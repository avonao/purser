// Fusion: classes that are applied together become one class. Whatever the level, an element must end up with exactly
// the declarations it had before, each from one rule.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build, createBuilder, watch } from '../src/build/index.js';
import { main } from '../src/cli.js';
import { createCompiler } from '../src/compiler/index.js';
import { contextKey, planFusion, resolveFuse } from '../src/fuse.js';
import { createNameRegistry, planFileFor, PlanError } from '../src/names.js';
import { createPluginCore } from '../src/plugins/shared.js';
import { ROOT, tryRequire } from './helpers/host.js';

const require = createRequire(import.meta.url);
const ts = tryRequire('typescript');
const postcss = tryRequire('postcss');
const skip = ts ? (postcss ? false : 'postcss is not installed in the host project') : 'typescript is not installed in the host project';
const temps = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

// --- the plan ---------------------------------------------------------------------------------------------------------

const idsOf = (plan, key) => plan.covers.get(key).flatMap((identity) => plan.classes.get(identity)).sort();

test('exact: classes that appear in the same groups become one class, and nothing is written twice', () => {
  // a and b are never seen without each other; c is shared with a group that has neither
  const contexts = [{ ids: ['a', 'b', 'c'] }, { ids: ['a', 'b', 'd'] }, { ids: ['c', 'e'] }];
  const plan = planFusion(contexts, { level: 'exact' });
  assert.deepEqual([...plan.classes.values()].map((ids) => ids.join('+')).sort(), ['a+b', 'c', 'd', 'e']);
  assert.equal(plan.stats.selectors, 5, 'every class id is written under exactly one name');
  for (const c of contexts) assert.deepEqual(idsOf(plan, contextKey(c.ids)), [...c.ids].sort());
  assert.equal(plan.covers.get(contextKey(['a', 'b', 'c'])).length, 2);
  // one class is its own identity, so a names file from an unfused build keeps naming it
  assert.ok(plan.classes.has('c') && plan.classes.has('d') && plan.classes.has('e'));
  assert.equal(plan.uses.get('c'), 2);
});

test('exact: the plan does not depend on the order of the groups or of the classes in them', () => {
  const contexts = [{ ids: ['a', 'b', 'c'] }, { ids: ['a', 'b', 'd'], weight: 3 }, { ids: ['c', 'e'] }, { ids: ['f'] }];
  const shuffled = [{ ids: ['f'] }, { ids: ['e', 'c'] }, { ids: ['d', 'b', 'a'] }, { ids: ['c', 'a', 'b'] }, { ids: ['a', 'd', 'b'], weight: 2 }];
  for (const level of ['exact', 'balanced', 'max']) {
    const one = planFusion(contexts, { level });
    const two = planFusion(shuffled, { level });
    assert.deepEqual([...one.classes], [...two.classes], level);
    assert.deepEqual([...one.covers], [...two.covers], level);
    assert.deepEqual([...one.uses].sort(), [...two.uses].sort(), level);
  }
});

test('balanced: a pair that often appears together gets a class of its own, a rare one does not', () => {
  const contexts = [];
  // flex + center in eight groups, each with something of its own; flex alone in two more
  for (let i = 0; i < 8; i++) contexts.push({ ids: ['flex', 'center', `own${i}`] });
  contexts.push({ ids: ['flex', 'x1'] }, { ids: ['flex', 'x2'] }, { ids: ['center', 'rare'] });
  const exact = planFusion(contexts, { level: 'exact' });
  assert.ok(exact.classes.has('flex') && exact.classes.has('center'), 'exact keeps them apart: each appears without the other');
  const balanced = planFusion(contexts, { level: 'balanced' });
  const pair = [...balanced.classes].find(([, ids]) => ids.join('+') === 'center+flex');
  assert.ok(pair, 'the pair has a class');
  assert.ok(balanced.classes.has('flex'), 'flex still exists for the groups without center');
  // what is left of center only ever appears with one other class now: the two are one class, at no cost
  assert.ok([...balanced.classes.values()].some((ids) => ids.join('+') === 'center+rare') && !balanced.classes.has('center'));
  assert.ok(balanced.stats.references < exact.stats.references, 'elements carry fewer classes');
  assert.equal(balanced.stats.selectors, exact.stats.selectors + 2, 'for two more selectors in the stylesheet');
  for (const c of contexts) assert.deepEqual(idsOf(balanced, contextKey(c.ids)), [...c.ids].sort());
  assert.equal(balanced.covers.get(contextKey(['flex', 'center', 'own0'])).length, 2);
  assert.ok(![...balanced.classes.values()].some((ids) => ids.includes('x1') && ids.length > 1), 'a pair seen once, of classes that also appear apart, is not worth a class');
});

test('max: every group is one class', () => {
  const contexts = [{ ids: ['a', 'b', 'c'] }, { ids: ['a', 'd'] }, { ids: ['a'] }];
  const plan = planFusion(contexts, { level: 'max' });
  assert.equal(plan.classes.size, 3);
  for (const c of contexts) {
    assert.equal(plan.covers.get(contextKey(c.ids)).length, 1);
    assert.deepEqual(idsOf(plan, contextKey(c.ids)), [...c.ids].sort());
  }
  assert.equal(plan.stats.selectors, 6, 'a is written under three names');
});

test('a plan is exact for random groups at every level', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 60; round++) {
    const pool = Array.from({ length: 4 + Math.floor(rnd() * 30) }, (_, i) => `k${i}`);
    const contexts = Array.from({ length: 1 + Math.floor(rnd() * 40) }, () => ({ ids: pool.filter(() => rnd() < 0.25), weight: 1 + Math.floor(rnd() * 4) })).filter((c) => c.ids.length);
    for (const level of ['exact', 'balanced', 'max']) {
      const plan = planFusion(contexts, { level, ratio: rnd() * 3 });
      const refs = (c) => plan.covers.get(contextKey(c.ids)).length;
      for (const c of contexts) {
        const got = plan.covers.get(contextKey(c.ids)).flatMap((identity) => plan.classes.get(identity));
        assert.equal(got.length, new Set(got).size, 'no class id twice');
        assert.deepEqual([...got].sort(), [...c.ids].sort());
      }
      const exact = planFusion(contexts, { level: 'exact' });
      for (const c of contexts) assert.ok(refs(c) <= exact.covers.get(contextKey(c.ids)).length, 'never more classes on an element than exact');
    }
  }
});

test('resolveFuse: levels, and what is not one', () => {
  assert.equal(resolveFuse(undefined), false);
  assert.equal(resolveFuse(false), false);
  assert.equal(resolveFuse(true), 'exact');
  assert.equal(resolveFuse('max'), 'max');
  assert.throws(() => resolveFuse('all'), /fuse must be "exact", "balanced" or "max"/);
});

// --- a project, built and compiled ------------------------------------------------------------------------------------

const TOKENS = `import { defineTokens } from '@avonao/purser';
export const bp = { md: '@media (width >= 768px)' } as const;
export const t = defineTokens({ tokens: { color: { text: '#111', accent: '#f00', line: '#ccc' }, space: { 1: '4px', 2: '8px', 4: '16px' } } });
`;
const BUTTON = `import { css } from '@avonao/purser';
import { bp, t } from './tokens.ts';
css.globals({ button: { backgroundColor: t.color.line, cursor: 'pointer' } });
const s = css.create({
  base: {
    display: 'flex',
    alignItems: 'center',
    padding: t.space[2],
    width: '137px',
    height: '41px',
    color: { default: t.color.text, ':hover': t.color.accent },
    backgroundColor: { ':hover': { default: t.color.accent, '@media (hover: none)': null } },
    gap: { default: t.space[1], [bp.md]: t.space[2] },
  },
  primary: { color: t.color.accent, padding: t.space[4], borderWidth: 3, borderStyle: 'solid' },
  quiet: { color: { default: t.color.line, ':hover': t.color.text }, opacity: 0.8 },
  unused: { zIndex: 77, order: 9 },
});
export const button = (p: { primary?: boolean; quiet?: boolean }): string => css.props(s.base, p.primary && s.primary, p.quiet && s.quiet);
export const plain = (): string => css.props(s.base);
`;
const CARD = `import { css } from '@avonao/purser';
import { t } from './tokens.ts';
const s = css.create({
  card: { display: 'flex', alignItems: 'center', padding: t.space[2], gap: t.space[4], margin: '13px' },
  title: { display: 'flex', color: t.color.text },
});
// kept at run time: a style picked by the caller is merged over these
export const open = css.create({
  box: { display: 'flex', padding: t.space[1], color: { default: t.color.text, ':hover': t.color.accent } },
  tint: { color: t.color.accent, opacity: 0.5 },
});
export const card = (wide: boolean): string => css.props(s.card, wide ? s.title : null);
export const box = (extra: unknown): string => css.props(open.box, extra);
`;
const MAIN = `import { button, plain } from './button.ts';
import { box, card, open } from './card.ts';
export const outcomes = {
  button: [button({}), button({ primary: true }), button({ quiet: true }), button({ primary: true, quiet: true })],
  plain: [plain()],
  card: [card(false), card(true)],
  box: [box(null), box(open.tint)],
};
`;

function project(files = { 'src/tokens.ts': TOKENS, 'src/button.ts': BUTTON, 'src/card.ts': CARD, 'src/main.ts': MAIN }) {
  // inside the repository, so `@avonao/purser` and `typescript` resolve
  const dir = fs.mkdtempSync(path.join(ROOT, 'tests/.fuse-'));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

/** What every class of a stylesheet's atoms layer declares: class -> ["at-rules|rest of selector|property: value", …]. */
function declarations(css) {
  const out = new Map();
  postcss.parse(css).walkAtRules('layer', (layer) => {
    if (!layer.nodes || !layer.params.endsWith('atoms')) return;
    layer.walkDecls((d) => {
      const at = [];
      for (let n = d.parent.parent; n && n !== layer; n = n.parent) at.unshift(`@${n.name} ${n.params}`);
      for (const selector of d.parent.selectors) {
        const m = /^\.([\w-]+)(.*)$/.exec(selector.trim());
        const list = out.get(m[1]) ?? [];
        list.push(`${at.join(' ')}|${m[2]}|${d.prop}: ${d.value}`);
        out.set(m[1], list);
      }
    });
  });
  return out;
}

/** Build a project, compile its modules and load them: the stylesheet and what every outcome applies. */
async function compiled(dir, options) {
  const registry = options.names === 'min' ? createNameRegistry() : undefined;
  const builder = createBuilder({ projectDir: dir, src: ['src'], tokens: 'src/tokens.ts', cache: false, threads: 0, modules: true, registry, ...options });
  const result = await builder.run();
  assert.deepEqual(result.diagnostics, []);
  const { fuse: _fuse, minify: _minify, ...naming } = options;
  const compiler = createCompiler({ projectDir: dir, tokens: 'src/tokens.ts', registry, records: builder.record, ...naming });
  const out = fs.mkdtempSync(path.join(ROOT, 'tests/.fuse-out-'));
  temps.push(out);
  for (const name of fs.readdirSync(path.join(dir, 'src'))) {
    const file = path.join(dir, 'src', name);
    const code = fs.readFileSync(file, 'utf8');
    const done = await compiler.transform(code, file);
    fs.writeFileSync(path.join(out, name), done ? done.code : code);
  }
  const { outcomes } = await import(pathToFileURL(path.join(out, 'main.ts')).href);
  const decls = declarations(result.css);
  const applied = {};
  for (const [site, lists] of Object.entries(outcomes)) {
    applied[site] = lists.map((list) => {
      const all = list.split(' ').filter(Boolean).flatMap((cls) => {
        assert.ok(decls.has(cls) || result.css.includes(`.${cls}`), `class ${cls} of ${site} is in the stylesheet`);
        return decls.get(cls) ?? [];
      });
      assert.equal(all.length, new Set(all).size, `${site}: no declaration reaches an element through two classes`);
      return all.sort();
    });
  }
  const read = (name) => fs.readFileSync(path.join(out, name), 'utf8');
  return { result, outcomes, applied, registry, builder, compiler, read };
}

test('every level: each outcome applies exactly the declarations it applies without fusion', { skip }, async () => {
  const dir = project();
  const reference = await compiled(dir, { granularity: 'rule', names: 'min', minify: true });
  const classCount = (run) => Object.values(run.outcomes).flat().reduce((n, list) => n + list.split(' ').filter(Boolean).length, 0);
  let last = classCount(reference);
  for (const fuse of ['exact', 'balanced', 'max']) {
    const run = await compiled(dir, { granularity: 'rule', names: 'min', minify: true, fuse });
    assert.deepEqual(run.applied, reference.applied, fuse);
    assert.equal(run.result.stats.fused.level, fuse);
    assert.ok(classCount(run) <= last, `${fuse}: elements carry no more classes than one level lower (${classCount(run)} <= ${last})`);
    last = classCount(run);
    if (postcss) assert.deepEqual((await import('../src/build/selfcheck.js')).selfCheck(run.result.css, postcss), []);
  }
  // max: a css.props call with no guard is one class, and each guard adds at most the classes it switches
  const max = await compiled(dir, { granularity: 'rule', names: 'min', minify: true, fuse: 'max' });
  assert.equal(max.outcomes.plain[0].split(' ').length, 1);
  assert.equal(max.outcomes.card[0].split(' ').length, 1);
  assert.equal(max.outcomes.card[1].split(' ').length, 2);
});

test('exact: a smaller stylesheet and fewer classes, with one class per rule kept where rules are shared', { skip }, async () => {
  const dir = project();
  const plain = await compiled(dir, { granularity: 'rule', names: 'min', minify: true });
  const exact = await compiled(dir, { granularity: 'rule', names: 'min', minify: true, fuse: 'exact' });
  assert.ok(exact.result.css.length < plain.result.css.length, `${exact.result.css.length} < ${plain.result.css.length}`);
  assert.ok(exact.result.stats.atoms < plain.result.stats.atoms);
  // width and height only ever appear in the base style: one rule with both
  assert.match(exact.result.css, /\{height:41px;width:137px\}/);
  // display:flex is shared with the card and the open style, so it stays a class of its own, written once
  assert.equal(exact.result.css.match(/display:flex/g).length, 1);
  // property granularity works too (fewer rules are shared to begin with)
  const reference = await compiled(dir, { names: 'min', minify: true });
  const property = await compiled(dir, { names: 'min', minify: true, fuse: 'exact' });
  assert.deepEqual(property.applied, reference.applied);
});

test('a style no compiled module applies is not written; without fusion it is', { skip }, async () => {
  const dir = project();
  const plain = await compiled(dir, { granularity: 'rule', names: 'min', minify: true });
  assert.ok(plain.result.css.includes('z-index:77'));
  for (const fuse of ['exact', 'balanced', 'max']) {
    const run = await compiled(dir, { granularity: 'rule', names: 'min', minify: true, fuse });
    assert.ok(!run.result.css.includes('z-index:77') && !run.result.css.includes('order:9'), fuse);
  }
});

test('styles merged at run time keep one class list per property, and a later style still replaces an earlier one', { skip }, async () => {
  const dir = project();
  for (const fuse of ['exact', 'balanced', 'max']) {
    const run = await compiled(dir, { granularity: 'rule', names: 'min', minify: true, fuse });
    const card = run.read('card.ts');
    assert.ok(card.includes('_purserStyles(') && card.includes('_purserProps(open.box, extra)'), 'the open styles stay class maps and the merge stays');
    // box(open.tint): tint's colour replaces the box's two colour rules
    const [alone, tinted] = run.applied.box;
    assert.ok(alone.some((d) => d.includes('color: var(--color-text)')) && alone.some((d) => d.includes(':hover|color: var(--color-accent)')));
    assert.ok(!tinted.some((d) => d.includes('color: var(--color-text)')) && tinted.some((d) => d === '||color: var(--color-accent)') && tinted.some((d) => d.includes('opacity')));
  }
});

test('globals still give way to fused classes, and fill the gap of a style that leaves one', { skip }, async () => {
  const dir = project();
  const plain = await compiled(dir, { granularity: 'rule', names: 'min', minify: true });
  for (const fuse of ['exact', 'max']) {
    const run = await compiled(dir, { granularity: 'rule', names: 'min', minify: true, fuse });
    const globals = (css) => /@layer purser\.globals\{(.*?)\}@layer/.exec(css)[1];
    // the button's background-color rule excludes every element that carries the base style's background, except in
    // the gap (not hovered, or no hover at all), where it names the class that marks the style
    const g = globals(run.result.css);
    assert.match(g, /button:not\([^)]*\)\{background-color:var\(--color-line\)\}/);
    assert.ok(/button\._[\w-]+:not\(:hover\)\{background-color/.test(g) || /button:is\([^)]*\):not\(:hover\)\{background-color/.test(g), g);
    // every class a global names exists on some element
    const used = new Set(Object.values(run.outcomes).flat().flatMap((list) => list.split(' ')));
    const named = [...g.matchAll(/\._[\w-]+/g)].map((m) => m[0].slice(1));
    assert.ok(named.length > 0);
    for (const cls of named) assert.ok(used.has(cls) || run.read('card.ts').includes(cls), `${cls} is applied somewhere`);
    assert.ok(globals(plain.result.css).includes('cursor:pointer') && g.includes('cursor:pointer'));
  }
});

test('a module the build has not seen cannot be compiled against a fused stylesheet', { skip }, async () => {
  const dir = project();
  const run = await compiled(dir, { granularity: 'rule', names: 'min', minify: true, fuse: 'exact' });
  // the same classes in a combination the build never saw: display:flex with the card's margin, without its gap
  const stranger = `import { css } from '@avonao/purser';\nconst s = css.create({ x: { display: 'flex', margin: '13px' } });\nexport const x = css.props(s.x);\n`;
  await assert.rejects(run.compiler.transform(stranger, path.join(dir, 'src/stranger.ts')), (err) => {
    assert.ok(err instanceof PlanError);
    assert.match(err.message, /has not seen/);
    assert.match(err.message, /stranger\.ts$/);
    return true;
  });
  // without fusion the same module compiles: every class has its own name
  const plain = await compiled(dir, { granularity: 'rule', names: 'min', minify: true });
  assert.ok((await plain.compiler.transform(stranger, path.join(dir, 'src/stranger.ts'))).code.includes('export const x = "'));
});

test('fuse needs minimal names', { skip }, async () => {
  const dir = project();
  assert.throws(() => createBuilder({ projectDir: dir, src: ['src'], tokens: 'src/tokens.ts', fuse: 'exact' }), /fuse needs names "min"/);
  assert.throws(() => createPluginCore({ projectDir: dir, tokens: 'src/tokens.ts', src: ['src'], out: 'src/purser.css', fuse: 'exact' }), /fuse needs names "min"/);
});

// --- across processes: the names file and its plan --------------------------------------------------------------------

const loader = require('../src/plugins/webpack-loader.cjs');
const runLoader = (dir, file, options) =>
  new Promise((resolve, reject) => {
    const source = fs.readFileSync(file, 'utf8');
    const dependencies = [];
    loader.call(
      { async: () => (err, code) => (err ? reject(err) : resolve({ code, dependencies })), getOptions: () => options, resourcePath: file, rootContext: dir, addDependency: (f) => dependencies.push(f) },
      source,
      undefined,
    );
  });

test('the loader reads fused names from the plan the build keeps, and plain names again after an unfused build', { skip }, async () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, 'node_modules'));
  const namesFile = path.join(dir, 'names.json');
  const options = { projectDir: dir, src: ['src'], tokens: 'src/tokens.ts', out: 'src/purser.css', granularity: 'rule', names: 'min', namesFile: 'names.json', minify: true, threads: 0 };
  const loaderOptions = { projectDir: dir, tokens: 'src/tokens.ts', granularity: 'rule', names: 'min', namesFile: 'names.json' };
  const classesIn = (code) => [...code.matchAll(/"((?: ?_[\w-]+)+)"/g)].flatMap((m) => m[1].trim().split(' '));

  const fused = await build({ ...options, fuse: 'max' });
  assert.deepEqual(fused.diagnostics, []);
  const planFile = planFileFor(namesFile, dir);
  assert.ok(planFile.startsWith(path.join(dir, 'node_modules', '.cache', 'purser')), 'the plan is derived data: it lives in the cache directory');
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  assert.equal(plan.level, 'max');
  const names = JSON.parse(fs.readFileSync(namesFile, 'utf8'));
  assert.ok(Object.values(names).every((v) => typeof v === 'string'), 'the names file stays a flat map of names');

  const one = await runLoader(dir, path.join(dir, 'src/button.ts'), loaderOptions);
  assert.deepEqual(one.dependencies, [namesFile, planFile], 'a bundler that caches modules compiles this one again when the names change');
  const css = fs.readFileSync(path.join(dir, 'src/purser.css'), 'utf8');
  assert.ok(classesIn(one.code).length > 0);
  for (const cls of classesIn(one.code)) assert.ok(css.includes(`.${cls}`), `fused class ${cls} is in the stylesheet`);
  assert.match(one.code, /plain = \(\): string => "_[\w-]+";/, 'one class for a call without guards');

  // an unfused build clears the plan; the same loader (same process, same options) follows
  await new Promise((r) => setTimeout(r, 20));
  const plain = await build(options);
  assert.equal(JSON.parse(fs.readFileSync(planFile, 'utf8')).level, null);
  const two = await runLoader(dir, path.join(dir, 'src/button.ts'), loaderOptions);
  const css2 = fs.readFileSync(path.join(dir, 'src/purser.css'), 'utf8');
  assert.notEqual(two.code, one.code);
  for (const cls of classesIn(two.code)) assert.ok(css2.includes(`.${cls}`), `class ${cls} is in the stylesheet`);
  assert.ok(/plain = \(\): string => "(_[\w-]+ ){3,}/.test(two.code), 'one class per rule again');
  assert.equal(plain.stats.fused, undefined);
});

// --- one-shot builds --------------------------------------------------------------------------------------------------

test('a build with nothing changed answers from its record; any change is seen', { skip }, async () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, 'node_modules'));
  const options = { projectDir: dir, src: ['src'], tokens: 'src/tokens.ts', out: 'src/purser.css', granularity: 'rule', names: 'min', namesFile: 'names.json', minify: true, fuse: 'exact', threads: 0 };
  const cache = path.join(dir, 'node_modules/.cache/purser');
  const first = await build(options);
  assert.equal(first.written, true);
  const record = fs.readdirSync(cache).find((f) => f.startsWith('build-'));
  assert.ok(record, 'a one-shot build leaves a record');
  // nothing changed: same result, nothing written, and the extraction cache is not even read
  fs.rmSync(path.join(cache, 'extract.json'));
  const second = await build(options);
  assert.equal(second.written, false);
  assert.equal(second.css, first.css);
  assert.deepEqual(second.stats, first.stats);
  assert.deepEqual(second.names, first.names);
  assert.ok(!fs.existsSync(path.join(cache, 'extract.json')), 'no work was done');
  // other options are another build
  const other = await build({ ...options, fuse: 'max' });
  assert.equal(other.written, true);
  assert.equal((await build({ ...options, fuse: 'max' })).written, false);
  assert.equal((await build(options)).written, true, 'the stylesheet on disk is the other build’s: write this one again');

  // a file changed without changing its size, right after the build (the clock cannot tell): the content decides
  const button = path.join(dir, 'src/button.ts');
  fs.writeFileSync(button, fs.readFileSync(button, 'utf8').replace("width: '137px'", "width: '138px'"));
  const changed = await build(options);
  assert.equal(changed.written, true);
  assert.ok(changed.css.includes('width:138px'));
  // a new file, a removed file
  fs.writeFileSync(path.join(dir, 'src/extra.ts'), `import { css } from '@avonao/purser';\nconst s = css.create({ a: { order: 5 } });\nexport const a = css.props(s.a);\n`);
  assert.ok((await build(options)).css.includes('order:5'));
  fs.rmSync(path.join(dir, 'src/extra.ts'));
  assert.ok(!(await build(options)).css.includes('order:5'));
  // the stylesheet or the names were touched: written again
  fs.appendFileSync(path.join(dir, 'src/purser.css'), '/* edited */');
  assert.equal((await build(options)).written, true);
  fs.rmSync(path.join(dir, 'names.json'));
  await build(options);
  assert.ok(fs.existsSync(path.join(dir, 'names.json')));
  // the tokens changed
  fs.writeFileSync(path.join(dir, 'src/tokens.ts'), TOKENS.replace("accent: '#f00'", "accent: '#0f0'"));
  const retinted = await build(options);
  assert.equal(retinted.written, true);
  assert.notEqual(retinted.css, changed.css);
  // a failed build leaves no record to answer from
  fs.writeFileSync(button, fs.readFileSync(button, 'utf8').replace("width: '138px'", "width: '138px', outlineColor: 'red'"));
  const failed = await build(options);
  assert.equal(failed.css, null);
  assert.ok(!fs.readdirSync(cache).some((f) => f === record), 'the record is gone');
  assert.equal((await build(options)).css, null, 'and the error is reported again');
});

test('a builder that is kept (a plugin, watch mode) always does the work: its names and records are read afterwards', { skip }, async () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, 'node_modules'));
  const options = { projectDir: dir, src: ['src'], tokens: 'src/tokens.ts', out: 'src/purser.css', granularity: 'rule', names: 'min', namesFile: 'names.json', threads: 0 };
  await build(options);
  const builder = createBuilder({ ...options, modules: true });
  await builder.run();
  assert.ok(builder.registry.size > 0, 'the registry was filled');
  const file = path.join(dir, 'src/button.ts');
  const { hashText } = await import('../src/build/cache.js');
  const known = builder.record(file, hashText(fs.readFileSync(file, 'utf8')));
  assert.ok(known && known.sites.length === 2, 'what the module compiles to is known');
  assert.equal(builder.record(file, 'another-hash'), undefined);
  assert.equal(builder.record(path.join(dir, 'src/main.ts'), hashText(MAIN)), undefined, 'a module without styles is left to the compiler’s own cheap test');
});

test('the compiler writes a module from the build’s record without parsing it again', { skip }, async () => {
  const dir = project();
  const core = createPluginCore({ projectDir: dir, tokens: 'src/tokens.ts', src: ['src'], out: 'src/purser.css', granularity: 'rule', names: 'min', fuse: 'exact', cache: false, threads: 0 });
  const result = await core.buildStylesheet();
  assert.deepEqual(result.diagnostics, []);
  const file = path.join(dir, 'src/button.ts');
  const code = fs.readFileSync(file, 'utf8');
  const fromRecord = await core.compiler.transform(code, file);
  // a compiler of its own (same registry, no records) parses the module and must write the same thing
  const alone = createCompiler({ projectDir: dir, tokens: 'src/tokens.ts', granularity: 'rule', names: 'min', registry: core.registry });
  const parsed = await alone.transform(code, file);
  assert.equal(fromRecord.code, parsed.code);
  assert.deepEqual(fromRecord.map, parsed.map);
  assert.ok(!fromRecord.code.includes('@avonao/purser'), 'nothing of the runtime is left');
  // a changed module is not in the record: it is parsed, and (fused) must still only apply groups the build has seen
  const edited = code.replace('export const plain', 'export const again = (): string => css.props(s.base);\nexport const plain');
  assert.ok((await core.compiler.transform(edited, file)).code.includes('again = (): string => "'));
});

test('a dev server or a watching build never fuses', { skip }, async () => {
  const dir = project();
  const dev = createPluginCore({ projectDir: dir, tokens: 'src/tokens.ts', src: ['src'], out: 'src/purser.css', names: 'min', fuse: 'max', cache: false }, { oneShot: false });
  assert.equal(dev.fuse, false);
  assert.equal((await dev.buildStylesheet()).stats.fused, undefined);
  const results = [];
  const watcher = await watch({ projectDir: dir, src: ['src'], tokens: 'src/tokens.ts', out: 'src/watched.css', names: 'min', fuse: 'max', cache: false }, (r) => results.push(r));
  watcher.close();
  assert.equal(results[0].stats.fused, undefined);
});

test('cli: --fuse', { skip }, async () => {
  const dir = project();
  let out = '';
  let err = '';
  const io = { stdout: (s) => (out += s), stderr: (s) => (err += s), cwd: dir };
  const args = ['build', '--src', 'src', '--tokens', 'src/tokens.ts', '--out', 'src/purser.css', '--names', 'min', '--granularity', 'rule', '--minify', '--no-cache'];
  assert.equal(await main([...args, '--fuse', 'exact'], io), 0, err);
  assert.match(out, /fused exact: \d+ classes as \d+/);
  assert.equal(await main([...args, '--fuse', 'most'], io), 1);
  assert.match(err, /fuse must be "exact", "balanced" or "max"/);
  err = '';
  assert.equal(await main(['build', '--src', 'src', '--tokens', 'src/tokens.ts', '--out', 'src/purser.css', '--fuse', 'exact', '--no-cache'], io), 1);
  assert.match(err, /fuse needs names "min"/);
});
