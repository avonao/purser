// Value validation shared by every compiled declaration (atoms, globals,
// keyframes, tokens). Build-only.

import { findColors } from './color.js';

const COLOR_BEARING = /color|^background|shadow|^fill$|^stroke$|filter$|^border-image|^mask|^outline|^--/;

/** Does `prop` take colours, so that named colours in it are raw colours? */
export function isColorBearing(prop) {
  return COLOR_BEARING.test(prop);
}

/**
 * Check a single declaration value. Returns a list of problems (empty = ok).
 * @param {string} prop kebab-case property
 * @param {string} value
 * @param {{ tokenNames?: Set<string>, tokenPrefixes?: string[], allowColors?: boolean }} [ctx]
 * @returns {string[]}
 */
export function checkValue(prop, value, ctx = {}) {
  const problems = [];
  if (/!\s*important/i.test(value)) problems.push(`"!important" is not allowed (${prop}: ${value})`);
  if (hasUnquoted(value, /[;{}]/)) problems.push(`"${value}" contains ";", "{" or "}" outside a string`);
  if (!ctx.allowColors) {
    for (const c of findColors(value, { named: isColorBearing(prop) })) {
      problems.push(`raw colour "${c.text}" in ${prop}; every colour must be a token (e.g. tokens.color.text)`);
    }
  }
  if (ctx.tokenNames && ctx.tokenPrefixes?.length) {
    for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const name = m[1];
      if (!ctx.tokenNames.has(name) && ctx.tokenPrefixes.some((p) => name.startsWith(p))) {
        problems.push(`unknown token ${name}`);
      }
    }
  }
  return problems;
}

function hasUnquoted(value, re) {
  let quote = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (re.test(c)) return true;
  }
  return false;
}

/** All leaf values of a normalised tree, with their paths. */
export function leaves(tree, path = []) {
  if (tree === null) return [];
  if (typeof tree === 'string') return [{ value: tree, path }];
  return Object.keys(tree).flatMap((k) => leaves(tree[k], [...path, k]));
}
