// Deterministic short hashes for class and keyframes names.
// Shared by the runtime and the build so both always agree.

const LENGTH = 7;
const SPACE = 36 ** LENGTH; // ~2^36.2 distinct names (legacy names)

// Short names: 4 characters, a letter then three from [A-Za-z0-9_-]. 52 * 64^3 = ~13.6 million names; a project's atoms
// (thousands) collide a handful of times at most, and the build refuses a collision, so a salt that has none is found once
// (`purser build --find-salt`) and kept (PURSER_SALT or createCss({ salt })).
const SHORT_FIRST = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHORT_REST = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
const SHORT_SPACE = SHORT_FIRST.length * SHORT_REST.length ** 3;

// The salt and the naming mode can come from the environment, so an app that imports the default `css` can set them without
// changing an import: in Node (the build, server rendering) from the process, in a bundle from a value the bundler inlines
// (Next.js: `env: { PURSER_SALT }` in next.config). A missing `process` or value falls back to no salt and the legacy names, so a project switches to short names on purpose (PURSER_NAMES=short).
const ENV_SALT = typeof process !== 'undefined' && process.env && typeof process.env.PURSER_SALT === 'string' ? process.env.PURSER_SALT : undefined;
const ENV_NAMES = typeof process !== 'undefined' && process.env && typeof process.env.PURSER_NAMES === 'string' ? process.env.PURSER_NAMES : undefined;
// Granularity: 'property' (default) gives one class per property of a style, whatever its conditions; 'rule' gives one
// class per generated rule, so two styles that share a rule (the same value under the same condition) share its class
// and the stylesheet holds every rule once (PURSER_GRANULARITY=rule).
const ENV_GRANULARITY =
  typeof process !== 'undefined' && process.env && typeof process.env.PURSER_GRANULARITY === 'string' ? process.env.PURSER_GRANULARITY : undefined;

/**
 * 53-bit string hash (cyrb53 construction by bryc, public domain).
 * @param {string} str
 * @returns {number}
 */
export function hash53(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Build a name: short mode is 4 characters; legacy mode is `prefix` + 7 base-36 characters; min mode is the name the
 * build's registry gives to the legacy name (see ./names.js).
 * @param {string} input canonical description of what is being named
 * @param {{ prefix: string, salt: string, names: 'short' | 'legacy' | 'min', rename?: (id: string) => string }} naming
 * @returns {string}
 */
export function makeName(input, naming) {
  if (naming.names === 'short') {
    let n = hash53(naming.salt + '\u0000' + input) % SHORT_SPACE;
    let rest = '';
    for (let i = 0; i < 3; i++) {
      rest = SHORT_REST[n % 64] + rest;
      n = Math.floor(n / 64);
    }
    return SHORT_FIRST[n] + rest;
  }
  const n = hash53(naming.salt + '\u0000' + input) % SPACE;
  const id = naming.prefix + n.toString(36).padStart(LENGTH, '0');
  if (naming.names !== 'min') return id;
  if (!naming.rename) {
    throw new TypeError(
      'purser: names "min" are given by the build, so this module must be compiled (@avonao/purser/vite, /webpack-loader or /esbuild); the runtime cannot compute them',
    );
  }
  return naming.rename(id);
}

/** A name that is never renamed (keyframes: their name is part of the values that use it). */
export function makeStableName(input, naming) {
  return makeName(input, naming.names === 'min' ? { ...naming, names: 'legacy' } : naming);
}

/**
 * Validate and complete naming options.
 * @param {{ prefix?: string, salt?: string, names?: 'short' | 'legacy' | 'min', granularity?: 'property' | 'rule', rename?: (id: string) => string }} [opts]
 * @returns {{ prefix: string, salt: string, names: 'short' | 'legacy' | 'min', granularity: 'property' | 'rule', rename?: (id: string) => string }}
 */
export function resolveNaming(opts = {}) {
  const names = opts.names ?? ENV_NAMES ?? 'legacy';
  if (names !== 'short' && names !== 'legacy' && names !== 'min') throw new TypeError(`purser: names must be "short", "legacy" or "min", not "${names}"`);
  const granularity = opts.granularity ?? ENV_GRANULARITY ?? 'property';
  if (granularity !== 'property' && granularity !== 'rule') {
    throw new TypeError(`purser: granularity must be "property" or "rule", not "${granularity}"`);
  }
  // With minimal names the prefix belongs to those names ("_" unless set; "" is allowed); what they are given to is
  // always the x-prefixed legacy name, so the runtime, the build and the compiler agree on it whatever the prefix.
  const minPrefix = names === 'min' ? (opts.prefix ?? '_') : undefined;
  const prefix = names === 'min' ? 'x' : (opts.prefix ?? 'x');
  const salt = opts.salt ?? ENV_SALT ?? '';
  const checked = minPrefix ?? prefix;
  if (checked !== '' || names !== 'min') {
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(checked) || /^-?\d/.test(checked)) {
      throw new TypeError(`purser: prefix "${checked}" must be a CSS identifier starting with a letter or underscore`);
    }
  }
  if (typeof salt !== 'string') throw new TypeError('purser: salt must be a string');
  const naming = { prefix, salt, names, granularity };
  if (minPrefix !== undefined) naming.minPrefix = minPrefix;
  if (opts.rename) naming.rename = opts.rename;
  return naming;
}
