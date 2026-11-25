// Walk a page in Chrome through widths, root themes, hover and keyboard focus and assert that the strike counter
// finds nothing in any of them. Shared by the browser tests of every output mode.

import assert from 'node:assert/strict';

export async function assertNoStrikes(chrome, strikeScript) {
  const strikes = () => chrome.evaluate(strikeScript);
  const setWidth = (width) => chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  const setRoot = (cls) => chrome.evaluate(`document.documentElement.className = ${JSON.stringify(cls)}`);
  const hover = async (sel) => {
    const r = await chrome.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  };
  const assertClean = (report, label) => assert.equal(report.count, 0, `${label}: ${JSON.stringify(report.struck.slice(0, 5), null, 1)}`);
  const themes = ['', 'dark', 'hc', 'dark hc', 'bg2', 'bg0', 'dark bg2', 'bg2 bg0', 'dark hc bg2'];
  const hoverables = await chrome.evaluate(`[...document.querySelectorAll('[data-hover]')].map((e) => '#' + e.id)`);
  let checks = 0;
  for (const width of [500, 800, 1200]) {
    await setWidth(width);
    for (const theme of themes) {
      await setRoot(theme);
      await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 899 });
      const report = await strikes();
      assert.ok(report.rules > 20, 'the stylesheet is loaded');
      assertClean(report, `width ${width}, root "${theme}"`);
      checks++;
      for (const sel of hoverables) {
        await hover(sel);
        assertClean(await strikes(), `width ${width}, root "${theme}", hover ${sel}`);
        checks++;
      }
    }
  }
  await setRoot('');
  await chrome.evaluate('document.activeElement && document.activeElement.blur()');
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assertClean(await strikes(), 'focus-visible');
  return checks;
}

export const computedStyle = (chrome, sel, prop, pseudo = null) =>
  chrome.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}), ${JSON.stringify(pseudo)}).getPropertyValue(${JSON.stringify(prop)})`);

const LOOK = [
  'display', 'color', 'background-color', 'opacity', 'cursor', 'font-size', 'box-shadow', 'column-gap', 'row-gap',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border-top-width', 'border-top-style', 'border-top-color', 'border-left-width', 'border-left-style', 'border-left-color',
  'border-top-left-radius', 'outline-style', 'outline-color', 'animation-name', 'animation-duration',
];

/**
 * What a page looks like, as data: the computed values of every element (and its ::before) at three widths, under
 * three root themes, with the pointer away and on each hoverable element, and with keyboard focus. Two stylesheets
 * that give the same snapshot for the same markup style it the same way, whatever their classes are called.
 */
export async function snapshot(chrome) {
  const read = () =>
    chrome.evaluate(`(() => {
      const props = ${JSON.stringify(LOOK)};
      // an animation that is still running would make a value depend on when it is read
      for (const a of document.getAnimations()) a.finish();
      return [...document.querySelectorAll('body, body *')].map((el) => {
        const cs = getComputedStyle(el);
        const before = getComputedStyle(el, '::before');
        return [el.tagName + (el.id ? '#' + el.id : ''), props.map((p) => cs.getPropertyValue(p)).join('|'), before.getPropertyValue('content') + '|' + before.getPropertyValue('color')];
      });
    })()`);
  const setWidth = (width) => chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  const setRoot = (cls) => chrome.evaluate(`document.documentElement.className = ${JSON.stringify(cls)}`);
  const hover = async (sel) => {
    const r = await chrome.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  };
  // whatever looked at the page before may have left the keyboard focus on an element
  await chrome.evaluate('document.activeElement && document.activeElement.blur()');
  const hoverables = await chrome.evaluate(`[...document.querySelectorAll('[data-hover]')].map((e) => '#' + e.id)`);
  const out = {};
  for (const width of [500, 800, 1200]) {
    await setWidth(width);
    for (const theme of ['', 'dark', 'dark hc']) {
      await setRoot(theme);
      await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 899 });
      out[`${width} "${theme}"`] = await read();
      for (const sel of hoverables) {
        await hover(sel);
        out[`${width} "${theme}" hover ${sel}`] = await read();
      }
    }
  }
  await setRoot('');
  await chrome.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 899 });
  await chrome.evaluate('document.activeElement && document.activeElement.blur()');
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  out.focus = await read();
  return out;
}
