// The runtime: css.create / css.props / css.keyframes / css.globals.
// It computes class names with the same code the build uses, and never emits CSS.

import { resolveNaming } from './hash.js';
import { atomClassName, keyframesName, normalizeKeyframes, normalizeStyle } from './normalize.js';
import { props, STYLE } from './props.js';

export { STYLE };

/**
 * @param {(entry: import('./normalize.js').Entry, naming: object) => string} classNames  the class names of one atomic entry
 * @param {(style: unknown, name: string) => Map<string, import('./normalize.js').Entry>} [normalize]  a build passes one
 *   that remembers its results; the default normalises every time
 */
export function makeCreateCss(classNames, normalize = (style, name) => normalizeStyle(style, [name])) {
  return (options) => build(resolveNaming(options), classNames, normalize);
}

/**
 * Create a `css` API with its own naming options. The build must be given the
 * same options (`prefix`, `salt`, `names`) so class names agree.
 *
 * This entry keeps the browser bundle small: it computes one class per property. Rule granularity needs the code that
 * compiles conditions, which is in `@avonao/purser/rule` (and costs nothing in a compiled module).
 * @param {{ prefix?: string, salt?: string, names?: 'short' | 'legacy' | 'min', granularity?: 'property' | 'rule', rename?: (id: string) => string }} [options]
 *   rename: with names 'min', the build's name for a class (set by the compiler, never by an application)
 */
export const createCss = makeCreateCss((entry, naming) => {
  if (naming.granularity === 'rule') {
    throw new TypeError(
      'purser: granularity "rule" is computed by the compiler (@avonao/purser/vite, /webpack or /esbuild) or by the runtime in @avonao/purser/rule; import css or createCss from there',
    );
  }
  return atomClassName(entry, naming);
});

function build(naming, classNames, normalize) {
  /**
   * Compile a map of named styles into class-name maps.
   * @param {Record<string, Record<string, unknown>>} styles
   */
  function create(styles) {
    if (!styles || typeof styles !== 'object') throw new TypeError('purser: css.create expects an object of styles');
    const out = {};
    for (const name of Object.keys(styles)) {
      const compiled = {};
      for (const entry of normalize(styles[name], name).values()) {
        compiled[entry.key] = entry.tree === null ? null : classNames(entry, naming);
      }
      Object.defineProperty(compiled, STYLE, { value: true });
      out[name] = Object.freeze(compiled);
    }
    return Object.freeze(out);
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
