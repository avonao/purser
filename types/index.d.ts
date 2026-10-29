// Type declarations for @avonao/purser (runtime entry).

import type { KnownProperty, RejectedProperties } from './properties';

export type { KnownProperty, RejectedProperties };

declare const tokenBrand: unique symbol;
declare const styleBrand: unique symbol;

// ---------------------------------------------------------------------------
// Tokens

/**
 * A design token. At runtime it is the string `var(--group-name)`; the type
 * carries its group so that, for example, only colour tokens type-check where
 * a colour is expected.
 */
export type Token<Group extends string = string> = string & { readonly [tokenBrand]: Group };
/** A token from the `color` group. */
export type ColorToken = Token<'color'>;
/** A token from the `shadow` group. */
export type ShadowToken = Token<'shadow'>;

/** A plain token value. Colours may be hex, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch(), color() or named. */
export type TokenScalar = string | number;
/** Values per theme: `default` plus axis matches such as `'mode=dark'` or `'mode=dark&contrast=high'`. */
export interface ThemedTokenValue {
  readonly default?: TokenScalar;
  readonly [match: `${string}=${string}`]: TokenScalar | undefined;
}
export type TokenValue = TokenScalar | ThemedTokenValue;
export interface TokenBranch {
  readonly [name: string]: TokenValue | TokenBranch;
  readonly [name: number]: TokenValue | TokenBranch;
}

/**
 * Theme axes: each axis lists mutually exclusive root conditions, e.g.
 * `{ mode: { light: ':not(.dark)', dark: '.dark' } }`. A condition is a
 * compound selector applied to `:root`, an `@media …` query, or an array of
 * both (all must hold). If several values of one axis match, the later wins.
 */
export type Axes = Readonly<Record<string, Readonly<Record<string, string | readonly string[]>>>>;

export interface TokenDefinition {
  readonly axes?: Axes;
  readonly tokens: Readonly<Record<string, TokenBranch>>;
}

type IsThemed<V> = V extends object
  ? 'default' extends keyof V
    ? true
    : [Extract<keyof V, `${string}=${string}`>] extends [never]
      ? false
      : true
  : true;

type TokenTree<V, G extends string> = {
  readonly [K in keyof V]: IsThemed<V[K]> extends true ? Token<G> : TokenTree<V[K], G>;
};

/** The object returned by defineTokens: every leaf is a Token of its top-level group. */
export type TokenObject<T> = { readonly [G in keyof T & string]: TokenTree<T[G], G> };

/**
 * Declare design tokens. Each token becomes a custom property `--<group>-<name>`;
 * the build writes its value for every theme (colours as `lab()`).
 */
export declare function defineTokens<const T extends TokenDefinition>(definition: T): TokenObject<T['tokens']>;

// ---------------------------------------------------------------------------
// Styles

/** CSS-wide keywords. */
export type CSSWideKeyword = 'inherit' | 'initial' | 'unset' | 'revert' | 'revert-layer';

/** Where a colour is expected: a colour token, currentColor or a CSS-wide keyword. Raw colours are a type error. */
export type ColorValue = ColorToken | 'currentColor' | 'currentcolor' | CSSWideKeyword;
/** Shadows: a shadow token, `none`, a keyword, or a string built from tokens (checked by the build). */
export type ShadowValue = ShadowToken | 'none' | CSSWideKeyword | `${string}var(--${string})${string}`;
/** Any other value. Numbers get `px` except for unitless properties. */
export type PlainValue = string | number;

/** Condition keys: pseudo-classes, attribute selectors, @media, @supports, @container. */
export type ConditionKey = `:${string}` | `[${string}` | `@media ${string}` | `@supports ${string}` | `@container ${string}`;

/**
 * A value, `null` (unset), or a conditional object. `default` is the fallback;
 * among condition keys a later key wins when several are true. Nesting is allowed.
 */
export type Conditional<V> = V | null | ConditionalObject<V>;
export interface ConditionalObject<V> {
  readonly default?: Conditional<V>;
  readonly [condition: ConditionKey]: Conditional<V> | undefined;
}

