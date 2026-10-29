// defineTokens: the runtime half. It only maps every token to `var(--name)`;
// values, themes and colour conversion are compiled by the build.

/** Symbol under which the original definition is kept for the build. */
export const TOKENS = Symbol.for('purser.tokens');

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

/** Custom property name for a token path, e.g. ['color', 'text'] -> '--color-text'. */
export function tokenVarName(path) {
  return `--${path.map((p) => sanitize(kebab(String(p)))).join('-')}`;
}

/** A conditional token value has a `default` key or keys like 'mode=dark'. */
export function isConditionalTokenValue(v) {
  return v !== null && typeof v === 'object' && Object.keys(v).some((k) => k === 'default' || k.includes('='));
}

/**
 * Walk a token tree, calling `fn(path, value)` for each token.
 * @param {object} tree
 * @param {(path: string[], value: unknown) => void} fn
 */
export function walkTokens(tree, fn, path = []) {
  for (const key of Object.keys(tree)) {
    const v = tree[key];
    const p = [...path, key];
    if (v !== null && typeof v === 'object' && !isConditionalTokenValue(v)) walkTokens(v, fn, p);
    else fn(p, v);
  }
}

function build(tree, path, freeze = true) {
  const out = {};
  for (const key of Object.keys(tree)) {
    const v = tree[key];
    const p = [...path, key];
    if (v !== null && typeof v === 'object' && !isConditionalTokenValue(v)) out[key] = build(v, p);
    else out[key] = `var(${tokenVarName(p)})`;
  }
  return freeze ? Object.freeze(out) : out;
}

/**
 * Declare design tokens. Every token becomes a CSS custom property; the
 * returned object maps each token to the string `var(--group-name)`.
 * @param {{ axes?: Record<string, Record<string, string | string[]>>, tokens: Record<string, object> }} definition
 */
export function defineTokens(definition) {
  if (!definition || typeof definition !== 'object' || !definition.tokens || typeof definition.tokens !== 'object') {
    throw new TypeError('purser: defineTokens({ axes, tokens }) needs a `tokens` object');
  }
  const result = build(definition.tokens, [], false);
  Object.defineProperty(result, TOKENS, { value: { axes: definition.axes ?? {}, tokens: definition.tokens } });
  return Object.freeze(result);
}
