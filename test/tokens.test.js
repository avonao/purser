import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTokens } from '../src/compile/tokens.js';
import { defineTokens } from '../src/index.js';

const AXES = {
  mode: { light: ':not(.dark)', dark: '.dark' },
  contrast: { normal: ':not(.hc)', high: '.hc' },
  wallpaper: { a: ':not(.bg2):not(.bg0)', b: '.bg2', none: '.bg0' },
};
const TOKENS = {
  color: {
    text: { default: '#111', 'mode=dark': '#eee', 'contrast=high': '#000', 'mode=dark&contrast=high': '#fff' },
    accent: 'oklch(71.57% 0.1797 33.51)',
    surface: { default: '#fff', 'mode=dark': '#121212', 'wallpaper=b': 'rgb(255 255 255 / 0.7)', 'mode=dark&wallpaper=b': 'rgb(18 18 18 / 0.7)' },
    line: { default: '#0000001a', 'mode=dark': '#ffffff1f' },
  },
  space: { 4: '16px' },
  shadow: { card: '0 1px 2px rgb(0 0 0 / 0.2)' },
};

/** Independent evaluator for rendered root selectors like ":root.dark:not(.hc)". */
function rootMatches(selector, classes) {
  assert.match(selector, /^:root/);
  const rest = selector.slice(':root'.length);
  for (const m of rest.matchAll(/:not\(\.([\w-]+)\)|\.([\w-]+)/g)) {
    if (m[1] && classes.has(m[1])) return false;
    if (m[2] && !classes.has(m[2])) return false;
  }
  return true;
}

test('every root state declares each token exactly once, with the resolved value', () => {
  const { rules } = compileTokens({ axes: AXES, tokens: TOKENS });
  const all = ['dark', 'hc', 'bg2', 'bg0'];
  for (let mask = 0; mask < 16; mask++) {
    const classes = new Set(all.filter((_, i) => mask & (1 << i)));
    const declared = new Map();
    for (const r of rules) {
      assert.equal(r.atRules.length, 0);
      if (!r.selectors.some((s) => rootMatches(s, classes))) continue;
      for (const [name, value] of r.decls) {
        assert.ok(!declared.has(name), `${name} declared twice for [${[...classes]}]`);
        declared.set(name, value);
      }
    }
    assert.equal(declared.size, 6, `all tokens declared for [${[...classes]}]`);
    const dark = classes.has('dark');
    const hc = classes.has('hc');
    const b = classes.has('bg2') && !classes.has('bg0'); // later axis value wins: none beats b
    const text = dark && hc ? 'lab(100 0 0)' : hc ? 'lab(0 0 0)' : dark ? 'lab(94.0978 0 0)' : 'lab(5.0633 0 0)';
    assert.equal(declared.get('--color-text'), text);
    assert.equal(declared.get('--color-surface'), dark ? (b ? 'lab(5.4639 0 0 / 0.7)' : 'lab(5.4639 0 0)') : b ? 'lab(100 0 0 / 0.7)' : 'lab(100 0 0)');
    assert.equal(declared.get('--color-accent'), 'lab(65.4459 53.8462 44.2739)');
    assert.equal(declared.get('--shadow-card'), '0 1px 2px lab(0 0 0 / 0.2)');
  }
});

test('tokens are grouped by the axes they actually depend on', () => {
  const { rules } = compileTokens({ axes: AXES, tokens: TOKENS });
  const rulesFor = (name) => rules.filter((r) => r.decls.some(([n]) => n === name));
  assert.equal(rulesFor('--color-accent').length, 1); // no axes: :root
  assert.equal(rulesFor('--color-line').length, 2); // mode only
  assert.equal(rulesFor('--color-text').length, 4); // mode x contrast
  assert.equal(rulesFor('--color-surface').length, 6); // mode x wallpaper
  assert.deepEqual(rulesFor('--color-accent')[0].selectors, [':root']);
  assert.deepEqual(rulesFor('--color-line').map((r) => r.selectors[0]), [':root:not(.dark)', ':root.dark']);
});

test('a key matching more axes wins; ties between different values are errors', () => {
  assert.throws(
    () => compileTokens({ axes: AXES, tokens: { color: { x: { default: '#000', 'mode=dark': '#111', 'contrast=high': '#222' } } } }),
    /ambiguous when mode=dark&contrast=high/,
  );
  // Same value on both keys is not a conflict.
  compileTokens({ axes: AXES, tokens: { color: { x: { default: '#000', 'mode=dark': '#111', 'contrast=high': '#111' } } } });
});

test('definition errors are reported clearly', () => {
  assert.throws(() => compileTokens({ axes: AXES, tokens: { color: { x: { 'mode=dark': '#111' } } } }), /no value when mode=light/);
  assert.throws(() => compileTokens({ axes: AXES, tokens: { color: { x: { default: '#000', 'theme=dark': '#111' } } } }), /unknown axis/);
  assert.throws(() => compileTokens({ axes: AXES, tokens: { color: { x: { default: '#000', 'mode=dim': '#111' } } } }), /unknown value "dim"/);
  assert.throws(() => compileTokens({ tokens: { color: { x: '#000 !important' } } }), /!important/);
  assert.throws(() => compileTokens({ tokens: { fontSize: { sm: '1px' }, font: { 'size-sm': '2px' } } }), /both map to --font-size-sm/);
  assert.throws(() => compileTokens({ tokens: { color: { x: 'var(--color-missing)' } } }), /unknown token --color-missing/);
});

test('media axes and non-exhaustive axes', () => {
  const { rules, warnings } = compileTokens({
    axes: { motion: { full: '@media (prefers-reduced-motion: no-preference)', reduced: '@media (prefers-reduced-motion: reduce)' } },
    tokens: { duration: { fast: { default: '120ms', 'motion=reduced': '0ms' } } },
  });
  assert.deepEqual(rules.map((r) => r.atRules[0]), ['@media (prefers-reduced-motion: no-preference) and (not (prefers-reduced-motion: reduce))', '@media (prefers-reduced-motion: reduce)']);
  assert.match(warnings[0].message, /not exhaustive/);
});

test('defineTokens maps every token to var(--group-name), nested groups included', () => {
  const t = defineTokens({ tokens: { color: { brand: { 500: '#f00' }, textMuted: '#777' }, space: { '0.5': '2px' } } });
  assert.equal(t.color.brand[500], 'var(--color-brand-500)');
  assert.equal(t.color.textMuted, 'var(--color-text-muted)');
  assert.equal(t.space['0.5'], 'var(--space-0_5)');
  assert.ok(Object.isFrozen(t) && Object.isFrozen(t.color));
});
