# How Purser works

Purser has two halves that share code:

- **Runtime** (`@avonao/purser`, `src/runtime.js` and friends): `css.create` normalises each style and hashes it into class names, and `css.props` merges them. It never emits CSS.
- **Build** (`purser build`, `src/build/` and `src/compile/`): it parses your source with your project's TypeScript, statically evaluates every `css.create` / `css.keyframes` / `css.globals` argument, and writes one stylesheet.

Both halves normalise and name styles with the same modules (`normalize.js`, `shorthands.js`, `conflicts.js`, `hash.js`), so a class name computed in the browser always equals the one in the stylesheet.

## 1. From a style to atoms

`css.create({ card: { padding: 4, color: { default: A, ':hover': B } } })` normalises each key:

1. **Property names** become kebab-case (`backgroundColor` → `background-color`, `WebkitLineClamp` → `-webkit-line-clamp`).
2. **Numbers** get `px`, except on unitless properties (`lineHeight`, `opacity`, `zIndex`, …) and custom properties.
3. **Shorthands** expand to longhands (`padding` → four sides), or are rejected with advice (see below).
4. **Conditional values** take a canonical shape: `default` first, then the condition keys in authoring order, with whitespace collapsed.
5. **Later keys win.** A longhand after its shorthand replaces that side. A logical property and its physical twin (`marginTop` and `marginBlockStart`) replace each other.

Each resulting `(pseudo-element, longhand, value tree)` is one **atom**. Its class name hashes exactly that triple, so identical definitions anywhere in the app share one class and one set of rules.

`css.props(a, b)` merges atoms by `(pseudo-element, longhand)`, left to right. A later style replaces an earlier one's class for the same property and for its logical/physical twins. Every element therefore carries at most one class per property.

## 2. Exclusive conditions

A conditional value flattens into ordered **branches**. Each branch is a conjunction of **literals**: an atom (a selector fragment such as `:hover`, a media feature, a supports or container condition) with a polarity.

```
color: { default: A, ':hover': { default: B, '@media (w >= 768px)': C }, ':focus-visible': D }

branch 0: (always)                 → A
branch 1: :hover                   → B
branch 2: :hover ∧ (w >= 768px)    → C
branch 3: :focus-visible           → D
```

A later branch wins when several hold, so branch *i* applies exactly where

    Cᵢ ∧ ¬Cᵢ₊₁ ∧ … ∧ ¬Cₙ

Negating a conjunction `¬(l₁ ∧ l₂ ∧ … ∧ lₖ)` gives a disjunction. A disjunction cannot be one CSS rule, and two overlapping rules would be an override. Purser writes the disjunction as **disjoint pieces**:

    ¬l₁  ∨  (l₁ ∧ ¬l₂)  ∨  (l₁ ∧ l₂ ∧ ¬l₃)  ∨ …

Expanding the product gives, for every branch, a list of disjoint **terms**. Every term becomes one CSS rule. Two rules from different branches can never match together, because each excludes the other's conditions. Two terms of one branch can never match together either, by construction. The example compiles to:

```css
.x…:not(:hover):not(:focus-visible) { color: A }
@media not (w >= 768px) { .x…:hover:not(:focus-visible) { color: B } }
@media (w >= 768px)     { .x…:hover:not(:focus-visible) { color: C } }
.x…:focus-visible { color: D }
```

Rendering:

- **Selector literals** append to the class: `:hover`, and `:not(:hover)` for the negation. `:not(:hover)` in a key is recognised as the negation of `:hover`.
- **Media literals** join into one `@media` with Media Queries 4 syntax: `not (q)` alone, or `(a) and (not (b))`. Media types (`print`) nest as their own `@media print` / `@media not print`.
- **`@supports`** works like media. **`@container`** groups by container name.

Simplifications keep the output small and stay exact. Terms that differ only in one literal's polarity merge, and terms of branches with equal values merge too. Atoms are treated as independent, which can leave a dead term (such as `(w >= 1024px) and (not (w >= 768px))`) but can never create an overlap. Overlap-freedom holds over every combination of atom truth values, and real browser states are a subset of those combinations.

**Self-check.** For every compiled property, the build enumerates all 2ⁿ truth assignments of the property's atoms (n ≤ 14) and asserts that exactly the authoring-order winner matches. The test suite runs the same check, and also compares the output against an independent evaluator of the raw tree, on hundreds of random trees.

## 3. Globals

Global rules (`css.globals`) obey the same rule. For each property, Purser takes every global rule that sets it or a logical/physical twin, in authoring order across files sorted by path, and applies the same disjointification. Each global's selector acts as an atom: `:not(body)` excludes a later `body` rule, and two different tag names are known never to match one element.

Globals must also never meet an atom on one element. Each global rule therefore excludes every atom class for the same property: `*:not(.xabc…, .xdef…) { margin-top: 0 }`. Some atoms leave the property unset in some states, because they have no `default` or have a `null` branch. Where such a class leaves the property unset, the global rule is re-emitted for elements with that class (`body.xabc…:not(:hover) { … }`). The build verifies globals and atoms together by brute force.

## 4. Tokens and theme axes

