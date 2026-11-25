// css.props: merge compiled styles into a class string. This is all a page needs at run time once its styles are
// compiled (see ./compiled.js), so it imports nothing but the table of conflicting properties.

import { conflictsOf } from './conflicts.js';

/** Marks objects produced by css.create so css.props can reject anything else. */
export const STYLE = Symbol.for('purser.style');

/** Key under which css.props merges a property ("color", "::before color"). */
export function mergeKey(pe, prop) {
  return pe ? `${pe} ${prop}` : prop;
}

/**
 * Merge compiled styles left to right (later wins per property) and return
 * the class string. Falsy arguments are ignored; arrays are flattened.
 * @param {...unknown} styles
 * @returns {string}
 */
export function props(...styles) {
  const merged = new Map();
  const visit = (s) => {
    if (!s) return;
    if (Array.isArray(s)) {
      for (const x of s) visit(x);
      return;
    }
    if (s[STYLE] !== true) throw new TypeError('purser: css.props only accepts styles returned by css.create');
    for (const key of Object.keys(s)) {
      // Drop earlier logical/physical twins (margin-top vs margin-block-start).
      const space = key.lastIndexOf(' ');
      const pe = space === -1 ? '' : key.slice(0, space);
      for (const other of conflictsOf(key.slice(space + 1))) merged.delete(mergeKey(pe, other));
      merged.delete(key);
      merged.set(key, s[key]);
    }
  };
  for (const s of styles) visit(s);
  let out = '';
  for (const cls of merged.values()) if (cls) out = out ? `${out} ${cls}` : cls;
  return out;
}
