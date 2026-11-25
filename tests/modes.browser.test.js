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
import { assertNoStrikes, computedStyle, snapshot } from './helpers/page-states.js';

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

/** A copy of the page fixture that imports the runtime from another entry (inside the repository, so it resolves). */
function pageWith(specifier) {
  const out = fs.mkdtempSync(path.join(ROOT, 'tests/.page-'));
  temps.push(out);
  for (const name of ['page.js', 'styles.js', 'tokens.js']) {
    fs.writeFileSync(path.join(out, name), fs.readFileSync(path.join(page, name), 'utf8').replaceAll(`from '@avonao/purser'`, `from '${specifier}'`));
  }
  return path.join(out, 'page.js');
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
  ['rule granularity', { granularity: 'rule' }, {}],
  ['a minified stylesheet', { minify: true }, {}],
  ['rule granularity, minified, short names', { granularity: 'rule', minify: true, names: 'short', salt: 't' }, { PURSER_NAMES: 'short', PURSER_SALT: 't' }],
]) {
  test(`${label}: nothing is overridden in any state and the page looks the same`, { skip }, async () => {
    const result = await build({ projectDir: page, src: ['.'], tokens: 'tokens.js', cache: false, ...options });
    assert.deepEqual(result.diagnostics, []);
    // the main entry computes one class per property; rule granularity is the runtime in @avonao/purser/rule
    const body = renderWith(env, options.granularity === 'rule' ? pageWith('@avonao/purser/rule') : undefined);
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

// --- fused classes ----------------------------------------------------------------------------------------------------

/**
 * The page with its styles in the module that applies them, so every css.props call is folded and the build knows
 * every group of classes; plus two styles that are still merged at run time, and a global that a style's gap must let
 * through.
 */
function staticPage() {
  const dir = fs.mkdtempSync(path.join(ROOT, 'tests/.fused-'));
  temps.push(dir);
  const styles = fs.readFileSync(path.join(page, 'styles.js'), 'utf8').replace('export const s', 'const s');
  fs.writeFileSync(path.join(dir, 'tokens.js'), fs.readFileSync(path.join(page, 'tokens.js'), 'utf8'));
  fs.writeFileSync(
    path.join(dir, 'page.js'),
    `${styles}
css.globals({ button: { backgroundColor: t.color.line, opacity: 0.9 } });
export const kept = css.create({
  note: { color: t.color.focus, paddingInline: t.space[1], borderWidth: 1, borderStyle: 'dashed', borderColor: { default: t.color.line, ':hover': t.color.accent } },
  loud: { color: t.color.accent, fontSize: '20px', borderColor: t.color.focus },
});
const pick = (extra) => css.props(kept.note, extra);

export function renderBody(flags = { active: true, wide: true, off: false }) {
  return \`
<main class="\${css.props(s.page)}">
  <h1 class="\${css.props(s.title)}">Fixture</h1>
  <p>Global margins only.</p>
  <section id="card" data-hover class="\${css.props(s.card, flags.off && s.active)}"><h2 class="\${css.props(s.title)}">Card</h2><p class="\${css.props(s.wide)}">Body</p></section>
  <section id="card-active" data-hover class="\${css.props(s.card, flags.active && s.active)}"><h2 class="\${css.props(s.title, flags.wide ? s.wide : null)}">Active</h2></section>
  <button id="btn" data-hover data-focus class="\${css.props(s.button)}">Button</button>
  <button id="btn-pressed" data-hover aria-pressed="true" class="\${css.props(s.button)}">Pressed</button>
  <button id="btn-disabled" data-hover disabled class="\${css.props(s.button, flags.off ? s.wide : undefined)}">Disabled</button>
  <button id="btn-bare" data-hover>Bare</button>
  <span id="probe" class="\${css.props(s.probe)}">probe</span>
  <span id="note" data-hover class="\${pick(null)}">note</span>
  <span id="note-loud" data-hover class="\${pick(kept.loud)}">loud</span>
</main>\`;
}
`,
  );
  return dir;
}

test('fused classes: every level styles the page exactly as the default mode does, and nothing is overridden', { skip }, async () => {
  const dir = staticPage();
  // The reference: the runtime and the default stylesheet (one class per property, the long names).
  const plain = await build({ projectDir: dir, src: ['.'], tokens: 'tokens.js', cache: false });
  assert.deepEqual(plain.diagnostics, []);
  const reference = await inChrome(plain.css, renderWith({}, path.join(dir, 'page.js')), async (chrome) => {
    await assertSameLook(chrome);
    return snapshot(chrome);
  });
  assert.ok(Object.keys(reference).length > 60, 'the page was looked at in many states');
  assert.ok(new Set(Object.values(reference).map((state) => JSON.stringify(state))).size > 20, 'and the states differ');

  const naming = { granularity: 'rule', names: 'min' };
  let fewest = Infinity;
  for (const fuse of ['exact', 'balanced', 'max']) {
    const registry = createNameRegistry();
    const result = await build({ projectDir: dir, src: ['.'], tokens: 'tokens.js', cache: false, minify: true, registry, fuse, ...naming });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.stats.fused.level, fuse);
    const compiler = createCompiler({ projectDir: dir, tokens: 'tokens.js', registry, ...naming });
    const out = fs.mkdtempSync(path.join(ROOT, 'tests/.compiled-'));
    temps.push(out);
    for (const name of ['page.js', 'tokens.js']) {
      const file = path.join(dir, name);
      const code = fs.readFileSync(file, 'utf8');
      const compiled = await compiler.transform(code, file);
      fs.writeFileSync(path.join(out, name), compiled ? compiled.code : code);
    }
    const compiledPage = fs.readFileSync(path.join(out, 'page.js'), 'utf8');
    assert.ok(!compiledPage.includes('css.'), 'nothing of the css API is left');
    assert.ok(compiledPage.includes('_purserProps(kept.note, extra)'), 'the run-time merge stays a merge');
    const body = renderWith({}, path.join(out, 'page.js'));
    const lists = body.match(/class="([^"]*)"/g).map((m) => m.slice(7, -1).split(' '));
    for (const cls of new Set(lists.flat())) assert.ok(result.css.includes(`.${cls}`), `class ${cls} has CSS`);
    const count = lists.flat().length;
    assert.ok(count <= fewest, `${fuse}: no more classes on the page than one level lower`);
    fewest = count;
    if (fuse === 'max') assert.equal(lists.find((l) => body.includes(`id="probe" class="${l.join(' ')}"`)).length, 1, 'a call without guards is one class');
    await inChrome(result.css, body, async (chrome) => {
      // in the order the reference was taken: where the keyboard focus goes next depends on where it was
      await assertSameLook(chrome);
      assert.deepEqual(await snapshot(chrome), reference, `fuse ${fuse}`);
      assert.ok((await assertNoStrikes(chrome, strikeScript)) > 50);
    });
  }
});
