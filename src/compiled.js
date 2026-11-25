// What a compiled module imports instead of `css`: the compiler (@avonao/purser/compiler and the bundler plugins) has
// already turned css.create into class names and every css.props call it could decide into a string. Only a css.props
// call whose arguments are known at run time alone (a style passed in as a prop, a style picked by a computed key)
// still merges, with the same function the full runtime uses.

import { props, STYLE } from './props.js';

export { props };

/**
 * Mark precompiled class maps as styles, the way css.create does.
 * @template {Record<string, Record<string, string | null>>} T
 * @param {T} maps style name -> merge key -> class names
 * @returns {Readonly<T>}
 */
export function styles(maps) {
  for (const name of Object.keys(maps)) Object.freeze(Object.defineProperty(maps[name], STYLE, { value: true }));
  return Object.freeze(maps);
}
