import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { ROOT, tryRequire } from './helpers/host.js';

const skip = tryRequire('typescript') ? false : 'typescript is not installed in the host project';
const bin = path.join(ROOT, 'bin/purser.js');
const run = async (args) => {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [bin, ...args], { cwd: ROOT });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
};

test('purser build writes the stylesheet and reports unchanged on a rerun', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purser-cli-'));
  const out = path.join(dir, 'purser.css');
  const args = ['build', '--project', 'tests/fixtures/app', '--src', 'app,components,lib', '--tokens', 'lib/tokens.ts', '--out', out];
  const first = await run(args);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /wrote .*purser\.css \(4 files, \d+ classes/);
  assert.equal(fs.readFileSync(out, 'utf8'), fs.readFileSync(path.join(ROOT, 'tests/fixtures/app/expected.css'), 'utf8'));
  const second = await run(args);
  assert.match(second.stdout, /unchanged/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('purser check passes on a clean project', { skip }, async () => {
  const r = await run(['check', '--project', 'tests/fixtures/app', '--src', 'app,components,lib', '--tokens', 'lib/tokens.ts']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /purser: ok/);
});

test('purser check exits 1 and lists every violation with file:line', { skip }, async () => {
  const r = await run(['check', '--project', 'tests/fixtures/bad', '--src', 'components', '--tokens', 'tokens.js']);
  assert.equal(r.code, 1);
  const lines = r.stderr.trim().split('\n');
  const at = (re) => lines.find((l) => re.test(l));
  assert.match(at(/window/) ?? '', /bad\.jsx:9:\d+: error: css\.create: "window" is not a static value/);
  assert.match(at(/raw colour/) ?? '', /bad\.jsx:5:\d+: error: raw colour "red"/);
  assert.match(at(/important/) ?? '', /bad\.jsx:6:\d+: error/);
  assert.match(at(/border/) ?? '', /bad\.jsx:7:\d+: error: "border" is not allowed/);
  assert.match(at(/unknown token/) ?? '', /bad\.jsx:8:\d+: error: unknown token --color-nope/);
  assert.match(lines.at(-1), /purser: 5 errors/);
});

test('usage errors exit 2; --help and --version exit 0', async () => {
  assert.equal((await run([])).code, 2);
  assert.equal((await run(['frobnicate', '--src', 'x'])).code, 2);
  assert.equal((await run(['build', '--src', 'x'])).code, 2);
  assert.equal((await run(['check'])).code, 2);
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /purser build/);
  assert.equal((await run(['--version'])).stdout.trim(), JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
});

test('purser build --watch rebuilds when a source file changes', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(ROOT, 'tests/fixtures/.watch-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.js'), "import { css } from '@avonao/purser';\nexport const s = css.create({ a: { opacity: 1 } });\n");
    const { watch } = await import('../src/build/index.js');
    const results = [];
    const w = await watch({ projectDir: dir, src: ['.'], out: 'out.css' }, (r) => results.push(r));
    assert.match(fs.readFileSync(path.join(dir, 'out.css'), 'utf8'), /opacity: 1;/);
    fs.writeFileSync(path.join(dir, 'a.js'), "import { css } from '@avonao/purser';\nexport const s = css.create({ a: { opacity: 0.5 } });\n");
    for (let i = 0; i < 50 && !fs.readFileSync(path.join(dir, 'out.css'), 'utf8').includes('opacity: 0.5'); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    w.close();
    assert.match(fs.readFileSync(path.join(dir, 'out.css'), 'utf8'), /opacity: 0\.5;/);
    assert.ok(results.length >= 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a custom css from createCss is extracted via --css-module with matching naming', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(ROOT, 'tests/fixtures/.custom-'));
  try {
    fs.mkdirSync(path.join(dir, 'lib'));
    fs.writeFileSync(path.join(dir, 'lib/css.js'), "import { createCss } from '@avonao/purser';\nexport const css = createCss({ prefix: 'p' });\n");
    fs.writeFileSync(path.join(dir, 'a.js'), "import { css } from './lib/css.js';\nexport const s = css.create({ a: { opacity: 1 } });\n");
    const { build } = await import('../src/build/index.js');
    const r = await build({ projectDir: dir, src: ['.'], cssModule: 'lib/css.js', prefix: 'p' });
    const { s } = await import(path.join(dir, 'a.js'));
    assert.match(s.a.opacity, /^p/);
    assert.ok(r.css.includes(`.${s.a.opacity} { opacity: 1; }`));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('purser build --layers names the layers in the written stylesheet', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purser-cli-'));
  const out = path.join(dir, 'purser.css');
  const r = await run(['build', '--project', 'tests/fixtures/app', '--src', 'app,components,lib', '--tokens', 'lib/tokens.ts', '--out', out, '--layers', 'p-tokens,p-globals,p-atoms']);
  assert.equal(r.code, 0, r.stderr);
  const text = fs.readFileSync(out, 'utf8');
  assert.ok(text.includes('\n@layer p-tokens, p-globals, p-atoms;\n'));
  assert.match(text, /\n@layer p-atoms \{\n/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('purser --layers rejects anything but three valid, different names (exit 2)', async () => {
  const base = ['check', '--src', 'components'];
  const two = await run([...base, '--layers', 'a,b']);
  assert.equal(two.code, 2);
  assert.match(two.stderr, /--layers takes three comma-separated names/);
  const bad = await run([...base, '--layers', 'a,b c,d']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--layers: layer name "b c" is not a CSS layer name/);
  const same = await run([...base, '--layers', 'a,a,b']);
  assert.equal(same.code, 2);
  assert.match(same.stderr, /three different names/);
});
