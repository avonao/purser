// The page fixture in real Chrome, once per output mode: rule granularity, a minified stylesheet, and compiled
// modules with minimal names. In every mode nothing may be struck through in any state, and the computed styles must
// be the ones the default mode gives. Skipped when Chrome is not installed.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from '../src/build/index.js';
import { createCompiler } from '../src/compiler/index.js';
import { createNameRegistry } from '../src/names.js';
import { hasChrome, launchChrome } from './helpers/cdp.js';
import { ROOT, tryRequire } from './helpers/host.js';
import { assertNoStrikes, computedStyle } from './helpers/page-states.js';

const skip = !hasChrome() ? 'Chrome not found' : !tryRequire('typescript') ? 'typescript is not installed in the host project' : false;
const page = path.join(ROOT, 'tests/fixtures/page');
const strikeScript = fs.readFileSync(path.join(ROOT, 'scripts/strike-count.js'), 'utf8');
const renderer = path.join(ROOT, 'tests/helpers/render-page.mjs');
const temps = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** Render the page body in a child process with the naming options in the environment. */
function renderWith(env, pageModule = path.join(page, 'page.js')) {
  return JSON.parse(execFileSync(process.execPath, [renderer, pageModule], { env: { ...process.env, ...env }, encoding: 'utf8' }));
}

async function inChrome(css, body, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purser-mode-'));
  temps.push(dir);
  fs.writeFileSync(path.join(dir, 'purser.css'), css);
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="purser.css"></head><body>${body}</body></html>`);
  const chrome = await launchChrome();
  try {
    await chrome.send('Page.navigate', { url: pathToFileURL(path.join(dir, 'index.html')).href });
    for (let i = 0; i < 50; i++) {
      if (await chrome.evaluate('document.readyState === "complete" && document.styleSheets.length === 1')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return await fn(chrome);
  } finally {
    chrome.close();
  }
}

/** The computed values the default mode is known to give (tests/browser.test.js): every mode must give the same. */
async function assertSameLook(chrome) {
  const setWidth = (width) => chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await chrome.evaluate(`document.documentElement.className = ''`);
  await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 899 });
  await setWidth(500);
  assert.equal(await computedStyle(chrome, '#card', 'display'), 'block');
  await setWidth(800);
  assert.equal(await computedStyle(chrome, '#card', 'display'), 'flex');
  await setWidth(1200);
  assert.equal(await computedStyle(chrome, '#card', 'display'), 'grid');
  assert.equal(await computedStyle(chrome, '#probe', 'color'), 'lab(65.4459 53.8462 44.2739)');
  assert.equal(await computedStyle(chrome, '#card', 'content', '::before'), '"•"');
  assert.equal(await computedStyle(chrome, 'body', 'color'), 'lab(9.2632 0 0)');
  assert.equal(await computedStyle(chrome, '#card-active h2', 'margin-top'), '16px');
  assert.equal(await computedStyle(chrome, 'main > p', 'margin-top'), '0px');
  await chrome.evaluate(`document.documentElement.className = 'dark hc'`);
  assert.equal(await computedStyle(chrome, 'body', 'color'), 'lab(100 0 0)');
}

for (const [label, options, env] of [
  ['rule granularity', { granularity: 'rule' }, { PURSER_GRANULARITY: 'rule' }],
  ['a minified stylesheet', { minify: true }, {}],
  ['rule granularity, minified, short names', { granularity: 'rule', minify: true, names: 'short', salt: 't' }, { PURSER_GRANULARITY: 'rule', PURSER_NAMES: 'short', PURSER_SALT: 't' }],
]) {
  test(`${label}: nothing is overridden in any state and the page looks the same`, { skip }, async () => {
    const result = await build({ projectDir: page, src: ['.'], tokens: 'tokens.js', cache: false, ...options });
    assert.deepEqual(result.diagnostics, []);
    const body = renderWith(env);
    for (const cls of new Set(body.match(/class="([^"]*)"/g).flatMap((m) => m.slice(7, -1).split(' ')))) {
      assert.ok(result.css.includes(`.${cls}`), `class ${cls} has CSS`);
    }
    await inChrome(result.css, body, async (chrome) => {
      assert.ok((await assertNoStrikes(chrome, strikeScript)) > 50);
      await assertSameLook(chrome);
    });
  });
}

test('compiled modules with minimal names: nothing is overridden and the page looks the same', { skip }, async () => {
  // The registry is shared: the build ranks the classes, the compiler writes the same names into the modules.
  const registry = createNameRegistry();
  const naming = { granularity: 'rule', names: 'min' };
  const result = await build({ projectDir: page, src: ['.'], tokens: 'tokens.js', cache: false, minify: true, registry, ...naming });
  assert.deepEqual(result.diagnostics, []);
  const compiler = createCompiler({ projectDir: page, tokens: 'tokens.js', registry, ...naming });
  // Inside the repository, so `@avonao/purser/compiled` resolves to this package.
  const out = fs.mkdtempSync(path.join(ROOT, 'tests/.compiled-'));
  temps.push(out);
  for (const name of ['page.js', 'styles.js', 'tokens.js']) {
    const file = path.join(page, name);
    const code = fs.readFileSync(file, 'utf8');
    const compiled = await compiler.transform(code, file);
    fs.writeFileSync(path.join(out, name), compiled ? compiled.code : code);
  }
  const compiledPage = fs.readFileSync(path.join(out, 'page.js'), 'utf8');
  assert.ok(!compiledPage.includes('css.props'), 'every css.props call was folded');
  const body = renderWith({}, path.join(out, 'page.js'));
  const classes = new Set(body.match(/class="([^"]*)"/g).flatMap((m) => m.slice(7, -1).split(' ')));
  for (const cls of classes) {
    assert.match(cls, /^_[\w-]{1,2}$/, 'minimal names are an underscore and one or two characters');
    assert.ok(result.css.includes(`.${cls}`), `class ${cls} has CSS`);
  }
  await inChrome(result.css, body, async (chrome) => {
    assert.ok((await assertNoStrikes(chrome, strikeScript)) > 50);
    await assertSameLook(chrome);
  });
});
