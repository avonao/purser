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
// (Next.js: `env: { PURSER_SALT }` in next.config). A missing `process` or value falls back to no salt and short names.
const ENV_SALT = typeof process !== 'undefined' && process.env && typeof process.env.PURSER_SALT === 'string' ? process.env.PURSER_SALT : undefined;
const ENV_NAMES = typeof process !== 'undefined' && process.env && typeof process.env.PURSER_NAMES === 'string' ? process.env.PURSER_NAMES : undefined;

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
 * Build a name: short mode (default) is 4 characters; legacy mode is `prefix` + 7 base-36 characters.
 * @param {string} input canonical description of what is being named
 * @param {{ prefix: string, salt: string, names: 'short' | 'legacy' }} naming
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
  return naming.prefix + n.toString(36).padStart(LENGTH, '0');
}

/**
 * Validate and complete naming options.
 * @param {{ prefix?: string, salt?: string, names?: 'short' | 'legacy' }} [opts]
 * @returns {{ prefix: string, salt: string, names: 'short' | 'legacy' }}
 */
export function resolveNaming(opts = {}) {
  const names = opts.names ?? ENV_NAMES ?? 'short';
  if (names !== 'short' && names !== 'legacy') throw new TypeError(`purser: names must be "short" or "legacy", not "${names}"`);
  const prefix = opts.prefix ?? 'x';
  const salt = opts.salt ?? ENV_SALT ?? '';
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(prefix) || /^-?\d/.test(prefix)) {
    throw new TypeError(`purser: prefix "${prefix}" must be a CSS identifier starting with a letter or underscore`);
  }
  if (typeof salt !== 'string') throw new TypeError('purser: salt must be a string');
  return { prefix, salt, names };
}
