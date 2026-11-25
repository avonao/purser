// The bundler integrations: esbuild for real, Vite/Rollup and webpack through their hook contracts.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { purserEsbuild } from '../src/plugins/esbuild.js';
import { purser } from '../src/plugins/vite.js';
import { PurserWebpackPlugin } from '../src/plugins/webpack.js';
import { ROOT, tryRequire } from './helpers/host.js';

const require = createRequire(import.meta.url);
const ts = tryRequire('typescript');
const esbuild = tryRequire('esbuild');
const skip = ts ? false : 'typescript is not installed in the host project';
const temps = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function project() {
  const dir = fs.mkdtempSync(path.join(ROOT, 'tests/.plugin-'));
  temps.push(dir);
  const files = {
    'src/tokens.ts': `import { defineTokens } from '@avonao/purser';\nexport const t = defineTokens({ tokens: { color: { text: '#111', accent: '#f00' }, space: { 2: '8px' } } });\n`,
    'src/button.ts': `import { css } from '@avonao/purser';
import { t } from './tokens.ts';
const s = css.create({
  base: { color: { default: t.color.text, ':hover': t.color.accent }, padding: t.space[2] },
  on: { color: t.color.accent },
});
export const button = (on: boolean): string => css.props(s.base, on && s.on);
`,
    'src/main.ts': `import { button } from './button.ts';\nexport const classes = [button(false), button(true)];\n`,
  };
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
const classesIn = (css) => new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));

test('esbuild: the bundle has no style code and its class names are in the stylesheet the plugin wrote', { skip: skip || (esbuild ? false : 'esbuild is not installed') }, async () => {
  for (const naming of [{}, { granularity: 'rule', names: 'min' }]) {
    const dir = project();
    const result = await esbuild.build({
      absWorkingDir: dir,
      entryPoints: ['src/main.ts'],
      bundle: true,
      format: 'esm',
      write: false,
      minify: true,
      plugins: [purserEsbuild({ tokens: 'src/tokens.ts', src: ['src'], out: 'src/purser.css', ...naming })],
    });
    const js = result.outputFiles[0].text;
    assert.ok(js.length < 400, `only strings are left (${js.length} bytes): ${js}`);
    assert.ok(!js.includes('var(--'), 'no token values, no style objects');
    const css = fs.readFileSync(path.join(dir, 'src/purser.css'), 'utf8');
    assert.ok(!css.includes('\n  '), 'a minified build writes a minified stylesheet');
    const file = path.join(dir, 'bundle.mjs');
    fs.writeFileSync(file, js);
    const { classes } = await import(pathToFileURL(file).href);
    const known = classesIn(css);
    for (const list of classes) for (const cls of list.split(' ')) assert.ok(known.has(cls), `class ${cls} is in the stylesheet`);
    assert.notEqual(classes[0], classes[1]);
    if (naming.names === 'min') assert.ok(classes[0].split(' ').every((c) => /^_[\w-]{1,2}$/.test(c)), classes[0]);
  }
});

test('esbuild: a style that breaks a rule fails the build with the file and line', { skip: skip || (esbuild ? false : 'esbuild is not installed') }, async () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'src/bad.ts'), `import { css } from '@avonao/purser';\nexport const s = css.create({ a: { color: 'red' } });\n`);
  await assert.rejects(
    esbuild.build({ absWorkingDir: dir, entryPoints: ['src/main.ts'], bundle: true, write: false, logLevel: 'silent', plugins: [purserEsbuild({ tokens: 'src/tokens.ts', src: ['src'], out: 'src/purser.css' })] }),
    (err) => {
      assert.equal(err.errors.length, 1);
      assert.match(err.errors[0].text, /colou?r/);
      assert.match(err.errors[0].location.file, /bad\.ts$/);
      assert.equal(err.errors[0].location.line, 2);
      return true;
    },
  );
  assert.ok(!fs.existsSync(path.join(dir, 'src/purser.css')), 'nothing is written');
});

