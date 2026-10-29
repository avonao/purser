// Shorthand policy. A shorthand and one of its longhands on the same element is
// an override (DevTools strikes one of them), so every shorthand that has
// longhands is either expanded here at compile time, or rejected with advice.
// Shared by runtime and build.

const sides = (p, s = '') => [`${p}-top${s}`, `${p}-right${s}`, `${p}-bottom${s}`, `${p}-left${s}`];
const logical = (p, axis, s = '') => [`${p}-${axis}-start${s}`, `${p}-${axis}-end${s}`];

/** Shorthands taking 1–4 values in top/right/bottom/left order. */
const FOUR = {
  padding: sides('padding'),
  margin: sides('margin'),
  inset: ['top', 'right', 'bottom', 'left'],
  'scroll-margin': sides('scroll-margin'),
  'scroll-padding': sides('scroll-padding'),
  'border-width': sides('border', '-width'),
  'border-style': sides('border', '-style'),
  'border-color': sides('border', '-color'),
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
};

/** Shorthands taking 1–2 values (second defaults to the first). */
const TWO = {
  gap: ['row-gap', 'column-gap'],
  overflow: ['overflow-x', 'overflow-y'],
  'overscroll-behavior': ['overscroll-behavior-x', 'overscroll-behavior-y'],
  'padding-inline': logical('padding', 'inline'),
  'padding-block': logical('padding', 'block'),
  'margin-inline': logical('margin', 'inline'),
  'margin-block': logical('margin', 'block'),
  'inset-inline': logical('inset', 'inline'),
  'inset-block': logical('inset', 'block'),
  'scroll-margin-inline': logical('scroll-margin', 'inline'),
  'scroll-margin-block': logical('scroll-margin', 'block'),
  'scroll-padding-inline': logical('scroll-padding', 'inline'),
  'scroll-padding-block': logical('scroll-padding', 'block'),
  'border-inline-width': logical('border', 'inline', '-width'),
  'border-block-width': logical('border', 'block', '-width'),
  'border-inline-style': logical('border', 'inline', '-style'),
  'border-block-style': logical('border', 'block', '-style'),
  'border-inline-color': logical('border', 'inline', '-color'),
  'border-block-color': logical('border', 'block', '-color'),
  'place-content': ['align-content', 'justify-content'],
  'place-items': ['align-items', 'justify-items'],
  'place-self': ['align-self', 'justify-self'],
};

/** Grid placement shorthands ("/"-separated). */
const GRID = {
  'grid-row': ['grid-row-start', 'grid-row-end'],
  'grid-column': ['grid-column-start', 'grid-column-end'],
  'grid-area': ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'],
};

/** Shorthands that are rejected, with the advice shown to the author. */
export const REJECTED = {
  all: 'the "all" shorthand sets every property at once, so it overrides every other declaration on the element',
  background: 'use backgroundColor, backgroundImage, backgroundSize, backgroundPosition, backgroundRepeat, …',
  border: 'use borderWidth, borderStyle and borderColor (each expands to the four sides)',
  'border-top': 'use borderTopWidth, borderTopStyle and borderTopColor',
  'border-right': 'use borderRightWidth, borderRightStyle and borderRightColor',
  'border-bottom': 'use borderBottomWidth, borderBottomStyle and borderBottomColor',
  'border-left': 'use borderLeftWidth, borderLeftStyle and borderLeftColor',
  'border-block': 'use borderBlockWidth, borderBlockStyle and borderBlockColor',
  'border-inline': 'use borderInlineWidth, borderInlineStyle and borderInlineColor',
  'border-block-start': 'use borderBlockStartWidth, borderBlockStartStyle and borderBlockStartColor',
  'border-block-end': 'use borderBlockEndWidth, borderBlockEndStyle and borderBlockEndColor',
  'border-inline-start': 'use borderInlineStartWidth, borderInlineStartStyle and borderInlineStartColor',
  'border-inline-end': 'use borderInlineEndWidth, borderInlineEndStyle and borderInlineEndColor',
  'border-image': 'use borderImageSource, borderImageSlice, borderImageWidth, borderImageOutset, borderImageRepeat',
  outline: 'use outlineWidth, outlineStyle, outlineColor (and outlineOffset)',
  font: 'use fontFamily, fontSize, fontWeight, lineHeight, fontStyle, …',
  'font-variant': 'use fontVariantNumeric, fontVariantCaps, fontVariantLigatures, …',
  'font-synthesis': 'use fontSynthesisWeight, fontSynthesisStyle, fontSynthesisSmallCaps',
  transition: 'use transitionProperty, transitionDuration, transitionTimingFunction, transitionDelay',
  animation: 'use animationName, animationDuration, animationTimingFunction, animationIterationCount, …',
  'animation-range': 'use animationRangeStart and animationRangeEnd',
  grid: 'use gridTemplateColumns, gridTemplateRows, gridTemplateAreas, gridAutoFlow, …',
  'grid-template': 'use gridTemplateColumns, gridTemplateRows and gridTemplateAreas',
  flex: 'use flexGrow, flexShrink and flexBasis (flex: 1 is flexGrow: 1, flexShrink: 1, flexBasis: "0%")',
  'flex-flow': 'use flexDirection and flexWrap',
  'text-decoration': 'use textDecorationLine, textDecorationStyle, textDecorationColor, textDecorationThickness',
  'text-emphasis': 'use textEmphasisStyle and textEmphasisColor',
  'text-wrap': 'use textWrapStyle (balance, pretty, stable); wrapping itself is set with whiteSpace',
  'list-style': 'use listStyleType, listStylePosition and listStyleImage',
  columns: 'use columnWidth and columnCount',
  'column-rule': 'use columnRuleWidth, columnRuleStyle and columnRuleColor',
  'contain-intrinsic-size': 'use containIntrinsicWidth and containIntrinsicHeight',
  container: 'use containerType and containerName',
  mask: 'use maskImage, maskSize, maskPosition, maskRepeat, …',
  'mask-border': 'use maskBorderSource, maskBorderSlice, …',
  offset: 'use offsetPath, offsetDistance, offsetRotate, offsetAnchor, offsetPosition',
  marker: 'use markerStart, markerMid and markerEnd',
  'scroll-timeline': 'use scrollTimelineName and scrollTimelineAxis',
  'view-timeline': 'use viewTimelineName, viewTimelineAxis and viewTimelineInset',
  'position-try': 'use positionTryOrder and positionTryFallbacks',
  'text-box': 'use textBoxTrim and textBoxEdge',
  '-webkit-text-stroke': 'use WebkitTextStrokeWidth and WebkitTextStrokeColor',
  '-webkit-mask': 'use maskImage, maskSize, …',
  // Legacy aliases: two names for one property are an override waiting to happen.
  'word-wrap': 'use overflowWrap (wordWrap is a legacy alias)',
  'grid-gap': 'use gap (gridGap is a legacy alias)',
  'grid-row-gap': 'use rowGap (gridRowGap is a legacy alias)',
  'grid-column-gap': 'use columnGap (gridColumnGap is a legacy alias)',
  // Longhands of shorthands that stay allowed as a whole.
  'white-space-collapse': 'use whiteSpace (it sets whiteSpaceCollapse and textWrapMode together)',
  'text-wrap-mode': 'use whiteSpace (it sets whiteSpaceCollapse and textWrapMode together)',
  'background-position-x': 'use backgroundPosition',
  'background-position-y': 'use backgroundPosition',
  'background-repeat-x': 'use backgroundRepeat',
  'background-repeat-y': 'use backgroundRepeat',
};

