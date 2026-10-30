# Using Purser with Next.js

This guide targets the App Router of Next.js 16, where Turbopack is the default bundler for `next dev` and `next build`, and webpack is opt-in with `--webpack`. Purser does not need a bundler plugin: it writes one plain CSS file, which you import like any other stylesheet.

## 1. Install

```sh
npm install @avonao/purser
```

The build uses the project's own `typescript` to parse your source. If `postcss` is installed (Next.js projects usually have it), the build also re-parses its output as a self-check.

## 2. Tokens

Create `lib/tokens.ts` (or `.js`). The build loads it with Node's `import()`, which strips TypeScript types, so use **erasable syntax only**: no `enum`, `namespace` or constructor parameter properties. Relative imports inside it need explicit file extensions.

```ts
import { defineTokens } from '@avonao/purser';

export const bp = { md: '@media (width >= 768px)', lg: '@media (width >= 1024px)' } as const;

export const t = defineTokens({
  axes: { mode: { light: ':not(.dark)', dark: '.dark' } },
  tokens: {
    color: { text: { default: '#1a1a1a', 'mode=dark': '#ededed' }, surface: { default: '#fff', 'mode=dark': '#121212' } },
    space: { 2: '8px', 4: '16px' },
  },
});
```

Components can import it through your path alias (`@/lib/tokens`): the build resolves imports with your `tsconfig.json`.

## 3. Global rules

Put `css.globals` in any file under a scanned directory, for example `app/globals.purser.ts`. The file does not need to be imported anywhere, because `css.globals` does nothing at runtime.

```ts
import { css } from '@avonao/purser';
import { t } from '@/lib/tokens';

css.globals({
  ':root': { colorScheme: { default: 'light', ':is(.dark)': 'dark' } },
  '*, ::before, ::after': { boxSizing: 'border-box', margin: 0 },
  body: { color: t.color.text, backgroundColor: t.color.surface },
});
```

A global rule automatically gives way on elements that carry an atom class for the same property. A reset and a component style therefore never meet on one element.

## 4. Generate the stylesheet

`package.json`:

```json
{
  "scripts": {
    "css": "purser build --project . --src app,components,lib --tokens lib/tokens.ts --out app/purser.css",
    "css:check": "purser check --project . --src app,components,lib --tokens lib/tokens.ts",
    "dev": "npm run css -- --watch & next dev",
    "prebuild": "npm run css",
    "build": "next build --webpack"
  }
}
```

- **Development (Turbopack):** `purser build --watch` regenerates `app/purser.css` when a source file or the tokens module changes. It writes the file only when its content changes, so Turbopack hot-reloads the CSS without loops. On Windows, run the two commands in separate terminals or with a process runner instead of `&`.
- **Production (webpack or Turbopack):** `prebuild` writes the stylesheet before `next build`, so both bundlers see a complete, current file.
- **CI:** `npm run css:check` exits with status 1 on any rule violation and prints each one as `file:line:column: error: message`.

Add the generated file to `.gitignore` if you do not want to commit it, or commit it so that diffs show the CSS changes.

## 5. Import it once

`app/layout.tsx`:

```tsx
import './purser.css';
```

Import no other stylesheet that styles the same elements. Purser guarantees no overrides only within its own stylesheet.

## Adopting Purser next to existing CSS

A project that already has stylesheets can move to Purser one component at a time. While old and new CSS meet, two things must hold:

- No old rule overrides an element that has moved. Purser's atoms therefore sit above every existing layer.
- Purser's global rules do not override old rules on elements that have not moved yet. Globals therefore sit below the existing CSS.

Give Purser's layers top-level names and declare the order once, at the top of the first stylesheet the page loads. A `@layer` statement may come before `@import`, so it can also go above a framework's import:

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

Wrap the existing unlayered rules in the `legacy` layer, because unlayered rules beat every layer, Purser's included. Token names must not clash with custom properties that the old stylesheets declare.

Some page-wide rules have to win over the old CSS: a high-contrast or reduced-motion mode that the old stylesheets forced with `!important` is the usual case. Write those with `css.globals(rules, { layer: 'overrides' })` and give the overrides layer a name between the old CSS and the atoms. They give way on moved elements like any global, so a moved component that sets the property itself is never overridden:

```css
@layer legacy, purser-overrides, purser-atoms;
```

```json
"css": "purser build … --layers purser-tokens,purser-globals,purser-overrides,purser-atoms"
```

To move a component, write its styles with `css.create` and delete the old rules that reached its elements. Then confirm that nothing else changed: `scripts/strike-count.js` lists every declaration that is still overridden on the page. Once the last old rule is gone, remove the `legacy` layer and the `layer` option of the overrides, which are then ordinary globals. You can then return to the default layer names.

## Server and client components

`css.create`, `css.props` and the tokens object are pure functions with no React dependency. They work in server components, client components and route handlers. Class names are computed by the same code at build time, during server rendering and in the browser, so they always agree.

## Theme switching

Root conditions are classes on `<html>`, for example `.dark`. Toggle them however you like, such as with an inline script before hydration or a theme provider. Token values switch with them, and no class names change.

## Troubleshooting

| Message | Meaning |
| --- | --- |
| `css.create: "x" is not a static value` | A style value depends on runtime data. Use a custom property (`style={{ '--w': w }}`, `width: 'var(--w)'`). |
| `raw colour "…"` | Use a colour token. Declare one in the tokens module (it can be `'transparent'`). |
| `"border" is not allowed: use …` | Write the longhands the message lists. |
| `css must be used as css.create(…), …` | `css` was aliased or passed around. Call `css.create` and the other methods directly so the build can see every style. |
| `could not load the tokens module` | Check the tokens file for non-erasable TypeScript syntax, or for an import missing its file extension. |