/** Properties that take a single colour. */
export type ColorProperty =
  | 'accentColor'
  | 'backgroundColor'
  | 'borderColor'
  | 'borderTopColor'
  | 'borderRightColor'
  | 'borderBottomColor'
  | 'borderLeftColor'
  | 'borderBlockColor'
  | 'borderBlockStartColor'
  | 'borderBlockEndColor'
  | 'borderInlineColor'
  | 'borderInlineStartColor'
  | 'borderInlineEndColor'
  | 'caretColor'
  | 'color'
  | 'columnRuleColor'
  | 'floodColor'
  | 'lightingColor'
  | 'outlineColor'
  | 'stopColor'
  | 'textDecorationColor'
  | 'textEmphasisColor'
  | 'WebkitTapHighlightColor'
  | 'WebkitTextFillColor'
  | 'WebkitTextStrokeColor';

/** SVG paint: a colour, `none`, or a `url(#…)` reference. */
export type PaintValue = ColorValue | 'none' | 'context-fill' | 'context-stroke' | `url(${string})`;

type ShadowProperty = 'boxShadow' | 'textShadow';
type PaintProperty = 'fill' | 'stroke';
type Rejected = keyof RejectedProperties;

/** CSS properties of one element (or pseudo-element). */
export type StyleProperties = { readonly [K in ColorProperty]?: Conditional<ColorValue> } & {
  readonly [K in ShadowProperty]?: Conditional<ShadowValue>;
} & { readonly [K in PaintProperty]?: Conditional<PaintValue> } & {
  readonly [K in Exclude<KnownProperty, ColorProperty | ShadowProperty | PaintProperty | Rejected>]?: Conditional<PlainValue>;
} & { readonly [K in Rejected]?: RejectedProperties[K] } & {
  readonly [custom: `--${string}`]: Conditional<PlainValue> | undefined;
};

/** A style: properties plus `'::before'`-style pseudo-element blocks. */
export type StyleObject = StyleProperties & {
  readonly [pseudoElement: `::${string}`]: StyleProperties | undefined;
};

/** Opaque result of css.create for one named style. */
export interface CompiledStyle {
  readonly [styleBrand]: true;
}

/** Anything css.props accepts. */
export type StyleArg = CompiledStyle | null | undefined | false | 0 | '' | readonly StyleArg[];

/** Keyframes: frame selector (`from`, `to`, `50%`) to plain properties (no conditions). */
export type Keyframes = Readonly<Record<string, FlatStyleProperties>>;
type Flat<V> = V extends Conditional<infer U> ? U | null : V;
export type FlatStyleProperties = { readonly [K in keyof StyleProperties]?: Flat<StyleProperties[K]> };

/** An @font-face rule's descriptors. */
export interface FontFaceRule {
  readonly fontFamily: string;
  readonly src: string;
  readonly [descriptor: string]: string | number | undefined;
}

/** Global rules: selectors (`:root`, `html`, `body`, resets, `::selection`) and `@font-face`. */
export interface GlobalRules {
  readonly '@font-face'?: FontFaceRule | readonly FontFaceRule[];
  readonly [selector: string]: StyleObject | FontFaceRule | readonly FontFaceRule[] | undefined;
}

export interface Css {
  /** Define named styles. Values must be static (literals, tokens, consts). */
  create<K extends string>(styles: Readonly<Record<K, StyleObject>>): { readonly [P in K]: CompiledStyle };
  /** Merge styles left to right (later wins per property) into a class string. */
  props(...styles: StyleArg[]): string;
  /** Define keyframes; returns the generated animation name. */
  keyframes(frames: Keyframes): string;
  /** Define global rules. Compiled by the build; does nothing at runtime. */
  globals(rules: GlobalRules): void;
}

/** Naming options; the build must be given the same values. */
export interface CssOptions {
  /** Class name prefix (default `"x"`). */
  readonly prefix?: string;
  /** Hash salt (default `""`); change it only to resolve a reported collision. */
  readonly salt?: string;
}

/** The default css API (prefix `x`). */
export declare const css: Css;
/** Create a css API with custom naming options. */
export declare function createCss(options?: CssOptions): Css;
