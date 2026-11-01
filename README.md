<p align="center">
  <img src="docs/assets/purser-banner.png" alt="Purser CSS" width="100%">
</p>

<p align="center">
  <strong>Compile-time atomic CSS in which an overridden declaration, an <code>!important</code> and a raw colour cannot happen.</strong>
</p>

<p align="center">
  <a href="https://github.com/avonao/purser/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/avonao/purser/ci.yml?branch=main&label=ci"></a>
  <img alt="Status: Preview" src="https://img.shields.io/badge/status-preview-f59e0b">
  <img alt="Version 0.1.0" src="https://img.shields.io/badge/version-0.1.0-0f766e">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0f766e"></a>
  <img alt="TypeScript 5+" src="https://img.shields.io/badge/TypeScript-5%2B-3178c6">
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000">
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933">
  <img alt="Zero runtime dependencies" src="https://img.shields.io/badge/runtime%20dependencies-0-0f766e">
</p>

Purser CSS (Purser for short) is a **compiler**. You write styles next to your components in TypeScript or JavaScript. The build reads them statically and writes one deterministic, atomic stylesheet; the runtime only joins class names. Unlike most CSS-in-JS tools, Purser starts from a set of rules about the *output* and makes them impossible to break: a declaration is never struck through in DevTools, `!important` never appears, and every colour is a token written as `lab()`.

It needs **no bundler plugin and no runtime stylesheet work**. The only inputs are your source files and a tokens module, and the only output is a CSS file that any framework can import.

