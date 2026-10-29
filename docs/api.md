# API reference

```ts
import { css, createCss, defineTokens } from '@avonao/purser';
import { build, check, watch, createBuilder } from '@avonao/purser/build';
```

## `defineTokens(definition)`

```ts
defineTokens({
  axes?: { [axis: string]: { [value: string]: string | string[] } },
  tokens: { [group: string]: { [name: string]: TokenValue | NestedGroup } },
}): TokenObject
```

- **Axes** are independent theme dimensions. Each value is a root condition: a compound selector applied to `:root` (`'.dark'`, `':not(.dark)'`, `'[data-theme="dim"]'`), an `'@media …'` query, or an array of both, all of which must hold. Within an axis, if several values match, the later one wins.
- **A token value** is a string or number, or an object of themed values: `default` plus matches such as `'mode=dark'` or `'mode=dark&contrast=high'`. For every combination of axis values, the matching key with the most axes wins. A tie between different values is a build error, and so is a combination with no value (add a `default`).
- **Names.** `color.text` becomes `--color-text`, `fontSize.sm` becomes `--font-size-sm`, and nested groups join with `-` (`color.brand.500` becomes `--color-brand-500`). Characters outside `[A-Za-z0-9_-]` become `_`. Two tokens with the same custom property name are a build error.
- **Colours.** Colours anywhere in a token value are converted to `lab()`. Named colours (including `transparent`) are recognised in the `color` and `shadow` groups.
- **Return value.** A frozen object in which every token is the string `var(--name)`. In TypeScript each leaf is a `Token<Group>`, so `t.color.text` is a `ColorToken`.
- A token may reference another token: `link: 'var(--color-accent)'`. Referencing a token that does not exist is a build error.

The tokens module may also export other plain data (strings, numbers, objects and arrays), such as breakpoints. Components can use those exports in static styles.

## `css.create(styles)`

```ts
css.create({ [name: string]: StyleObject }): { [name]: CompiledStyle }
```

A `StyleObject` maps CSS properties (camelCase, or `--custom`) to values, plus `'::pseudo-element'` keys holding one nested level of properties.

A **value** is one of:

- a string, such as `'flex'` or `t.space[4]`;
- a number (`px` added except for unitless properties);
- `null`, which leaves the property unset (and removes it from earlier styles in `css.props`);
- a **conditional object**: `{ default?: value, [condition]: value }`, nestable.

**Condition keys:**

| Key | Example |
| --- | --- |
| pseudo-class | `':hover'`, `':focus-visible'`, `':disabled'`, `':not(:first-child)'` |
| attribute | `'[aria-expanded="true"]'`, `'[data-state=open]'` |
| ancestor or relational state | `':is(.dark *)'`, `':has(> img)'` |
| media | `'@media (width >= 768px)'`, `'@media (hover: hover) and (pointer: fine)'`, `'@media print'` |
| supports | `'@supports (display: grid)'` |
| container | `'@container (width > 400px)'`, `'@container sidebar (width > 400px)'` |

A selector condition must be a single compound selector. Combinators and lists are rejected, so use `:is(…)` or `:has(…)` instead. `default` is the fallback, and among the condition keys a later key wins when several are true.

**Static values only.** The build evaluates each argument without running your code. It accepts literals, template literals, unary minus, spreads, computed keys, `as const`/`satisfies`, `const` bindings in the same file, the tokens module's exports, and `css.keyframes(…)` names. Anything else is a build error that names the file and line.

## `css.props(...styles)`

```ts
css.props(...styles: (CompiledStyle | false | null | undefined | 0 | '' | StyleArg[])[]): string
```

Merges left to right and returns the class string. A later style wins per property. Logical and physical twins (`marginTop` and `marginBlockStart`) replace each other. Falsy values are ignored and arrays are flattened. Throws if given anything that `css.create` did not return.

Use exactly one `css.props` call per element. Joining class strings by hand bypasses the merge and can cause overrides.

## `css.keyframes(frames)`

```ts
const fade = css.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
css.create({ a: { animationName: fade, animationDuration: '200ms' } });
```

