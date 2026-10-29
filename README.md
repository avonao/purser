<!-- Logo placeholder: the Purser CSS logo goes here. -->

# Purser CSS

**Compile-time atomic CSS in which an overridden declaration cannot happen.**

Homepages: [pursercss.dev](https://pursercss.dev) · [purser.avonao.dev](https://purser.avonao.dev)

Purser CSS (Purser for short) lets you write styles next to your components in TypeScript or JavaScript. The build turns them into one deterministic, atomic stylesheet, and the runtime only joins class names. Unlike most CSS-in-JS tools, Purser starts from a set of rules about the output and makes them impossible to break.

> Status: 0.1.0, unreleased. The API may change before 1.0.

## What it guarantees

1. **No declaration is ever overridden on the element it applies to.** Nothing is struck through in DevTools, in any state (hover, focus, attributes) and at any viewport width. Every property's conditional branches compile into rules that are mutually exclusive by construction. Each build proves this by brute force, and a Chrome test checks it in a real browser.
2. **No `!important`**, anywhere.
3. **Every colour is a token.** A raw colour in a component style is a type error *and* a build error.
4. **Every colour in the output is `lab()`.** Hex, `rgb()`, `hsl()`, `hwb()`, `oklch()`, `oklab()`, `lch()`, `color()` and named colours are converted exactly (CSS Color 4 math, D50).
5. **Each declaration is written once.** Identical definitions share a class, output is deterministic, and class names are short stable hashes.
6. **One generated stylesheet**, in three cascade layers: `purser.tokens`, `purser.globals`, `purser.atoms`.

See [docs/how-it-works.md](docs/how-it-works.md) for how each rule is enforced.

## Quick start

Requirements: Node.js 22 or later (22.18 or later for a TypeScript tokens file), and `typescript` installed in your project (the build uses your copy to parse your source). `postcss` is optional; when it is installed, the build re-parses its own output as a self-check.

```sh
npm install @avonao/purser
```

**1. Declare tokens** (`lib/tokens.ts`):

```ts
import { defineTokens } from '@avonao/purser';

export const bp = { md: '@media (width >= 768px)' } as const;

export const t = defineTokens({
  axes: {
    mode: { light: ':not(.dark)', dark: '.dark' },
    contrast: { normal: ':not(.hc)', high: '.hc' },
  },
  tokens: {
    color: {
      text: { default: '#1a1a1a', 'mode=dark': '#ededed', 'contrast=high': '#000', 'mode=dark&contrast=high': '#fff' },
      accent: 'oklch(71.57% 0.1797 33.51)',
      line: { default: 'rgb(0 0 0 / 0.1)', 'mode=dark': 'rgb(255 255 255 / 0.12)' },
    },
    space: { 2: '8px', 4: '16px' },
  },
});
```

**2. Style components:**

```tsx
import { css } from '@avonao/purser';
import { bp, t } from '@/lib/tokens';

const s = css.create({
  card: {
    padding: t.space[4],
    color: { default: t.color.text, ':hover': t.color.accent },
    display: { default: 'block', [bp.md]: 'flex' },
    '::before': { content: '""', backgroundColor: t.color.line },
  },
  active: { color: t.color.accent },
});

export function Card({ active }: { active?: boolean }) {
  return <div className={css.props(s.card, active && s.active)} />;
}
```

**3. Build the stylesheet** and import it once (for example in your root layout):

```sh
npx purser build --project . --src app,components,lib --tokens lib/tokens.ts --out app/purser.css
```

Part of the output:

```css
@layer purser.tokens, purser.globals, purser.atoms;

@layer purser.tokens {
  :root {
    --color-accent: lab(65.4459 53.8462 44.2739);
    --space-2: 8px;
  }
  :root:not(.dark) { --color-line: lab(0 0 0 / 0.1); }
  :root.dark { --color-line: lab(100 0 0 / 0.12); }
  :root:not(.dark):not(.hc) { --color-text: lab(9.2632 0 0); }
  /* … one rule per combination of the axes a token depends on */
}

@layer purser.atoms {
  .xce3dr7w:not(:hover) { color: var(--color-text); }
  .xce3dr7w:hover { color: var(--color-accent); }
  @media (width >= 768px) {
    .x38pu9ei { display: flex; }
  }
  @media not (width >= 768px) {
    .x38pu9ei { display: block; }
  }
}
```

**4. In CI**, `purser check` validates without writing and exits 1 on any violation:

```sh
npx purser check --project . --src app,components,lib --tokens lib/tokens.ts
```

## API in brief

| Call | What it does |
| --- | --- |
| `defineTokens({ axes, tokens })` | Declares tokens; returns `t` with `t.color.text === 'var(--color-text)'`, typed so only colour tokens fit colour properties. |
| `css.create({ name: style })` | Declares named styles; returns opaque class maps. Values must be static. |
| `css.props(...styles)` | Merges styles left to right (later wins per property; falsy values ignored) and returns the class string. |
| `css.keyframes(frames)` | Declares keyframes; returns the generated animation name. |
| `css.globals(rules)` | Rules that cannot be classes: `:root`, `html`, `body`, a minimal reset, `::selection`, `@font-face`. |
| `createCss({ prefix, salt })` | A `css` with custom naming (pass the same `--prefix` / `--salt` to the build). |

Conditions on a value: pseudo-classes and attribute selectors (`:hover`, `:focus-visible`, `[aria-expanded="true"]`, `:is(.dark *)`), plus `@media`, `@supports` and `@container`. They can nest. `default` is the fallback, and a later key wins when several are true. `null` leaves the property unset.

Shorthands: box shorthands (`padding`, `margin`, `inset`, `borderRadius`, `gap`, `overflow`, `borderWidth`/`Style`/`Color`, the logical `…Inline`/`…Block` forms, `place*`, `gridRow`/`gridColumn`/`gridArea`) expand to longhands. Shorthands that cannot expand safely (`border`, `background`, `font`, `flex`, `transition`, `animation`, `outline`, …) are rejected with the longhands to use instead, because a shorthand and its longhand on one element is an override.

**Runtime values.** Values in `css.create` are static. For a value known only at runtime, set a custom property and read it:

```tsx
const s = css.create({ bar: { width: 'var(--progress)' } });
<div className={css.props(s.bar)} style={{ '--progress': `${pct}%` } as React.CSSProperties} />
```

The full reference is in [docs/api.md](docs/api.md).

## Next.js

Run the watcher next to the dev server (Turbopack, the default in Next.js 16, picks up the regenerated file like any other CSS change). Generate the stylesheet before every production build, whether it uses Turbopack or `next build --webpack`:

```json
{
  "scripts": {
    "css": "purser build --project . --src app,components,lib --tokens lib/tokens.ts --out app/purser.css",
    "dev": "npm run css -- --watch & next dev",
    "prebuild": "npm run css",
    "build": "next build --webpack"
  }
}
```

Then add `import './purser.css'` to `app/layout.tsx`. Details, server components and CI setup: [docs/nextjs.md](docs/nextjs.md).

## Limitations (0.1)

- **Static styles only.** A style value can use literals, the tokens module's exports, `const` bindings in the same file, and `css.keyframes()` names. Use custom properties for runtime values.
- **One `css.props` call per element.** Adding Purser classes to an element by hand, or setting a property that an atom also sets through the `style` prop, bypasses the merge and can override.
- **`@container` conditions need a container.** With no query container ancestor, a container query is unknown, so neither the branch nor its `default` applies.
- **Logical and physical properties** (`marginTop` and `marginBlockStart`) are treated as conflicting. The block axis assumes horizontal writing modes. `inlineStart`/`inlineEnd` are direction-agnostic, so they replace both `left` and `right`.
- **Only Purser's stylesheet is covered.** Third-party CSS on the same elements can still override, and so can the browser's own (user-agent) styles; DevTools does not strike those.
- **The tokens module** must be JavaScript or TypeScript with erasable syntax only (Node strips the types). It is loaded with `import()` at build time.
- No bundler plugin yet: integrate with the CLI (or the `@avonao/purser/build` API).

## Verifying a page

[`scripts/strike-count.js`](scripts/strike-count.js) counts struck-through declarations on any page. Paste it into the DevTools console, or evaluate it over the DevTools protocol; it returns `{ count, struck, … }`. The test suite runs it in headless Chrome (when Chrome is installed) at three widths, nine root themes, hover and keyboard focus.

## Contributing and licence

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). MIT licensed; see [LICENSE](LICENSE).
