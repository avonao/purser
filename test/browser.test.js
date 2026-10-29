// Integration test in real Chrome: build the page fixture, render it, and
// assert that no declaration is struck through at several widths, root
// themes, hover and focus states. Skipped when Chrome is not installed.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from '../src/build/index.js';
import { parseColor } from '../src/color.js';
import { hasChrome, launchChrome } from './helpers/cdp.js';
import { ROOT, tryRequire } from './helpers/host.js';

const skip = !hasChrome() ? 'Chrome not found' : !tryRequire('typescript') ? 'typescript is not installed in the host project' : false;
const page = path.join(ROOT, 'test/fixtures/page');
const strikeScript = fs.readFileSync(path.join(ROOT, 'scripts/strike-count.js'), 'utf8');
let chrome;
let dir;

before(async () => {
  if (skip) return;
  const result = await build({ projectDir: page, src: ['.'], tokens: 'tokens.js' });
  assert.deepEqual(result.diagnostics, []);
  const { renderBody } = await import(path.join(page, 'page.js'));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purser-page-'));
  fs.writeFileSync(path.join(dir, 'purser.css'), result.css);
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="purser.css"></head><body>${renderBody()}</body></html>`,
  );
  chrome = await launchChrome();
  await chrome.send('Page.navigate', { url: pathToFileURL(path.join(dir, 'index.html')).href });
  for (let i = 0; i < 50; i++) {
    if ((await chrome.evaluate('document.readyState === "complete" && document.styleSheets.length === 1'))) break;
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(() => {
  chrome?.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const strikes = () => chrome.evaluate(strikeScript);
const setWidth = (width) => chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
const setRoot = (cls) => chrome.evaluate(`document.documentElement.className = ${JSON.stringify(cls)}`);
const computed = (sel, prop, pseudo = null) => chrome.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}), ${JSON.stringify(pseudo)}).getPropertyValue(${JSON.stringify(prop)})`);
const hover = async (sel) => {
  const r = await chrome.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
};
const assertClean = (report, label) => assert.equal(report.count, 0, `${label}: ${JSON.stringify(report.struck.slice(0, 5), null, 1)}`);

test('the strike counter detects a real override (sanity check)', { skip }, async () => {
  await chrome.evaluate(`(() => { const s = document.createElement('style'); s.id = 'plant'; s.textContent = '#probe { color: lab(1 2 3); } #probe { color: lab(4 5 6); }'; document.head.append(s); })()`);
  const report = await strikes();
  assert.equal(report.count, 1);
  assert.equal(report.struck[0].property, 'color');
  await chrome.evaluate(`document.getElementById('plant').remove()`);
  assertClean(await strikes(), 'after removing the plant');
});

test('no declaration is overridden at any width, theme, hover or focus state', { skip }, async () => {
  const themes = ['', 'dark', 'hc', 'dark hc', 'bg2', 'bg0', 'dark bg2', 'bg2 bg0', 'dark hc bg2'];
  const hoverables = await chrome.evaluate(`[...document.querySelectorAll('[data-hover]')].map((e) => '#' + e.id)`);
  let checks = 0;
  for (const width of [500, 800, 1200]) {
    await setWidth(width);
    for (const theme of themes) {
      await setRoot(theme);
      await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 899 });
      assertClean(await strikes(), `width ${width}, root "${theme}"`);
      checks++;
      for (const sel of hoverables) {
        await hover(sel);
        assert.equal(await chrome.evaluate(`document.querySelector(${JSON.stringify(sel)}).matches(':hover')`), true);
        assertClean(await strikes(), `width ${width}, root "${theme}", hover ${sel}`);
        checks++;
      }
    }
  }
  // Keyboard focus (:focus-visible).
  await setRoot('');
  await chrome.evaluate('document.activeElement && document.activeElement.blur()');
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await chrome.evaluate(`document.activeElement.id`), 'btn');
  assert.equal(await chrome.evaluate(`document.activeElement.matches(':focus-visible')`), true);
  assertClean(await strikes(), 'focus-visible');
  await hover('#btn');
  assertClean(await strikes(), 'focus-visible + hover');
  assert.ok(checks > 50);
});

test('the compiled styles actually apply', { skip }, async () => {
  await setRoot('');
  await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 899 });
  await setWidth(500);
  assert.equal(await computed('#card', 'display'), 'block');
  await setWidth(800);
  assert.equal(await computed('#card', 'display'), 'flex');
  await setWidth(1200);
  assert.equal(await computed('#card', 'display'), 'grid');
  assert.equal(await computed('#probe', 'color'), 'lab(65.4459 53.8462 44.2739)');
  assert.equal(await computed('#card', 'content', '::before'), '"•"');
  // Theme tokens follow the root classes.
  assert.equal(await computed('body', 'color'), 'lab(9.2632 0 0)');
  await setRoot('dark hc');
  assert.equal(await computed('body', 'color'), 'lab(100 0 0)');
  await setRoot('');
  // Hover switches the card colour to the accent token.
  await hover('#card');
  assert.equal(await computed('#card', 'color'), 'lab(65.4459 53.8462 44.2739)');
  // Logical/physical: the later marginTop replaced margin-block-start, and the reset gave way.
  assert.equal(await computed('#card-active h2', 'margin-top'), '16px');
  assert.equal(await computed('#card p', 'margin-top'), '16px');
  assert.equal(await computed('main > p', 'margin-top'), '0px');
});

test('lab() conversion agrees with Chrome for many inputs', { skip }, async () => {
  const supported = await chrome.evaluate(`CSS.supports('color', 'lab(from red l a b)')`);
  if (!supported) return;
  const inputs = ['oklch(71.57% 0.1797 33.51)', '#fff', '#000', '#1a1a1a', '#ff0000', '#00ff00', '#0000ff', 'rgb(18 52 86 / 0.5)', 'hsl(210 100% 50%)', 'hwb(120 20% 30%)', 'oklab(0.5 0.1 -0.1)', 'oklch(55% 0.01 260)', 'lch(60% 40 300)', 'color(display-p3 1 0.8 0.2 / 0.4)', 'rebeccapurple', 'transparent'];
  for (const input of inputs) {
    const chromeValue = await chrome.evaluate(`(() => { const e = document.createElement('i'); document.body.append(e); e.style.color = ${JSON.stringify(`lab(from ${input} l a b / alpha)`)}; const v = getComputedStyle(e).color; e.remove(); return v; })()`);
    const m = /^lab\(([-\d.e]+) ([-\d.e]+) ([-\d.e]+)(?: \/ ([\d.e]+))?\)$/.exec(chromeValue);
    assert.ok(m, `${input}: Chrome returned ${chromeValue}`);
    const ours = parseColor(input);
    const theirs = { l: +m[1], a: +m[2], b: +m[3], alpha: m[4] === undefined ? 1 : +m[4] };
    // Chrome's relative-colour path computes in float32 (it reports a = 0.0188 for #fff,
    // where the exact value is 0), so agreement is checked to 0.025; the exact
    // reference vector from the spec is asserted in test/color.test.js.
    for (const k of ['l', 'a', 'b', 'alpha']) assert.ok(Math.abs(ours[k] - theirs[k]) < 0.025, `${input} ${k}: ours ${ours[k]} vs Chrome ${theirs[k]}`);
  }
});