Purser is a sister product of [Hypdriv](https://github.com/avonao/hypdriv), Avonao's sidecar for performance, security and observability on Cloudflare Workers, Vercel and Node. On Next.js, Hypdriv runs the Purser build and watch inside `withHypDriv`. On every supported host, including the Vite frameworks, it guards against a stale stylesheet, reports atom usage per route and audits a deployment for zero overrides.

Homepages: [pursercss.dev](https://pursercss.dev) · [purser.avonao.dev](https://purser.avonao.dev)

> **Preview.** Purser 0.1.0 is a Preview release. Preview releases are available to build with and evaluate ahead of general availability. The API and the generated class names can change between Preview versions, and Preview builds are not covered by a service-level agreement. The [Preview status](#preview-status) section lists what is included, what has been verified and the constraints that apply.

## Contents

- [Highlights](#highlights)
- [Supported frameworks and browsers](#supported-frameworks-and-browsers)
- [Requirements](#requirements)
- [Install a Preview build](#install-a-preview-build)
- [Quickstart](#quickstart)
- [How it works](#how-it-works)
- [The guarantees](#the-guarantees)
- [API](#api)
- [Command line](#command-line)
- [Configuration](#configuration)
- [Adopting Purser next to existing CSS](#adopting-purser-next-to-existing-css)
- [Packages](#packages)
- [Works with Hypdriv](#works-with-hypdriv)
- [Preview status](#preview-status)
- [Documentation](#documentation)
- [Develop from source](#develop-from-source)
- [Feedback, security and contributing](#feedback-security-and-contributing)
- [License](#license)

## Highlights

| Area | Purser adds |
| --- | --- |
| **No overrides** | Every property's conditional branches (pseudo-classes, attributes, `@media`, `@supports`, `@container`) compile into rules that are mutually exclusive by construction · a brute-force proof on every build · a headless-Chrome test and an in-page counter that look for struck-through declarations in a real browser |
| **No `!important`** | Not written by the compiler, not accepted from a style value, not present in the output |
| **Colour tokens** | A raw colour in a component style is a type error and a build error · tokens with one value per combination of theme axes (mode, contrast, wallpaper, motion or any axes you define) · each custom property written exactly once for any root state |
| **`lab()` everywhere** | Hex, `rgb()`, `hsl()`, `hwb()`, `oklch()`, `oklab()`, `lch()`, `color()` and named colours converted exactly with CSS Color 4 math (D50) |
| **Atoms** | One class per declaration, shared by every identical definition · short stable hashes · deterministic output · box shorthands expanded to longhands, unsafe shorthands rejected with the longhands to use |
| **Globals** | `css.globals` for `:root`, `html`, `body`, a minimal reset, `::selection` and `@font-face`, made exclusive with each other and with atom classes · an optional overrides layer for a project that is still moving from existing CSS |
| **Cascade layers** | Three named layers (tokens, globals, atoms) plus overrides, renamable with `--layers` so Purser can sit among an existing project's layers |
| **Type safety** | Hand-written TypeScript declarations · colour properties accept only colour tokens · rejected shorthands show their advice in the type error |
| **Tooling** | The `purser` CLI (`build`, `check`, `--watch`) · a JS build API · `scripts/strike-count.js` for any page · zero runtime dependencies |

The behaviour of every rule is described in [`docs/how-it-works.md`](docs/how-it-works.md).

## Supported frameworks and browsers

Purser has no framework dependency: it reads your source with TypeScript, and writes a CSS file and class name strings.

| Framework | Integration | Status |
| --- | --- | --- |
| Next.js 16 (Turbopack and `--webpack`) | CLI watcher beside `next dev`, a build step before `next build`, [guide](docs/nextjs.md) | Verified |
| Any framework that imports a CSS file and takes a `className` string | The CLI, or the `@avonao/purser/build` API | Same mechanism, no framework-specific guide yet |
| Next.js 16 on Cloudflare Workers and Vercel | [Hypdriv](https://github.com/avonao/hypdriv) runs the Purser build and watch in-process through `withHypDriv` | See the Hypdriv repository |
| Vite, React Router, TanStack Start, Astro, SvelteKit, Nuxt, vinext | You generate the stylesheet with `purser build` (or `hypdriv css build`) as a build step; Hypdriv then checks the built pages for atoms missing from it | See the Hypdriv repository |

The generated stylesheet uses `lab()` and cascade layers, so it targets Chrome and Edge 111, Firefox 113 and Safari 15.4 or later. Older browsers receive no colour; if you must support them, show them a fallback notice instead of lowering the target (a lower target makes a CSS minifier write a struck fallback copy before every `lab()` value).

## Requirements

| Component | Requirement |
| --- | --- |
| Node.js | 22 or later. A TypeScript tokens module needs 22.18 or later (Node strips the types); on older versions write `tokens.js`. |
| TypeScript in your project | 5.0 or later. The build uses your copy to parse your source and to resolve `tsconfig.json` paths. |
| PostCSS | 8.4 or later, optional. When installed, the build re-parses its own output as a self-check. |
| Google Chrome | Optional, for the browser integration test (`PURSER_CHROME` names the binary). |
| Next.js | 16, for the guide. Any framework that imports a CSS file works. |
| Package manager | npm, pnpm, yarn or bun. |

## Install a Preview build

Preview builds are not published to a package registry. Install from the source repository.

### From source

```sh
git clone https://github.com/avonao/purser.git
cd purser
npm install          # installs the development tools (typescript, postcss) only
npm test
```

Purser has no build step and no runtime dependencies: the source in `src/` is the package.

### Into an application

```sh
npm pack                                   # writes avonao-purser-0.1.0.tgz
cd path/to/your-app
npm install --save-dev ../purser/avonao-purser-0.1.0.tgz
```

Commit the tarball (for example in `vendor/purser/`) so CI installs the same bytes. A registry release follows the Preview.

## Quickstart

Four steps: declare tokens, style components, build the stylesheet, check it in CI.

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

### Next.js

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

Then add `import './purser.css'` to `app/layout.tsx`. Details, server and client components, theme switching and troubleshooting: [`docs/nextjs.md`](docs/nextjs.md).

## How it works

Purser has two halves that share code.

- **Runtime** (`@avonao/purser`): `css.create` normalises each style and hashes it into class names, and `css.props` merges them left to right. It never emits CSS and imports no build-only module.
- **Build** (`@avonao/purser/build` and the `purser` command): reads your source statically with the host's TypeScript, evaluates every `css.create`, `css.keyframes`, `css.globals` and the tokens module, and compiles the result.

The build runs the same ordered stages on every project:

`extract → load tokens → normalise (shorthands expanded) → compile conditions → prove exclusivity → render tokens, globals and atoms → write → self-check`

A stage that finds a violation reports it as `file:line:column: error: message` and the build writes nothing. The sequence, and the rules each stage enforces, are in [`docs/how-it-works.md`](docs/how-it-works.md).

## The guarantees

1. **No declaration is ever overridden on the element it applies to.** Nothing is struck through in DevTools, in any state (hover, focus, attributes) and at any viewport width. Each build proves this by brute force, and a Chrome test checks it in a real browser.
2. **No `!important`**, anywhere.
3. **Every colour is a token.** A raw colour in a component style is a type error *and* a build error.
4. **Every colour in the output is `lab()`.** Conversion is exact (CSS Color 4 math, D50).
5. **Each declaration is written once.** Identical definitions share a class, output is deterministic, and class names are short stable hashes.
6. **One generated stylesheet**, in three cascade layers: `purser.tokens`, `purser.globals`, `purser.atoms`, plus `purser.overrides` for a project still moving from existing CSS.

## API

| Call | What it does |
| --- | --- |
| `defineTokens({ axes, tokens })` | Declares tokens; returns `t` with `t.color.text === 'var(--color-text)'`, typed so only colour tokens fit colour properties. |
| `css.create({ name: style })` | Declares named styles; returns opaque class maps. Values must be static. |
| `css.props(...styles)` | Merges styles left to right (later wins per property; falsy values ignored) and returns the class string. |
| `css.keyframes(frames)` | Declares keyframes; returns the generated animation name. |
| `css.globals(rules, options?)` | Rules that cannot be classes: `:root`, `html`, `body`, a minimal reset, `::selection`, `@font-face`. |
| `createCss({ prefix, salt })` | A `css` with custom naming (pass the same `--prefix` and `--salt` to the build). |

Conditions on a value: pseudo-classes and attribute selectors (`:hover`, `:focus-visible`, `[aria-expanded="true"]`, `:is(.dark *)`), plus `@media`, `@supports` and `@container`. They can nest. `default` is the fallback, and a later key wins when several are true. `null` leaves the property unset.

Shorthands: box shorthands (`padding`, `margin`, `inset`, `borderRadius`, `gap`, `overflow`, `borderWidth`/`Style`/`Color`, the logical `…Inline`/`…Block` forms, `place*`, `gridRow`/`gridColumn`/`gridArea`) expand to longhands. Shorthands that cannot expand safely (`border`, `background`, `font`, `flex`, `transition`, `animation`, `outline`, …) are rejected with the longhands to use instead, because a shorthand and its longhand on one element is an override.

**Runtime values.** Values in `css.create` are static. For a value known only at runtime, set a custom property and read it:

```tsx
const s = css.create({ bar: { width: 'var(--progress)' } });
<div className={css.props(s.bar)} style={{ '--progress': `${pct}%` } as React.CSSProperties} />
```

Reference: [`docs/api.md`](docs/api.md).

## Command line

The `purser` command ships in `@avonao/purser`.

| Command | Purpose |
| --- | --- |
| `purser build` | Compile the stylesheet and write it only when its content changes; `--watch` rebuilds on change |
| `purser check` | The same build without writing: validate, exit `1` on any violation (for CI) |

| Option | Purpose |
| --- | --- |
| `--project <dir>` | Project root; `typescript` and `postcss` resolve from here (default `.`) |
| `--src <list>` | Comma-separated source directories or files (required) |
| `--tokens <file>` | Module exporting the `defineTokens()` result |
| `--out <file>` | Generated stylesheet (`build` only) |
| `--watch` | Rebuild on change (`build` only) |
| `--prefix <name>` | Class name prefix (default `x`); must match `createCss({ prefix })` |
| `--salt <text>` | Hash salt (default empty); must match `createCss({ salt })` |
| `--package <name>` | Runtime import specifier (default `@avonao/purser`) |
| `--css-module <file>` | Module exporting a custom `css = createCss({ prefix, salt })` |
| `--layers <t,g,a>` | Names of the tokens, globals and atoms cascade layers (a fourth name adds the overrides layer) |

Exit codes: `0` success, `1` rule violations or errors, `2` usage errors. Reference: [`docs/api.md`](docs/api.md#cli).

## Configuration

Purser has no configuration file. Everything is a CLI flag or a build option, so the call you commit to `package.json` is the whole configuration:

```json
{
  "scripts": {
    "css": "purser build --project . --src app,components,lib --tokens lib/tokens.ts --out app/purser.css",
    "css:check": "purser check --project . --src app,components,lib --tokens lib/tokens.ts"
  }
}
```

The same options are available from code, for a build tool or a script:

```ts
import { build, check, watch } from '@avonao/purser/build';

const result = await build({
  projectDir: process.cwd(),
  src: ['app', 'components', 'lib'],
  tokens: 'lib/tokens.ts',
  out: 'app/purser.css',
  layers: { tokens: 'purser-tokens', globals: 'purser-globals', atoms: 'purser-atoms' },
});
if (result.diagnostics.some((d) => d.severity === 'error')) process.exit(1);
```

The build scans `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.mts`, `.cts` and `.cjs` files, skipping `node_modules`, dot-directories and build output folders. It parses only files that mention the package name. Imports resolve with the project's `tsconfig.json`, so `paths` aliases work. Full option and result types: [`docs/api.md`](docs/api.md#build-api-avonaopurserbuild).

## Adopting Purser next to existing CSS

A project that already has stylesheets can move to Purser one component at a time. Give Purser's layers top-level names, put the old rules in a `legacy` layer between Purser's globals and atoms, and the moved components cannot be overridden while the old ones keep working:

```css
/* app/globals.css */
@layer purser-tokens, purser-globals;
@import "tailwindcss";
@layer legacy, purser-atoms;

@layer legacy {
  /* every rule that has not moved yet */
}
```

```json
"css": "purser build --project . --src app,components,lib --tokens lib/tokens.ts --out app/purser.css --layers purser-tokens,purser-globals,purser-atoms"
```

Page-wide rules that must keep winning over old CSS (a high-contrast or reduced-motion mode the old code forced with `!important`) are written with `css.globals(rules, { layer: 'overrides' })`. After each component moves, `scripts/strike-count.js` lists every declaration that is still overridden on the page. The full method is in [`docs/nextjs.md`](docs/nextjs.md#adopting-purser-next-to-existing-css).

## Packages

One package, three entry points and one script.

| Entry point | Purpose | Node |
| --- | --- | --- |
| [`@avonao/purser`](src/index.js) | Runtime and TypeScript declarations: `defineTokens`, `css.create`, `css.props`, `css.keyframes`, `css.globals`, `createCss` | ≥ 22 |
| [`@avonao/purser/build`](src/build/index.js) | Build API: `build`, `check`, `watch`, `createBuilder` | ≥ 22 |
| [`purser`](bin/purser.js) | The command line (`build`, `check`) | ≥ 22 |
| [`scripts/strike-count.js`](scripts/strike-count.js) | An in-page counter of overridden declarations, for any page | a browser |

Peer dependencies: `typescript` ≥ 5.0 (the build parses your source with it) and `postcss` ≥ 8.4 (optional; the output self-check).

### Verifying a page

[`scripts/strike-count.js`](scripts/strike-count.js) counts struck-through declarations on any page. Paste it into the DevTools console, or evaluate it over the DevTools protocol: it returns `{ count, struck, rules, skipped }` for the page's current state, and defines `globalThis.purserStrikeCount()` so you can call it again after changing hover, focus or width. The test suite runs it in headless Chrome at three widths, nine root themes, hover and keyboard focus.

## Works with Hypdriv

[Hypdriv](https://github.com/avonao/hypdriv) is Avonao's sidecar for Next.js and Vite hosts on Cloudflare Workers, Vercel and Node. Its Purser bridge (`@hypdriv/purser`, `hypdriv css`) adds, on top of the build described here:

- on Next.js, the Purser build and watch in-process inside `withHypDriv`;
- on every host, an unstyled-atom guard that flags a stale stylesheet at build time (`purser.verify`: `error`, `warn` or `off`);
- on every host, atom usage per route in the route manifest;
- on every host, flashless themes pinned at the edge;
- on every host, zero-override audits of a running deployment with headless Chrome (`hypdriv audit css`).

On the Vite hosts (Vite, React Router, TanStack Start, Astro, SvelteKit, Nuxt, vinext) Hypdriv does not run the Purser build. You generate the stylesheet with `purser build` or `hypdriv css build` as a step before the framework build, and Hypdriv's build guard confirms that every atom the built pages use is in it. `hypdriv css check` validates the Purser build in CI without writing the file.

Hypdriv needs `@avonao/purser` 0.1 or later, installed separately. Purser works on its own, without Hypdriv. See Hypdriv's [Purser CSS guide](https://github.com/avonao/hypdriv/blob/main/docs/guides/purser.md).

## Preview status

| | Status |
| --- | --- |
| Release | 0.1.0 Preview |
| Implemented | Everything in this README |
| Tests | 88 tests in 14 files on Node 22 and 24, including a headless-Chrome integration test |
| In use | The Entpoind Tools site (moving onto it component by component) and Hypdriv's `with-purser` examples |
| API stability | Not yet guaranteed. 1.0 will commit to the style and token APIs and to class names, under semver |
| Distribution | Source and a packed tarball |

### Constraints in this Preview

- **Registry.** Distributed as source and a tarball; an npm release follows the Preview.
- **Static styles only.** A style value can use literals, the tokens module's exports, `const` bindings in the same file and `css.keyframes()` names. Use custom properties for runtime values.
- **One `css.props` call per element.** Adding Purser classes to an element by hand, or setting a property that an atom also sets through the `style` prop, bypasses the merge and can override.
- **`@container` conditions need a container.** With no query container ancestor a container query is unknown, so neither the branch nor its `default` applies; the strike counter reports these rules as skipped.
- **Logical and physical properties** (`marginTop` and `marginBlockStart`) are treated as conflicting. The block axis assumes horizontal writing modes. `inlineStart` and `inlineEnd` are direction-agnostic, so they replace both `left` and `right`.
- **Only Purser's stylesheet is covered.** Third-party CSS on the same elements can still override, and so can the browser's own user-agent styles; DevTools does not strike those.
- **The tokens module** must be JavaScript or TypeScript with erasable syntax only (Node strips the types). It is loaded with `import()` at build time.
- **No bundler plugin yet.** Integrate with the CLI or the `@avonao/purser/build` API.
- **Class names are public.** A change to the hash or to normalisation that renames classes is a breaking change and is recorded in the [changelog](CHANGELOG.md).

## Documentation

- **Concepts:** [How Purser works](docs/how-it-works.md) · [Changelog](CHANGELOG.md)
- **Reference:** [API](docs/api.md) (`defineTokens`, `css.*`, `createCss`, the build API, the CLI, `strike-count.js`)
- **Frameworks:** [Next.js](docs/nextjs.md)
- **Sister products:** [Hypdriv](https://github.com/avonao/hypdriv) · [SquawkCode](https://github.com/avonao/squawkcode)

## Develop from source

```sh
npm install                 # typescript and postcss, for the build and the tests
npm test                    # node --test (the Chrome test runs when Chrome is installed)
npm run test:update         # regenerate the golden files; review the diff
```

Continuous integration runs the suite on Node 22 and 24. The ground rules (keep the guarantees, keep the runtime small, treat class names as public) are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Feedback, security and contributing

- **Bugs and feature requests:** open an issue with the templates in this repository, with a minimal reproduction.
- **Security:** report vulnerabilities privately through GitHub's *Report a vulnerability* on the Security tab. See [`SECURITY.md`](SECURITY.md).
- **Contributing:** see [`CONTRIBUTING.md`](CONTRIBUTING.md). Any change to condition compilation, globals or tokens needs a test case and must keep the exclusivity self-checks passing.
- **Conduct:** [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 Avonao, Inc. and Purser contributors.