test('vite / rollup: buildStart writes the stylesheet, transform compiles, a change rewrites it', { skip }, async () => {
  const dir = project();
  const plugin = purser({ tokens: 'src/tokens.ts', src: ['src'], out: 'src/purser.css' });
  assert.equal(plugin.enforce, 'pre');
  const warnings = [];
  plugin.configResolved({ root: dir, command: 'build', mode: 'production', logger: { warn: (m) => warnings.push(m) } });
  const errors = [];
  await plugin.buildStart.call({ error: (m) => errors.push(m) });
  assert.deepEqual(errors, []);
  const css = fs.readFileSync(path.join(dir, 'src/purser.css'), 'utf8');
  assert.ok(css.startsWith('@layer purser.tokens,'), 'production build: minified');
  const file = path.join(dir, 'src/button.ts');
  const out = await plugin.transform(fs.readFileSync(file, 'utf8'), file);
  assert.ok(out.code.includes('=> ("') && !out.code.includes('css.props'));
  assert.equal(out.map.version, 3);
  assert.equal(await plugin.transform('export default 1', '\0virtual:x'), null);
  assert.equal(await plugin.transform('.a{}', path.join(dir, 'src/purser.css')), null);
  // a new style: the watcher hook rewrites the stylesheet
  fs.writeFileSync(path.join(dir, 'src/extra.ts'), `import { css } from '@avonao/purser';\nexport const s = css.create({ a: { display: 'grid' } });\n`);
  plugin.watchChange(path.join(dir, 'src/extra.ts'));
  for (let i = 0; i < 100 && !fs.readFileSync(path.join(dir, 'src/purser.css'), 'utf8').includes('display:grid'); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(fs.readFileSync(path.join(dir, 'src/purser.css'), 'utf8').includes('display:grid'));
  // an error while watching is a warning and the last good stylesheet stays
  fs.writeFileSync(path.join(dir, 'src/extra.ts'), `import { css } from '@avonao/purser';\nexport const s = css.create({ a: { color: 'red' } });\n`);
  plugin.watchChange(path.join(dir, 'src/extra.ts'));
  for (let i = 0; i < 100 && warnings.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.match(warnings.join('\n'), /extra\.ts:2:\d+: error: /);
  assert.ok(fs.readFileSync(path.join(dir, 'src/purser.css'), 'utf8').includes('display:grid'));
});

test('vite / rollup: a build with a broken style fails in buildStart', { skip }, async () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'src/bad.ts'), `import { css } from '@avonao/purser';\nexport const s = css.create({ a: { border: '1px solid' } });\n`);
  const plugin = purser({ projectDir: dir, tokens: 'src/tokens.ts', src: ['src'], out: 'src/purser.css' });
  const errors = [];
  await plugin.buildStart.call({ error: (m) => errors.push(m) });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /bad\.ts:2:\d+: error: /);
});

test('plugin options: src needs out, and minimal names need a build or a names file', { skip }, async () => {
  await assert.rejects(purser({ projectDir: ROOT, src: ['src'] }).transform('', '/x.ts'), /also needs out/);
  await assert.rejects(purser({ projectDir: ROOT, names: 'min' }).transform('', '/x.ts'), /names "min" are given by the build/);
});

test('webpack loader: compiles a module, passes others through, reads minimal names from the names file', { skip }, async () => {
  const dir = project();
  const loader = require('../src/plugins/webpack-loader.cjs');
  const run = (file, options) =>
    new Promise((resolve, reject) => {
      const source = fs.readFileSync(file, 'utf8');
      loader.call({ async: () => (err, code, map) => (err ? reject(err) : resolve({ code, map, source })), getOptions: () => options, resourcePath: file, rootContext: dir }, source, undefined);
    });
  const out = await run(path.join(dir, 'src/button.ts'), { tokens: 'src/tokens.ts' });
  assert.ok(!out.code.includes('css.props') && out.map.version === 3);
  const plain = await run(path.join(dir, 'src/main.ts'), { tokens: 'src/tokens.ts' });
  assert.equal(plain.code, plain.source);

  // minimal names: the names come from the file the stylesheet build keeps
  await assert.rejects(run(path.join(dir, 'src/button.ts'), { tokens: 'src/tokens.ts', names: 'min', namesFile: 'names.json' }), /has no name for class/);
  const { build } = await import('../src/build/index.js');
  const built = await build({ projectDir: dir, src: ['src'], tokens: 'src/tokens.ts', out: 'src/purser.css', names: 'min', namesFile: 'names.json', cache: false });
  assert.deepEqual(built.diagnostics, []);
  const min = await run(path.join(dir, 'src/button.ts'), { tokens: 'src/tokens.ts', names: 'min', namesFile: 'names.json' });
  const names = new Set(Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'names.json'), 'utf8'))));
  for (const cls of min.code.match(/_[\w-]{1,2}(?=[ "])/g)) assert.ok(names.has(cls), cls);
});

test('webpack plugin: adds the loader rule and writes the stylesheet before modules are built', { skip }, async () => {
  const dir = project();
  const taps = {};
  const hook = (name) => ({ tapPromise: (_n, fn) => (taps[name] = fn), tap: (_n, fn) => (taps[name] = fn) });
  const compiler = { context: dir, options: { mode: 'production', module: { rules: [] } }, hooks: { beforeCompile: hook('beforeCompile'), thisCompilation: hook('thisCompilation') } };
  new PurserWebpackPlugin({ tokens: 'src/tokens.ts', src: ['src'], out: 'src/purser.css', names: 'min' }).apply(compiler);
  const rule = compiler.options.module.rules[0];
  assert.equal(rule.enforce, 'pre');
  assert.ok(rule.use[0].loader.endsWith('webpack-loader.cjs'));
  assert.equal(rule.use[0].options.namesFile, 'node_modules/.cache/purser/names.json');
  assert.ok(!('src' in rule.use[0].options) && !('out' in rule.use[0].options));
  await taps.beforeCompile();
  assert.ok(fs.readFileSync(path.join(dir, 'src/purser.css'), 'utf8').startsWith('@layer purser.tokens,'));
  assert.ok(fs.existsSync(path.join(dir, 'node_modules/.cache/purser/names.json')));
  const compilation = { errors: [], warnings: [], hooks: { finishModules: hook('finishModules') } };
  taps.thisCompilation(compilation);
  await taps.finishModules();
  assert.deepEqual(compilation.errors, []);
});