Each **axis** lists root conditions, for example `mode: { light: ':not(.dark)', dark: '.dark' }`. The values of one axis are disjointified in order, so if two values match, the later one wins. This makes axes exclusive even when their conditions are not, such as `.bg2` and `.bg0` both present. When an axis is not exhaustive (some root state matches none of its values), the build warns.

Each token is resolved for **every combination** of axis values. Among the keys that match, the one with the most axes wins; a tie between different values is an error, and so is a combination with no value. Purser then computes the set of axes the token **actually depends on**: the axes where changing only that axis changes its value. Tokens are grouped by that set, and each group gets one rule per combination of its axes:

```css
:root { --color-accent: …; }                                  /* depends on nothing */
:root:not(.dark) { --color-line: …; }  :root.dark { … }       /* mode */
:root:not(.dark):not(.hc) { --color-text: …; } …              /* mode × contrast: 4 rules */
```

Every custom property is declared by exactly one rule in any root state. The build verifies this by brute force over all root states, and checks each value against the resolution.

## 5. Colours

Raw colours are rejected in every style value (atoms, globals and keyframes): hex, colour functions, and named colours (including `transparent`) in colour-bearing properties. In the types, colour properties accept only `Token<'color'>`, `currentColor`, the CSS Color 4 system colours (`Canvas`, `ButtonText`, `Highlight` and the rest) and CSS-wide keywords. System colours are allowed because forced colours (Windows contrast themes) replace every author colour with the system palette, and a style that sets a colour there has to name it.

Token values are converted to `lab()` following CSS Color 4:

- sRGB-family inputs (hex, `rgb()`, `hsl()`, `hwb()`, named colours) are linearised and multiplied into XYZ D65.
- `oklch()` → `oklab()` → LMS (cubed) → linear sRGB → XYZ D65.
- `color(display-p3 …)` and `color(srgb-linear …)` use their own matrices.
- XYZ D65 is adapted to D50 with the Bradford matrix, then converted to Lab (ε = 216/24389, κ = 24389/27).

Results round to 4 decimals with trailing zeros and `-0` removed, and alpha is kept as `/ a`. `oklch(71.57% 0.1797 33.51)` becomes `lab(65.4459 53.8462 44.2739)`. `#fff` and `oklch(100% 0 0)` become `lab(100 0 0)`. Colours inside token values are converted too: hex and colour functions in every group (shadows, gradients), and named colours in the `color` and `shadow` groups.

## 6. Class names

A name is `prefix` + 7 base-36 characters of a 53-bit hash (cyrb53) of the canonical description:

- an atom: `pseudo-element | property | canonical value tree`
- keyframes: `@keyframes | canonical frames`

That leaves about 7.8·10¹⁰ possible names. The build fails if two different definitions get the same name; changing the `salt` (in `createCss` and in `--salt`) resolves a collision. The hash is part of the public contract: changing it renames every class.

## 7. Output

```
/* Generated by purser. Do not edit. */
@layer purser.tokens, purser.globals, purser.atoms;
@layer purser.tokens  { … }
@layer purser.globals { @font-face …; rules … }
@layer purser.atoms   { unconditional rules; at-rule groups; @keyframes }
```

The three layer names can be changed with the `layers` build option or `--layers`. A stylesheet that declares a layer order before Purser's does decides where the three sit among its own layers ([adopting Purser next to existing CSS](nextjs.md#adopting-purser-next-to-existing-css)). Globals and atoms are exclusive by construction, so their relative order never decides a value.

Order is deterministic: atoms sort by property, pseudo-element and class, and at-rule groups sort by prelude. Because rules for one property never overlap, the order does not affect which declaration wins. When `postcss` is available, the build parses the output and checks it again for `!important`, colours that are not `lab()`, and repeated declarations.

## 8. Shorthand policy

| Kind | Properties |
| --- | --- |
| Expanded | `padding`, `margin`, `inset`, `scrollMargin`, `scrollPadding`, `borderWidth`, `borderStyle`, `borderColor`, `borderRadius` (no `/`), `gap`, `overflow`, `overscrollBehavior`, `place{Content,Items,Self}`, `{padding,margin,inset,scrollMargin,scrollPadding}{Inline,Block}`, `border{Inline,Block}{Width,Style,Color}`, `gridRow`, `gridColumn`, `gridArea` |
| Allowed whole; longhands rejected | `whiteSpace` (not `whiteSpaceCollapse` / `textWrapMode`), `backgroundPosition`, `backgroundRepeat` |
| Rejected | `all`, `background`, `border`, `border{Top,…,InlineEnd}`, `borderImage`, `outline`, `font`, `fontVariant`, `fontSynthesis`, `transition`, `animation`, `animationRange`, `grid`, `gridTemplate`, `flex`, `flexFlow`, `textDecoration`, `textEmphasis`, `textWrap`, `listStyle`, `columns`, `columnRule`, `containIntrinsicSize`, `container`, `mask`, `offset`, `marker`, timeline shorthands, legacy aliases (`wordWrap`, `gridGap`, …) |

A token used in an expanded shorthand must hold a single value: `padding: t.space[4]` sets all four sides to `var(--space-4)`.
