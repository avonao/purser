// Minimal class names (names: 'min'): the shortest names there are, the most used class first.
//
// A hashed name is the same in every build and needs no shared state, but it is random text: four characters cost
// about three bytes wherever they appear, compressed or not. A build that sees the whole project can do better and
// hand out `_a`, `_b`, … in order of use. The catch is that only the build knows these names, so they need the
// compiler (the bundler plugins): the browser runtime cannot compute them.
//
// The registry is append-only: a name, once given, stays with its class for the life of the registry (and across
// builds when it is saved to a file), so adding a style never renames the others.
//
// Build-only module.

const FIRST = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const REST = `${FIRST}0123456789_-`;

/**
 * The n-th name (0-based): with a prefix every character may be any of 64; without one the first must be a letter.
 * @param {number} n
 * @param {string} prefix
 */
export function sequenceName(n, prefix) {
  if (prefix) {
    let length = 1;
    let block = 64;
    let i = n;
    while (i >= block) {
      i -= block;
      length++;
      block *= 64;
    }
    let out = '';
    for (let k = 0; k < length; k++) {
      out = REST[i % 64] + out;
      i = Math.floor(i / 64);
    }
    return prefix + out;
  }
  let length = 1;
  let block = 52;
  let i = n;
  while (i >= block) {
    i -= block;
    length++;
    block *= 64;
  }
  let out = '';
  for (let k = 0; k < length - 1; k++) {
    out = REST[i % 64] + out;
    i = Math.floor(i / 64);
  }
  return FIRST[i] + out;
}

/**
 * @param {{ prefix?: string, names?: Record<string, string> }} [options]
 *   prefix: written before every name (default "_", so a name can never be a word someone else's CSS uses);
 *   names: a saved registry to continue from
 */
export function createNameRegistry(options = {}) {
  const prefix = options.prefix ?? '_';
  if (prefix !== '' && !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(prefix)) throw new TypeError(`purser: names prefix "${prefix}" must be empty or a CSS identifier`);
  /** @type {Map<string, string>} class identity -> name */
  const names = new Map(Object.entries(options.names ?? {}));
  const taken = new Set(names.values());
  let next = 0;
  let version = 0;
  const give = (id) => {
    let name;
    do name = sequenceName(next++, prefix);
    while (taken.has(name));
    taken.add(name);
    names.set(id, name);
    version++;
    return name;
  };
  return {
    prefix,
    /** The name of a class, giving it the next free one when it has none. */
    get(id) {
      return names.get(id) ?? give(id);
    },
    has: (id) => names.has(id),
    /**
     * Name every class that has no name yet, the most used first (ties in identity order, so one source tree always
     * gives the same names).
     * @param {Map<string, number>} uses class identity -> how many styles use it
     */
    assign(uses) {
      const fresh = [...uses.keys()].filter((id) => !names.has(id));
      fresh.sort((a, b) => uses.get(b) - uses.get(a) || (a < b ? -1 : a > b ? 1 : 0));
      for (const id of fresh) give(id);
    },
    /** Changes whenever a name is given: a consumer compares it to know its copy is stale. */
    get version() {
      return version;
    },
    get size() {
      return names.size;
    },
    toJSON: () => Object.fromEntries([...names].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
  };
}
