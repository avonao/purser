import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileStylesheet } from '../src/compile/stylesheet.js';
import { css } from '../src/index.js';

const layerBody = (out, name) => {
  const start = out.indexOf(`@layer ${name} {`);
  return start === -1 ? '' : out.slice(start, out.indexOf('\n}\n', start));
};

test('globals exclude elements that carry an atom class for the same property', () => {
  const style = { a: { marginTop: '4px' } };
  const cls = css.create(style).a['margin-top'];
  const { css: out } = compileStylesheet({
    calls: [
      { kind: 'globals', value: { '*': { margin: 0 } } },
      { kind: 'create', value: style },
    ],
  });
  const g = layerBody(out, 'purser.globals');
  assert.match(g, new RegExp(`\\*:not\\(\\.${cls}\\) \\{ margin-top: 0; \\}`));
  assert.match(g, /\n {2}\* \{\n {4}margin-bottom: 0;\n {4}margin-left: 0;\n {4}margin-right: 0;\n {2}\}/);
});

test('globals with the same selector are one rule, declarations sorted', () => {
  const { css: out } = compileStylesheet({
    calls: [{ kind: 'globals', value: { 'h1, h2': { fontWeight: 'inherit', fontSize: 'inherit' }, h1: { color: 'inherit' } } }],
  });
  const g = layerBody(out, 'purser.globals');
  assert.match(g, /\n {2}h1 \{\n {4}color: inherit;\n {4}font-size: inherit;\n {4}font-weight: inherit;\n {2}\}/);
  assert.match(g, /\n {2}h2 \{\n {4}font-size: inherit;\n {4}font-weight: inherit;\n {2}\}/);
  const selectors = [...g.matchAll(/^ {2}(\S[^{]*?) \{/gm)].map((m) => m[1]);
  assert.equal(new Set(selectors).size, selectors.length);
});

test('logical atoms exclude their physical twins in globals', () => {
  const style = { a: { marginBlockStart: '4px' } };
  const cls = css.create(style).a['margin-block-start'];
  const { css: out } = compileStylesheet({ calls: [{ kind: 'globals', value: { h1: { margin: 0 } } }, { kind: 'create', value: style }] });
  assert.match(out, new RegExp(`h1:not\\(\\.${cls}\\) \\{ margin-top: 0; \\}`));
});

test('later global rules win over earlier ones on the same element', () => {
  const { css: out } = compileStylesheet({
    calls: [{ kind: 'globals', value: { '*': { margin: 0 }, body: { marginTop: '8px' }, 'h1, h2': { marginBlockStart: '1px' } } }],
  });
  const g = layerBody(out, 'purser.globals');
  assert.match(g, /\*:not\(body\):not\(h1\):not\(h2\) \{ margin-top: 0; \}/);
  // Different tag names never match one element, so no :not(h1) on body.
  assert.match(g, /body \{ margin-top: 8px; \}/);
  assert.match(g, /h1 \{ margin-block-start: 1px; \}/);
  assert.match(g, /h2 \{ margin-block-start: 1px; \}/);
});

test('where an atom leaves the property unset, the global still applies', () => {
  const style = { a: { color: { ':hover': 'var(--x)' } } };
  const cls = css.create(style).a.color;
  const { css: out } = compileStylesheet({ calls: [{ kind: 'globals', value: { body: { color: 'var(--y)' } } }, { kind: 'create', value: style }] });
  assert.match(out, new RegExp(`body:not\\(\\.${cls}\\) \\{ color: var\\(--y\\); \\}`));
  assert.match(out, new RegExp(`body\\.${cls}:not\\(:hover\\) \\{ color: var\\(--y\\); \\}`));
});

test('globals support pseudo-elements, conditions and @font-face', () => {
  const { css: out, diagnostics } = compileStylesheet({
    calls: [
      {
        kind: 'globals',
        value: {
          ':root': { colorScheme: { default: 'light', ':is(.dark)': 'dark' } },
          'html::-webkit-scrollbar': { width: '8px' },
          '::selection': { backgroundColor: 'var(--color-sel)' },
          '@font-face': [{ fontFamily: 'A', src: 'url(a.woff2)' }, { fontFamily: 'B', src: 'url(b.woff2)' }],
        },
      },
    ],
  });
  assert.deepEqual(diagnostics, []);
  assert.match(out, /:root:not\(:is\(\.dark\)\) \{ color-scheme: light; \}/);
  assert.match(out, /html::-webkit-scrollbar \{ width: 8px; \}/);
  assert.match(out, /\*::selection \{ background-color: var\(--color-sel\); \}/);
  assert.equal(out.match(/@font-face/g).length, 2);
});

test('globals obey the same value rules', () => {
  const r = compileStylesheet({ calls: [{ kind: 'globals', value: { body: { color: '#000' } } }] });
  assert.equal(r.css, null);
  assert.match(r.diagnostics[0].message, /raw colour "#000"/);
  const r2 = compileStylesheet({ calls: [{ kind: 'globals', value: { '@keyframes x': {} } }] });
  assert.match(r2.diagnostics[0].message, /unsupported global at-rule/);
  const r3 = compileStylesheet({
    tokens: { tokens: { color: { a: '#000' } } },
    calls: [{ kind: 'globals', value: { ':root': { '--color-a': 'x' } } }],
  });
  assert.match(r3.diagnostics[0].message, /must not redeclare token --color-a/);
});

test('globals skip exclusions that the subject tag already rules out', () => {
  const { css: out } = compileStylesheet({
    calls: [{ kind: 'globals', value: { 'h1, button': { fontSize: 'inherit' }, '.site button': { fontSize: '13px' }, '.site h1': { fontSize: '2em' } } }],
  });
  const g = layerBody(out, 'purser.globals');
  assert.match(g, /\n {2}h1:not\(\.site h1\) \{ font-size: inherit; \}/);
  assert.match(g, /\n {2}button:not\(\.site button\) \{ font-size: inherit; \}/);
  assert.match(g, /\n {2}\.site button \{ font-size: 13px; \}/);
  assert.match(g, /\n {2}\.site h1 \{ font-size: 2em; \}/);
});

test('globals keep exclusions that tag names cannot decide', () => {
  const { css: out } = compileStylesheet({
    calls: [{ kind: 'globals', value: { '.a h1': { color: 'inherit' }, '.b h1': { color: 'currentcolor' }, a: { display: 'inline' }, 'svg|a': { display: 'block' } } }],
  });
  const g = layerBody(out, 'purser.globals');
  assert.match(g, /\n {2}\.a h1:not\(\.b h1\) \{ color: inherit; \}/);
  // svg|a is an `a` in the SVG namespace, not an svg element: the exclusion stays.
  assert.match(g, /\n {2}a:not\(svg\|a\) \{ display: inline; \}/);
});
