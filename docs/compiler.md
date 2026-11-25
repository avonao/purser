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
  return <div className={("_a _b _c _d"+((active)?" _k":" _e _f"))} />;
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
| `namesFile` | With `names: 'min'`: a JSON file that keeps the names between builds |
| `prefix`, `salt`, `packageName`, `cssModule`, `layers` | As for [`purser build`](api.md#cli) |
| `projectDir` | The project root. Default: the bundler's root |
| `compile` | `false` writes the stylesheet and leaves the modules as they are |

The naming options (`prefix`, `salt`, `names`, `granularity`) must be the same wherever class names are computed: in the plugin, in a separate `purser build`, and in `createCss` for any module that is not compiled.

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

With `names: 'min'` under Turbopack, give the same `namesFile` to `purser build --names min --names-file …` and to the loader: the build writes the names, the loader reads them.

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

Three options shrink what is sent. Each is separate; the benchmark's "compiled, minimal names" row uses all three.

**`minify`** writes the stylesheet without whitespace and merges rules that write the same declaration in the same context into one rule with a selector list. Only selectors that every target browser parses are merged, because a browser drops a whole list when it does not know one selector in it: a rule with `:has()` or a vendor pseudo-element always stays on its own.

**`granularity: 'rule'`** gives every generated rule its own class instead of every property of a style. With the default, `color: { default: A, ':hover': B }` in one style and `color: { default: A, ':hover': C }` in another are two classes, and `color: A` outside hover is written twice. With rule granularity both styles carry the same class for it and the stylesheet has that rule once. Elements carry more classes (one per rule of a conditional property) and the stylesheet has far fewer rules. The rules for one property are the same rules as before, under more names, so they stay mutually exclusive. The runtime supports it too (`createCss({ granularity: 'rule' })` or `PURSER_GRANULARITY=rule`), at the price of the condition compiler in the bundle; compiled modules pay nothing.

**`names: 'min'`** replaces hashed names with the shortest names there are. A hashed name needs no shared state, but it is random text, and random text does not compress: four characters cost about three bytes wherever they appear. The build sees every class and how often it is used, and hands out `_a`, `_b`, … to the most used first. The names exist only in the build, so every module must be compiled; an uncompiled `css.create` throws with a message that says so.

The underscore keeps a minimal name from ever being a word that someone else's stylesheet uses (`btn`, `row`, `h1`). `prefix: ''` removes it for a project whose page has no other CSS.

Names are append-only: within one build process, and across builds when `namesFile` is set, a class keeps its name, so adding a style renames nothing. Without a names file the names are computed from scratch, and the same source always gives the same names. Commit the names file, or cache it in CI, to keep JavaScript chunks byte-identical between deploys when only some styles change.

## Tests

Vitest uses the Vite plugin, so tests run the compiled modules. A test runner without a bundler (the Node test runner, Jest without a transform) runs the runtime, which gives the same classes for `'legacy'` and `'short'` names and both granularities. `names: 'min'` cannot work there; use hashed names in such tests.