/** Split a value on top-level whitespace (not inside parentheses or quotes). */
export function splitTopLevel(value, separator = /\s/) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      cur += c;
      if (c === '\\') cur += value[++i] ?? '';
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth === 0 && separator.test(c)) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const isCustomIdent = (v) => /^-?[a-zA-Z_][\w-]*$/.test(v) && v !== 'auto' && v !== 'span' && !CSS_WIDE.has(v);

/**
 * Expand one leaf value of a shorthand into the longhand values.
 * @returns {string[]} one value per longhand
 */
function expandLeaf(prop, value, fail) {
  if (CSS_WIDE.has(value)) {
    const n = (FOUR[prop] ?? TWO[prop] ?? GRID[prop]).length;
    return Array(n).fill(value);
  }
  if (FOUR[prop]) {
    if (prop === 'border-radius' && value.includes('/')) {
      fail('borderRadius with "/" (elliptical corners) is not expanded; use the four corner longhands, e.g. borderTopLeftRadius: "10px 5px"');
    }
    const p = splitTopLevel(value);
    if (p.length < 1 || p.length > 4) fail(`expected 1 to 4 values, got ${p.length}`);
    const [a, b = a, c = a, d = b] = p;
    return [a, b, c, d];
  }
  if (TWO[prop]) {
    const p = splitTopLevel(value);
    if (p.length < 1 || p.length > 2) fail(`expected 1 or 2 values, got ${p.length}`);
    let second = p[1] ?? p[0];
    if (prop === 'place-content' && p.length === 1 && /baseline/.test(p[0])) second = 'start';
    return [p[0], second];
  }
  // grid placement
  if (/\bvar\(/.test(value)) fail(`var() cannot be expanded safely here; use the longhands (${GRID[prop].join(', ')})`);
  const p = value.split('/').map((s) => s.trim());
  if (p.some((x) => !x)) fail('empty grid line value');
  if (prop === 'grid-area') {
    if (p.length > 4) fail(`expected 1 to 4 values, got ${p.length}`);
    const rs = p[0];
    const cs = p[1] ?? (isCustomIdent(rs) ? rs : 'auto');
    const re = p[2] ?? (isCustomIdent(rs) ? rs : 'auto');
    const ce = p[3] ?? (isCustomIdent(cs) ? cs : 'auto');
    return [rs, cs, re, ce];
  }
  if (p.length > 2) fail(`expected 1 or 2 values, got ${p.length}`);
  return [p[0], p[1] ?? (isCustomIdent(p[0]) ? p[0] : 'auto')];
}

/** Map every leaf of a conditional value tree. */
function mapTree(tree, fn) {
  if (tree === null || typeof tree === 'string') return fn(tree);
  const out = {};
  for (const k of Object.keys(tree)) out[k] = mapTree(tree[k], fn);
  return out;
}

/**
 * Expand a (normalised) property into longhands.
 * @param {string} prop kebab-case property
 * @param {any} tree normalised conditional value tree
 * @param {(msg: string) => never} fail
 * @returns {[string, any][]} pairs of [longhand, tree]
 */
export function expandProperty(prop, tree, fail) {
  if (Object.hasOwn(REJECTED, prop)) fail(`"${prop}" is not allowed: ${REJECTED[prop]}`);
  const longhands = FOUR[prop] ?? TWO[prop] ?? GRID[prop];
  if (!longhands) return [[prop, tree]];
  const cache = new Map();
  const leaf = (v) => {
    if (v === null) return null;
    if (!cache.has(v)) cache.set(v, expandLeaf(prop, v, fail));
    return cache.get(v);
  };
  return longhands.map((lh, i) => [lh, mapTree(tree, (v) => (v === null ? null : leaf(v)[i]))]);
}

/** Is `prop` a shorthand that purser expands? */
export function isExpandedShorthand(prop) {
  return Boolean(FOUR[prop] ?? TWO[prop] ?? GRID[prop]);
}
