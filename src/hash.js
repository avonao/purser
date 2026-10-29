// Deterministic short hashes for class and keyframes names.
// Shared by the runtime and the build so both always agree.

const LENGTH = 7;
const SPACE = 36 ** LENGTH; // ~2^36.2 distinct names

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
 * Build a name: `prefix` + 7 base-36 characters.
 * @param {string} input canonical description of what is being named
 * @param {{ prefix: string, salt: string }} naming
 * @returns {string}
 */
export function makeName(input, naming) {
  const n = hash53(naming.salt + '\u0000' + input) % SPACE;
  return naming.prefix + n.toString(36).padStart(LENGTH, '0');
}

/**
 * Validate and complete naming options.
 * @param {{ prefix?: string, salt?: string }} [opts]
 * @returns {{ prefix: string, salt: string }}
 */
export function resolveNaming(opts = {}) {
  const prefix = opts.prefix ?? 'x';
  const salt = opts.salt ?? '';
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(prefix) || /^-?\d/.test(prefix)) {
    throw new TypeError(`purser: prefix "${prefix}" must be a CSS identifier starting with a letter or underscore`);
  }
  if (typeof salt !== 'string') throw new TypeError('purser: salt must be a string');
  return { prefix, salt };
}
