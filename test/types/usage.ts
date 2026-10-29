// Type-level tests: compiled with the host TypeScript by test/types.test.js.
// Every @ts-expect-error line must be an error; everything else must compile.
import { createCss, css, defineTokens } from '@avonao/purser';
import type { ColorToken, Token } from '@avonao/purser';

const t = defineTokens({
  axes: { mode: { light: ':not(.dark)', dark: '.dark' } },
  tokens: {
    color: { text: { default: '#111', 'mode=dark': '#eee' }, brand: { 500: 'oklch(60% 0.2 30)' } },
    space: { 4: '16px' },
    shadow: { card: '0 1px 2px rgb(0 0 0 / 0.1)' },
  },
});

const text: ColorToken = t.color.text;
const brand: ColorToken = t.color.brand[500];
const space: Token<'space'> = t.space[4];
// @ts-expect-error a space token is not a colour token
const wrong: ColorToken = t.space[4];
// @ts-expect-error unknown token
t.color.nope;

const s = css.create({
  card: {
    color: { default: t.color.text, ':hover': t.color.brand[500], '@media (width >= 768px)': { default: t.color.text, ':focus-visible': null } },
    paddingTop: t.space[4],
    padding: 4,
    boxShadow: t.shadow.card,
    display: { default: 'block', '@media (width >= 768px)': 'flex' },
    '::before': { content: '""', backgroundColor: t.color.text },
    '--card-gap': t.space[4],
    fill: 'none',
    stroke: 'currentColor',
  },
  plain: { lineHeight: 1.5, gap: `calc(${t.space[4]} * 2)` },
});

css.create({
  // @ts-expect-error raw colour where a colour is expected
  bad: { color: 'red' },
});
css.create({
  // @ts-expect-error raw hex colour
  bad: { backgroundColor: '#fff' },
});
css.create({
  // @ts-expect-error shorthand with longhands is rejected
  bad: { border: '1px solid' },
});
css.create({
  // @ts-expect-error unknown property
  bad: { colr: t.color.text },
});
css.create({
  // @ts-expect-error raw colour inside a condition
  bad: { color: { default: t.color.text, ':hover': 'blue' } },
});

const cls: string = css.props(s.card, false, null, undefined, [s.plain]);
// @ts-expect-error props only accepts compiled styles
css.props({ color: 'red' });

const fade: string = css.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
css.globals({
  ':root': { colorScheme: 'light dark' },
  body: { margin: 0, color: t.color.text },
  '@font-face': { fontFamily: 'Inter', src: 'url(/inter.woff2)' },
});
const custom = createCss({ prefix: 'p' });
custom.props(custom.create({ a: { opacity: 1 } }).a);

void [text, brand, space, wrong, cls, fade];
