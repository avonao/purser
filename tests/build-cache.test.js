// The builder's shortcuts: the extraction cache on disk, the tokens module read without running it, and the parser
// fallback for projects whose own TypeScript has no parser API.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { build, createBuilder } from '../src/build/index.js';
import { extractStaticExports } from '../src/build/extract.js';
import { loadTypeScript } from '../src/build/host.js';
import { loadTokensModule, readTokensModule } from '../src/build/load-tokens.js';
import { ROOT, tryRequire } from './helpers/host.js';

const ts = tryRequire('typescript');
const skip = ts ? false : 'typescript is not installed in the host project';
const temps = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function project(files) {
  // inside the repository, so `@avonao/purser` and `typescript` resolve
  const dir = fs.mkdtempSync(path.join(ROOT, 'tests/.project-'));
  temps.push(dir);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
const TOKENS = `import { defineTokens } from '@avonao/purser';
export const bp = { md: '@media (width >= 768px)' } as const;
const base = 4;
export const t = defineTokens({ tokens: { color: { text: '#111' }, space: { 1: \`\${base}px\`, 2: '8px' } } });
`;
const A = `import { css } from '@avonao/purser';
import { bp, t } from '../tokens.ts';
export const s = css.create({ a: { color: t.color.text, gap: { default: t.space[1], [bp.md]: t.space[2] } } });
`;
const B = `import { css } from '@avonao/purser';
export const s = css.create({ b: { display: 'grid' } });
`;

test('a second build takes every file from the cache and writes the same stylesheet', { skip }, async () => {
  const dir = project({ 'tokens.ts': TOKENS, 'src/a.ts': A, 'src/b.ts': B, 'src/plain.ts': 'export const x = 1;\n' });
  const options = { projectDir: dir, src: ['src'], tokens: 'tokens.ts', cache: '.cache', threads: 0 };
  const first = await build(options);
  assert.deepEqual(first.diagnostics, []);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, '.cache/extract.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored.files).sort(), ['src/a.ts', 'src/b.ts'], 'files without Purser calls are not stored');
  assert.ok(stored.tokens, 'the tokens module was read from its source and stored');
  // Break the parser: a build that still works did not parse anything.
  const cached = createBuilder(options);
  const mtime = fs.statSync(path.join(dir, '.cache/extract.json')).mtimeMs;
  const second = await cached.run();
  assert.equal(second.css, first.css);
  assert.deepEqual(second.stats, first.stats);
  assert.equal(fs.statSync(path.join(dir, '.cache/extract.json')).mtimeMs, mtime, 'nothing changed, nothing written');
  // cache: false gives the same answer
  assert.equal((await build({ ...options, cache: false })).css, first.css);
});

test('a changed or removed file is parsed again; other options have their own entries', { skip }, async () => {
  const dir = project({ 'tokens.ts': TOKENS, 'src/a.ts': A, 'src/b.ts': B });
  const options = { projectDir: dir, src: ['src'], tokens: 'tokens.ts', cache: '.cache', threads: 0 };
  const first = await build(options);
  fs.writeFileSync(path.join(dir, 'src/b.ts'), B.replace("'grid'", "'flex'"));
  const second = await build(options);
  assert.ok(second.css.includes('display: flex') && !second.css.includes('display: grid'));
  fs.rmSync(path.join(dir, 'src/b.ts'));
  await build(options);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, '.cache/extract.json'), 'utf8')).files), ['src/a.ts']);
  // a changed token value changes what a.ts evaluates to
  fs.writeFileSync(path.join(dir, 'tokens.ts'), TOKENS.replace("2: '8px'", "2: '8px', 3: '12px'"));
  fs.writeFileSync(path.join(dir, 'src/a.ts'), A.replace('t.space[2]', 't.space[3]'));
  const third = await build(options);
  assert.deepEqual(third.diagnostics, []);
  assert.ok(third.css.includes('var(--space-3)'));
  assert.notEqual(first.css, third.css);
});

test('a diagnostic for a cached file still points at the line and column', { skip }, async () => {
  const dir = project({
    'tokens.ts': TOKENS,
    'src/a.ts': `import { css } from '@avonao/purser';\nexport const s = css.create({\n  a: {\n    color: '#ff0000',\n  },\n});\n`,
  });
  const options = { projectDir: dir, src: ['src'], tokens: 'tokens.ts', cache: '.cache', threads: 0 };
  const first = await build(options);
  const second = await build(options);
  for (const result of [first, second]) {
    assert.equal(result.css, null);
    assert.equal(result.diagnostics.length, 1);
    assert.deepEqual([result.diagnostics[0].line, result.diagnostics[0].column], [4, 5]);
    assert.match(result.diagnostics[0].message, /colour|color/);
  }
});

