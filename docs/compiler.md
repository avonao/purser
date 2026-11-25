# The compiler

Without the compiler, `css.create` runs in the browser: every module that defines styles ships its style objects and the code that turns them into class names, and pays for that work when it loads. The compiler does the same work at build time and writes the result into the module. What the browser receives is a string.

```tsx
// source
import { css } from '@avonao/purser';
import { t } from '@/lib/tokens';

const s = css.create({
  card: { padding: t.space[4], color: { default: t.color.text, ':hover': t.color.accent } },
  active: { color: t.color.accent },
});

export function Card({ active }: { active?: boolean }) {
  return <div className={css.props(s.card, active && s.active)} />;
}
```

```tsx
// compiled (names: 'min', granularity: 'rule')
export function Card({ active }: { active?: boolean }) {
  return <div className={("_a _c _e _g"+((active)?" _f":" _b _d"))} />;
}
```

No import from Purser is left, the tokens module is no longer imported, and `s` is gone. The compiled expression is computed with the runtime itself, for every combination of the guards, so a compiled module and an uncompiled one always give the same classes.

The compiler is optional. A project that does not use it works exactly as before.

## What it rewrites

| Source | Compiled |
| --- | --- |
| `css.create({ … })` | Removed when every use of its styles was compiled away; otherwise the class names it would compute, wrapped in `styles()` from `@avonao/purser/compiled` |
| `css.props(s.a, on && s.b, x ? s.c : s.d, [s.e])` | One string expression. Arguments can be styles of a `css.create` in the same file, `&&` and `?:` with any guard, arrays, and `false`, `null` or `undefined` |
| `css.props(s.a, props.style)` | `props(s.a, props.style)` from `@avonao/purser/compiled`: the merge alone (about 0.7 kB compressed), with compiled class maps |
| `css.keyframes({ … })` | The animation name, as a string |
| `css.globals({ … })` | Removed: the rules are in the stylesheet |
| `defineTokens({ … })` | The object it returns (`{ color: { text: "var(--color-text)" } }`), so a tokens module that is still imported is plain data |

Imports of `css`, of the tokens module and of a custom `css` module are removed when nothing refers to them any more. Every other import is left alone.

A `css.props` call stays a merge at run time when an argument is not known in the file: a style passed in as a prop, a style picked with a computed key (`s[variant]`), a spread, or a style imported from another module. Its styles are still compiled, so only the merge is left.

### Guards

A guard is the condition of `&&` or `?:`. A guard that only reads (`active`, `props.size === 'lg'`, `!user?.premium`) is written into the expression wherever it is needed. A guard that runs code (`isActive(path)`) is evaluated once, where the call was, in the original order, and passed in. A guard that runs code and sits inside another guard is only evaluated on some paths, so that call is left to the runtime merge.

Up to six guards per call are folded (64 class lists are computed at build time). More than that leaves the call to the runtime merge.

### Errors

A module with a style the build rejects (a raw colour, a value that is not static, a shorthand) is not compiled. The stylesheet build reports the error with its file, line and column, and fails. The compiler never reports the same error a second time.

### Line numbers and source maps

A replacement is padded with the line breaks it removed, so every statement stays on its line. The source map has one segment per line and carries the original source.

## Setup

Every plugin takes the same options. With `src` and `out` a plugin also writes the stylesheet, so it replaces the `purser build` step; a stylesheet that would break a rule fails the build.