Returns the generated name. Frames are `from`, `to` or percentages, and hold plain (non-conditional) properties. Identical keyframes share one name.

## `css.globals(rules)`

```ts
css.globals({
  ':root': { colorScheme: { default: 'light', ':is(.dark)': 'dark' } },
  '*, ::before, ::after': { boxSizing: 'border-box', margin: 0 },
  body: { color: t.color.text },
  'html::-webkit-scrollbar': { width: '8px' },
  '::selection': { backgroundColor: t.color.selection },
  '@font-face': [{ fontFamily: 'Inter', src: 'url(/inter.woff2) format("woff2")', fontDisplay: 'swap' }],
});
```

Keys are selectors (selector lists are split), or `'@font-face'` with one object or an array. Values follow the same rules as `css.create`, including conditions, longhands only, tokens for colours and no `!important`. A global may not redeclare a token's custom property.

The build makes globals exclusive with each other (a later rule wins) and with atoms (a global gives way on elements carrying an atom class for the same property). Globals are compiled from source, so the call does nothing at runtime.

## `createCss(options)`

```ts
const css = createCss({ prefix: 'p', salt: '' });
```

`prefix` (default `x`) must be a CSS identifier. `salt` (default empty) changes every hash; use it only to resolve a reported collision.

Export the custom instance as `css` from one module, and tell the build about that module and its options:

```ts
// lib/css.ts
import { createCss } from '@avonao/purser';
export const css = createCss({ prefix: 'p' });
```

```sh
purser build … --css-module lib/css.ts --prefix p
```

Components then `import { css } from '@/lib/css'`.

## Build API (`@avonao/purser/build`)

```ts
build(options: BuildOptions): Promise<BuildResult>
check(options: Omit<BuildOptions, 'out'>): Promise<BuildResult>
watch(options: BuildOptions, onResult: (r: BuildResult) => void): Promise<{ close(): void }>
createBuilder(options: BuildOptions): { run(): Promise<BuildResult>, … }

interface BuildOptions {
  projectDir: string;   // typescript and postcss resolve from here
  src: string[];        // directories or files, relative to projectDir
  tokens?: string;      // tokens module, relative to projectDir
  out?: string;         // output file; written only when its content changes
  prefix?: string;      // default "x"
  salt?: string;        // default ""
  packageName?: string; // default "@avonao/purser"
  cssModule?: string;   // module exporting a custom css = createCss({ … })
  layers?: { tokens?: string; globals?: string; atoms?: string }; // cascade layer names
}

interface BuildResult {
  css: string | null;   // null when there are errors
  diagnostics: { severity: 'error' | 'warning'; message: string; file?: string; line?: number; column?: number }[];
  stats: { files; atoms; rules; keyframes; tokens } | null;
  written: boolean;
  outFile: string | null;
}
```

The build scans `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.mts`, `.cts` and `.cjs` files, skipping `node_modules`, dot-directories and build output folders. It parses only files that mention the package name. Imports resolve with the project's `tsconfig.json` (`paths` aliases work).

## CLI

```
purser build --project <dir> --src <dirs> --tokens <file> --out <file> [--watch]
purser check --project <dir> --src <dirs> --tokens <file>
  [--prefix <name>] [--salt <text>] [--package <name>] [--css-module <file>]
  [--layers <tokens>,<globals>,<atoms>]
```

`--layers` (and the `layers` build option) names the three cascade layers. The defaults are `purser.tokens`, `purser.globals` and `purser.atoms`, which are sublayers of one `purser` layer and therefore sit together in the cascade. Give them top-level names when Purser joins an existing stylesheet; see [Adopting Purser next to existing CSS](nextjs.md#adopting-purser-next-to-existing-css).

Exit codes: `0` for success, `1` for rule violations or errors (each printed as `file:line:column: error: message`), and `2` for usage errors.

## `scripts/strike-count.js`

An in-page script. Evaluating it returns `{ count, struck: [{ element, pseudo, property, sources }], rules, skipped }` for the page's current state. It also defines `globalThis.purserStrikeCount()` so you can call it again after changing hover, focus or width. `@container` rules are reported in `skipped`, because they cannot be evaluated from script.