test('worker threads give the same stylesheet as one thread', { skip }, async () => {
  const files = { 'tokens.ts': TOKENS };
  for (let i = 0; i < 80; i++) {
    files[`src/c${i}.tsx`] = `import { css } from '@avonao/purser';\nimport { bp, t } from '../tokens.ts';\nconst s = css.create({ a: { gap: { default: t.space[1], [bp.md]: t.space[2] }, order: ${i}, zIndex: ${i % 7} } });\nexport const c = () => <i className={css.props(s.a)} />;\n`;
  }
  files['src/bad.ts'] = `import { css } from '@avonao/purser';\nlet n = 1;\nexport const s = css.create({ a: { order: n } });\n`;
  const dir = project(files);
  const one = await build({ projectDir: dir, src: ['src'], tokens: 'tokens.ts', cache: false, threads: 0 });
  const many = await build({ projectDir: dir, src: ['src'], tokens: 'tokens.ts', cache: false, threads: 3 });
  assert.equal(one.diagnostics.length, 1);
  assert.deepEqual(many.diagnostics, one.diagnostics, 'a file with an error is reported the same way');
  fs.rmSync(path.join(dir, 'src/bad.ts'));
  const a = await build({ projectDir: dir, src: ['src'], tokens: 'tokens.ts', cache: false, threads: 0 });
  const b = await build({ projectDir: dir, src: ['src'], tokens: 'tokens.ts', cache: false, threads: 3 });
  assert.deepEqual(b.diagnostics, []);
  assert.equal(b.css, a.css);
  assert.equal(b.stats.atoms, a.stats.atoms);
  // what the modules compile to comes back from the threads too: a fused stylesheet is planned from it
  const fused = { projectDir: dir, src: ['src'], tokens: 'tokens.ts', cache: false, names: 'min', granularity: 'rule', minify: true, fuse: 'exact' };
  const fa = await build({ ...fused, threads: 0 });
  const fb = await build({ ...fused, threads: 3 });
  assert.deepEqual(fb.diagnostics, []);
  assert.equal(fb.css, fa.css);
  assert.deepEqual(fb.stats, fa.stats);
  assert.ok(fa.stats.fused.classes < fa.stats.fused.ids);
});

test('a tokens module of literals and const bindings is read without running it', { skip }, async () => {
  const dir = project({ 'tokens.ts': TOKENS });
  const file = path.join(dir, 'tokens.ts');
  const read = await readTokensModule(file, { ts });
  assert.equal(read.static, true);
  const viaSource = await loadTokensModule(file, { ts });
  process.env.PURSER_TOKENS = 'run';
  let viaRun;
  try {
    viaRun = await loadTokensModule(file, { ts });
  } finally {
    delete process.env.PURSER_TOKENS;
  }
  assert.deepEqual(viaSource.definition, viaRun.definition);
  assert.deepEqual(viaSource.exports, viaRun.exports);
  assert.equal(viaSource.exportName, 't');
  assert.equal(viaSource.exports.t.space[1], 'var(--space-1)');
  assert.deepEqual(viaSource.exports.bp, { md: '@media (width >= 768px)' });
});

test('a tokens module that computes is run instead, with the same result as before', { skip }, async () => {
  const dir = project({
    'tokens.mjs': `import { defineTokens } from '@avonao/purser';\nconst scale = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, \`\${(i + 1) * 4}px\`]));\nexport const steps = [1, 2, 3].map((x) => x * 2);\nexport const t = defineTokens({ tokens: { space: scale(3) } });\n`,
  });
  const file = path.join(dir, 'tokens.mjs');
  assert.equal(extractStaticExports(file, fs.readFileSync(file, 'utf8'), { ts, packageName: '@avonao/purser' }).ok, false);
  const read = await readTokensModule(file, { ts });
  assert.equal(read.static, false);
  const loaded = await loadTokensModule(file, { ts });
  assert.deepEqual(loaded.definition.tokens.space, { 1: '4px', 2: '8px', 3: '12px' });
  assert.deepEqual(loaded.exports.steps, [2, 4, 6]);
});

test('what cannot be read from the source is not guessed', { skip }, () => {
  const check = (text) => extractStaticExports('/virtual/tokens.ts', text, { ts, packageName: '@avonao/purser' });
  assert.equal(check(`export const a = { x: 1 } as const;\nexport const b = [a.x, 'y'];\nexport type T = number;\nexport function f() {}\nexport const g = () => 1;`).ok, true);
  assert.deepEqual(check(`const inner = { x: 1 };\nexport { inner as outer };`).statics, { outer: { x: 1 } });
  assert.equal(check(`export * from './other';`).ok, false);
  assert.equal(check(`import './side-effect';\nexport const a = 1;`).ok, false);
  assert.equal(check(`export const a = Math.max(1, 2);`).ok, false);
  assert.equal(check(`export let a = 1;`).ok, false);
  assert.equal(check(`console.log(1);\nexport const a = 1;`).ok, false);
  assert.equal(check(`import { x } from './x';\nexport const a = x;`).ok, false);
});

test('a project on TypeScript 7 (no parser API) builds with the parser Purser depends on', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purser-ts7-'));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, 'node_modules/typescript'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules/typescript/package.json'), JSON.stringify({ name: 'typescript', version: '7.0.2', main: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'node_modules/typescript/index.js'), `module.exports = { version: '7.0.2', versionMajorMinor: '7.0' };\n`);
  const loaded = loadTypeScript(dir);
  assert.equal(typeof loaded.createSourceFile, 'function');
  assert.notEqual(loaded.version, '7.0.2');
  // and a project with no TypeScript at all
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'purser-bare-'));
  temps.push(bare);
  assert.equal(typeof loadTypeScript(bare).createSourceFile, 'function');
});
