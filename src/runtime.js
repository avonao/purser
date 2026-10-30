// The runtime: css.create / css.props / css.keyframes / css.globals.
// It computes class names with the same code the build uses, and never emits CSS.

import { conflictsOf } from './conflicts.js';
import { resolveNaming } from './hash.js';
import { atomClassName, keyframesName, mergeKey, normalizeKeyframes, normalizeStyle } from './normalize.js';

/** Marks objects produced by css.create so css.props can reject anything else. */
export const STYLE = Symbol.for('purser.style');

/**
 * Create a `css` API with its own naming options. The build must be given the
 * same options (`prefix`, `salt`) so class names agree.
 * @param {{ prefix?: string, salt?: string }} [options]
 */
export function createCss(options) {
  const naming = resolveNaming(options);

  /**
   * Compile a map of named styles into class-name maps.
   * @param {Record<string, Record<string, unknown>>} styles
   */
  function create(styles) {
    if (!styles || typeof styles !== 'object') throw new TypeError('purser: css.create expects an object of styles');
    const out = {};
    for (const name of Object.keys(styles)) {
      const compiled = {};
      for (const entry of normalizeStyle(styles[name], [name]).values()) {
        compiled[entry.key] = entry.tree === null ? null : atomClassName(entry, naming);
      }
      Object.defineProperty(compiled, STYLE, { value: true });
      out[name] = Object.freeze(compiled);
    }
    return Object.freeze(out);
  }

  /**
   * Merge compiled styles left to right (later wins per property) and return
   * the class string. Falsy arguments are ignored; arrays are flattened.
   * @param {...unknown} styles
   * @returns {string}
   */
  function props(...styles) {
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

  /**
   * Declare keyframes; returns the generated animation name.
   * @param {Record<string, Record<string, unknown>>} frames
   * @returns {string}
   */
  function keyframes(frames) {
    return keyframesName(normalizeKeyframes(frames), naming);
  }

  /**
   * Declare global rules (:root, html, body, resets, @font-face, …).
   * Compiled by the build; a no-op at runtime.
   * @param {Record<string, unknown>} _rules
   * @param {{ layer?: 'globals' | 'overrides' }} [_options]
   */
  function globals(_rules, _options) {}

  return Object.freeze({ create, props, keyframes, globals });
}

/** The default `css` API (class prefix `x`, no salt). */
export const css = createCss();