| Option | Purpose |
| --- | --- |
| `tokens` | The tokens module, relative to the project root |
| `src`, `out` | Source directories and the stylesheet to write. Omit both when another step writes the stylesheet |
| `minify` | Minify the stylesheet. Default: in a production build |
| `granularity` | `'property'` (default) or `'rule'`. See [Smaller output](#smaller-output) |
| `names` | `'legacy'` (default), `'short'` or `'min'` |
| `fuse` | With `names: 'min'`: `'exact'`, `'balanced'` or `'max'`. See [Fused classes](#fused-classes) |
| `namesFile` | With `names: 'min'`: a JSON file that keeps the names between builds |
| `prefix`, `salt`, `packageName`, `cssModule`, `layers` | As for [`purser build`](api.md#cli) |
| `projectDir` | The project root. Default: the bundler's root |
| `compile` | `false` writes the stylesheet and leaves the modules as they are |

The naming options (`prefix`, `salt`, `names`, `granularity`) must be the same wherever class names are computed: in the plugin, in a separate `purser build`, and in `createCss` for any module that is not compiled.

A plugin that writes the stylesheet works out what every module compiles to while it builds, so a module is parsed once for both. The result is kept in the build cache (`node_modules/.cache/purser`) by the module's content.

### Vite

Also React Router, TanStack Start, Astro, SvelteKit, Nuxt, SolidStart, Qwik and every other framework that builds with Vite, and Vitest.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { purser } from '@avonao/purser/vite';

export default defineConfig({
  plugins: [purser({ tokens: 'src/lib/tokens.ts', src: ['src'], out: 'src/purser.css', granularity: 'rule', names: 'min' })],
});
```

Import `src/purser.css` once, in the root layout or entry. In development the plugin rewrites the stylesheet when a source file changes; an error is printed and the last good stylesheet stays. A production build stops on an error.

### Rollup

`@avonao/purser/rollup` is the same plugin.

### Next.js

With webpack (`next build --webpack`), the plugin writes the stylesheet and adds the loader:

```ts
// next.config.ts
import { PurserWebpackPlugin } from '@avonao/purser/webpack';

export default {
  webpack(config) {
    config.plugins.push(new PurserWebpackPlugin({ tokens: 'lib/tokens.ts', src: ['app', 'components', 'lib'], out: 'app/purser.css' }));
    return config;
  },
};
```

With Turbopack, which has loaders but no plugins, add the loader and keep writing the stylesheet with `purser build` (in `prebuild`, and with `--watch` beside `next dev`):

```ts
// next.config.ts
export default {
  turbopack: {
    rules: {
      '*.{ts,tsx,js,jsx}': {
        condition: { not: 'foreign' },
        loaders: [{ loader: '@avonao/purser/webpack-loader', options: { tokens: 'lib/tokens.ts' } }],
      },
    },
  },
};
```

With `names: 'min'` under Turbopack, give the same `namesFile` to `purser build --names min --names-file …` and to the loader: the build writes the names, the loader reads them. Names are append-only, so a module that was compiled stays right when a class is added; the loader tells the bundler that a compiled module depends on the *generation* of the names (a small file in the cache directory that changes when the names file is started again) and on the plan, so a bundler that keeps compiled modules between builds compiles them again exactly when a class can have another name. Beside `purser build --watch`, a module with a new style can reach the loader before the build has named its classes: the loader waits for the name (`waitForNames`, 5 seconds under `NODE_ENV=development`) instead of failing.

[Hypdriv](https://github.com/avonao/hypdriv) sets all of this up from `purser.compile` in `hypdriv.config.ts`.

### webpack and Rspack

```js
import { PurserWebpackPlugin } from '@avonao/purser/webpack';

export default {
  plugins: [new PurserWebpackPlugin({ tokens: 'src/tokens.ts', src: ['src'], out: 'src/purser.css' })],
};
```

Or the loader alone, when another step writes the stylesheet:

```js
module: {
  rules: [{ test: /\.[cm]?[jt]sx?$/, exclude: /node_modules/, enforce: 'pre', use: [{ loader: '@avonao/purser/webpack-loader', options: { tokens: 'src/tokens.ts' } }] }],
}
```

### esbuild

```js
import { purserEsbuild } from '@avonao/purser/esbuild';

await esbuild.build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  plugins: [purserEsbuild({ tokens: 'src/tokens.ts', src: ['src'], out: 'src/purser.css' })],
});
```

### Any other tool

```ts
import { createCompiler } from '@avonao/purser/compiler';

const compiler = createCompiler({ projectDir: '.', tokens: 'lib/tokens.ts' });
const result = await compiler.transform(code, '/abs/path/button.tsx'); // { code, map, stats } or null
```

`null` means there is nothing to compile: keep the module as it is.

## Smaller output

Four options shrink what is sent. Each is separate; the benchmark's "compiled, fuse: exact" row uses all four.

**`minify`** writes the stylesheet without whitespace and merges rules that write the same declaration in the same context into one rule with a selector list. Only selectors that every target browser parses are merged, because a browser drops a whole list when it does not know one selector in it: a rule with `:has()` or a vendor pseudo-element always stays on its own.

**`granularity: 'rule'`** gives every generated rule its own class instead of every property of a style. With the default, `color: { default: A, ':hover': B }` in one style and `color: { default: A, ':hover': C }` in another are two classes, and `color: A` outside hover is written twice. With rule granularity both styles carry the same class for it and the stylesheet has that rule once. Elements carry more classes (one per rule of a conditional property) and the stylesheet has far fewer rules. The rules for one property are the same rules as before, under more names, so they stay mutually exclusive. The runtime supports it too (`import { css } from '@avonao/purser/rule'`, and `--granularity rule --package @avonao/purser/rule` for the build), at the price of the condition compiler in the bundle; compiled modules pay nothing.

**`names: 'min'`** replaces hashed names with the shortest names there are. A hashed name needs no shared state, but it is random text, and random text does not compress: four characters cost about three bytes wherever they appear. The build sees every class and how often it is used, and hands out `_a`, `_b`, … to the most used first. The names exist only in the build, so every module must be compiled; an uncompiled `css.create` throws with a message that says so.

The underscore keeps a minimal name from ever being a word that someone else's stylesheet uses (`btn`, `row`, `h1`). `prefix: ''` removes it for a project whose page has no other CSS.

Names are append-only: within one build process, and across builds when `namesFile` is set, a class keeps its name, so adding a style renames nothing. Without a names file the names are computed from scratch, and the same source always gives the same names. Commit the names file, or cache it in CI, to keep JavaScript chunks byte-identical between deploys when only some styles change. Delete it to start over with the shortest names.

**`fuse`** gives classes that are applied together one class. It is described next.

## Fused classes

An atomic stylesheet writes every declaration once and pays for it on the elements: a card with twelve declarations carries twelve classes, in the JavaScript that renders it and in every page it is rendered into. But most of those twelve never appear without each other.

A compiled `css.props` call is, under every assignment of its guards, a fixed set of classes, and the classes that appear under the same assignments form a group that is always applied whole: the ones every outcome has, the ones only `active` adds, the ones `active` takes away. The build sees every group of the project. That lets it ask which classes are always seen together, and give them one class.

```tsx
// card.tsx
const s = css.create({
  card: { display: 'flex', gap: t.space[4], width: '312px', height: '88px', color: { default: t.color.text, ':hover': t.color.accent } },
  active: { color: t.color.accent },
});
export function Card({ active }: { active?: boolean }) {
  return <div className={css.props(s.card, active && s.active)} />;
}

// row.tsx
const s = css.create({ row: { display: 'flex', gap: t.space[4] } });
export const Row = () => <div className={css.props(s.row)} />;
```

Not fused, the two modules compile to eight classes, and the card carries six or seven of them:

```css
._d:hover,._f{color:var(--color-accent)}._e:not(:hover){color:var(--color-text)}._c{column-gap:var(--space-4)}._b{display:flex}._h{height:88px}._a{row-gap:var(--space-4)}._g{width:312px}
```

```tsx
<div className={("_a _b _c _g _h"+((active)?" _f":" _d _e"))} />   // Card
<div className={"_a _b _c"} />                                     // Row
```

With `fuse: 'exact'` there are four. `display` and the two gaps are never seen without each other, in the card or in the row, so they are one class; so are the card's width and height, and its two colour rules:

```css
._c:hover,._d{color:var(--color-accent)}._c:not(:hover){color:var(--color-text)}._a{column-gap:var(--space-4);display:flex;row-gap:var(--space-4)}._b{height:88px;width:312px}
```

```tsx
<div className={("_a _b"+((active)?" _d":" _c"))} />   // Card
<div className={"_a"} />                               // Row
```

With `fuse: 'max'` everything the card always has is one class, and the rules it shares with the row are written under both names:

```css
._b:hover,._d{color:var(--color-accent)}._b:not(:hover){color:var(--color-text)}._a,._c{column-gap:var(--space-4);display:flex;row-gap:var(--space-4)}._c{height:88px;width:312px}
```

```tsx
<div className={("_c"+((active)?" _d":" _b"))} />   // Card
<div className={"_a"} />                            // Row
```

| Level | What is fused | The stylesheet | Elements |
| --- | --- | --- | --- |
| `'exact'` | Classes that appear in exactly the same groups, across the whole project | Every rule is still written once, under fewer names. It gets smaller | Fewer classes |
| `'balanced'` | Also two classes that often appear together, where they do | A rule is written under one more name when that removes more than two class names from the modules | Fewer again |
| `'max'` | Every group is one class | Every rule lists every group that uses it: the largest of the three, still without a declaration written twice | One class per group: one for a call without guards |

On the benchmark's 500 components (compressed with Brotli; see [benchmarks](benchmarks.md)): without fusion the stylesheet is 9.3 kB, the modules 29.6 kB and a page of 2,000 elements 26.4 kB. `'exact'` makes that 7.3, 25.1 and 22.0 kB. `'max'` makes it 25.5, 11.7 and 10.9 kB: the smallest total, with more of it in the stylesheet, which is downloaded once, and less in every module and every page.

**Nothing is overridden, as before.** A group is always written as classes that share no rule, so an element never matches two rules for one property. What applies to an element is exactly what applied before, under other names; the test suite compares the computed styles of a page in every state, for every level, with the unfused page.

**A style nothing applies is not written.** With fusion the build knows every class a compiled module can put on an element, so a style of a `css.create` whose every use was compiled away, and that no `css.props` call names, leaves no rule.

**Styles merged at run time are untouched.** A style that reaches a `css.props` call the compiler cannot fold (a style passed in as a prop, an exported `css.create`) keeps one class list per property, because the merge replaces properties one by one. Fusion still works inside each property.

### What it needs

- `names: 'min'`: fused classes are named by the build.
- A build that compiles every module once. A fused class depends on every module that uses its classes, so a change in one file can change the classes of another. A dev server or a watching build (`vite`, `vite build --watch`, Rollup's watch mode, webpack in development or watching, `purser build --watch`) therefore ignores `fuse` and keeps one name per class; the page looks the same either way.
- Every compiled module in `src`. A module that applies a group of classes the build has not seen cannot be compiled against a fused stylesheet, and the compiler says so (`this module applies a group of classes the stylesheet build has not seen`) instead of guessing.

With `namesFile`, the build also keeps its plan in the cache directory (`node_modules/.cache/purser/plan-….json`), which is where a loader in another process reads it. The names file itself stays a flat map of names.

Because the classes are planned again with every build, a change to one style can change which classes several modules carry, and so the bytes of their chunks. `'exact'` only ever touches the modules that share a class with the changed style.

## Build speed

- **One pass per module.** The stylesheet build and the compiler need the same parse and the same static evaluation. A plugin that writes the stylesheet does both at once and writes each module from the result.
- **The build cache** (`node_modules/.cache/purser`, or `cache: 'dir'`) keeps that result by content. A module that has not changed is not parsed again, in this build or the next; a build in which none has changed does not load the parser.
- **An unchanged build does nothing.** `purser build` leaves a record of what it read and wrote. When no source file, the tokens, `tsconfig.json` or an option changed and the stylesheet is still the one it wrote, the next run answers from the record (about 60 ms for 500 components, most of it Node starting). `--no-cache` turns the cache and the record off.
- **Worker threads** parse and compile modules in parallel from four processors on (`threads`).

## Tests

Vitest uses the Vite plugin, so tests run the compiled modules (unfused: a test run is not a production build). A test runner without a bundler (the Node test runner, Jest without a transform) runs the runtime, which gives the same classes for `'legacy'` and `'short'` names and both granularities. `names: 'min'` cannot work there; use hashed names in such tests.
