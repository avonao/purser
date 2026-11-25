// Fusion: fewer classes on every element.
//
// A compiled css.props call is, under every assignment of its guards, a fixed set of rule classes, and the classes
// that appear under the same assignments form a group that is always applied whole. The build sees every such group
// of a project (and every property of a style that is still merged at run time, which is a group too). That is enough
// to ask a question no runtime can answer: which classes are never seen without each other?
//
//   exact     Classes that appear in exactly the same groups become one class. Nothing is written twice: the
//             stylesheet keeps every rule once, under fewer names, and every element carries fewer classes.
//   balanced  After that, two classes that often appear together get a class of their own where they do. Its rules
//             are written under one more name (a longer selector list), each element that has both carries one class
//             less. A pair is merged while that removes more class references than it adds selectors.
//   max       Every group is one class.
//
// A group is always covered by classes that share no rule, so an element never matches two rules for one property:
// what applies is exactly what applied before, under other names.
//
// Build-only module.

import crypto from 'node:crypto';

/**
 * balanced: how many class references a merge must remove for every selector it adds to the stylesheet. A selector
 * in the stylesheet and a class name in a module cost about the same bytes, and a class name is paid again in every
 * page that renders the element; two for one keeps the stylesheet close to the exact one (measured on the benchmark
 * corpus of 500 components: 8% more stylesheet, 5% fewer bytes of class names in the modules and in the markup).
 */
const BALANCED_RATIO = 2;

export const FUSE_LEVELS = Object.freeze(['exact', 'balanced', 'max']);

/**
 * Validate a `fuse` option.
 * @param {unknown} value
 * @returns {false | 'exact' | 'balanced' | 'max'}
 */
export function resolveFuse(value) {
  if (value === undefined || value === null || value === false || value === 'none') return false;
  if (value === true) return 'exact';
  if (FUSE_LEVELS.includes(value)) return /** @type {any} */ (value);
  throw new TypeError(`purser: fuse must be "exact", "balanced" or "max", not ${JSON.stringify(value)}`);
}

const digest = (text) => crypto.createHash('sha1').update(text).digest('base64url').slice(0, 16);

/**
 * The identity of a set of classes, whatever order they are given in. One class is its own identity.
 * @param {string[]} ids
 */
export function contextKey(ids) {
  if (ids.length === 1) return ids[0];
  return `c${digest([...ids].sort().join(' '))}`;
}

/** The identity of a fused class (what the name registry names): one class is itself, a set is named after its members. */
function classIdentity(sortedIds) {
  return sortedIds.length === 1 ? sortedIds[0] : `f${digest(sortedIds.join(' '))}`;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param {Iterable<{ ids: string[], weight?: number }>} input  every group of classes that is applied whole; weight: how
 *   many places apply it
 * @param {{ level: 'exact' | 'balanced' | 'max', ratio?: number }} options
 * @returns {{ classes: Map<string, string[]>, covers: Map<string, string[]>, uses: Map<string, number>, stats: { contexts: number, ids: number, classes: number, references: number, selectors: number } }}
 *   classes: identity -> the class ids it stands for; covers: context key -> identities of the classes that make it
 *   up; uses: identity -> how many places carry it
 */
export function planFusion(input, options) {
  // Contexts, once each, in a fixed order (the plan must not depend on the order files were read in).
  const byKey = new Map();
  for (const c of input) {
    if (!c.ids.length) continue;
    const ids = [...new Set(c.ids)].sort();
    const key = contextKey(ids);
    const known = byKey.get(key);
    if (known) {
      if (known.ids.length !== ids.length || known.ids.some((id, i) => id !== ids[i])) throw new Error(`purser: internal error: two sets of classes share the key ${key}`);
      known.weight += c.weight ?? 1;
    } else byKey.set(key, { key, ids, weight: c.weight ?? 1 });
  }
  const contexts = [...byKey.values()].sort((a, b) => cmp(a.key, b.key));

  /** @type {{ ids: string[], contexts: Set<number> }[]} */
  const tokens = [];
  /** @type {Set<number>[]} */
  const cover = contexts.map(() => new Set());

  if (options.level === 'max') {
    // One class per context. Contexts that overlap without being equal would share rules through different classes,
    // which is fine: no element carries two contexts that share a class id (they come from one merge).
    contexts.forEach((c, i) => {
      tokens.push({ ids: c.ids, contexts: new Set([i]) });
      cover[i].add(i);
    });
  } else {
    // Exact: classes with the same signature (the contexts they appear in) are one token.
    const where = new Map(); // id -> context indices, ascending
    contexts.forEach((c, i) => {
      for (const id of c.ids) {
        const list = where.get(id);
        if (list) list.push(i);
        else where.set(id, [i]);
      }
    });
    const bySignature = new Map();
    for (const id of [...where.keys()].sort()) {
      const signature = where.get(id).join(',');
      const known = bySignature.get(signature);
      if (known) known.ids.push(id);
      else bySignature.set(signature, { ids: [id], contexts: new Set(where.get(id)) });
    }
    for (const token of bySignature.values()) {
      const index = tokens.push(token) - 1;
      for (const i of token.contexts) cover[i].add(index);
    }
    if (options.level === 'balanced') mergePairs(tokens, cover, contexts, options.ratio ?? BALANCED_RATIO);
  }

  const classes = new Map();
  const covers = new Map();
  const uses = new Map();
  const identities = tokens.map((t) => (t.contexts.size ? classIdentity(t.ids) : null));
  let references = 0;
  let selectors = 0;
  tokens.forEach((t, i) => {
    if (!t.contexts.size) return;
    const identity = identities[i];
    const known = classes.get(identity);
    if (known) {
      // max: equal contexts were merged before, so only a hash collision ends up here
      if (known.length !== t.ids.length || known.some((id, k) => id !== t.ids[k])) throw new Error(`purser: internal error: two classes share the identity ${identity}`);
      return;
    }
    classes.set(identity, t.ids);
    selectors += t.ids.length;
  });
  contexts.forEach((c, i) => {
    const list = [...cover[i]].map((t) => identities[t]).sort();
    // The cover must be exact: every class id of the context once, and nothing else.
    const seen = new Set();
    for (const identity of list) {
      for (const id of classes.get(identity)) {
        if (seen.has(id)) throw new Error(`purser: internal error: a fused cover carries ${id} twice`);
        seen.add(id);
      }
    }
    if (seen.size !== c.ids.length || c.ids.some((id) => !seen.has(id))) throw new Error('purser: internal error: a fused cover does not match its classes');
    covers.set(c.key, list);
    references += list.length * c.weight;
    for (const identity of list) uses.set(identity, (uses.get(identity) ?? 0) + c.weight);
  });
  return { classes, covers, uses, stats: { contexts: contexts.length, ids: new Set(contexts.flatMap((c) => c.ids)).size, classes: classes.size, references, selectors } };
}

/**
 * Greedy pair merging (the idea of Re-Pair, on sets): take the two tokens whose merge pays most, give the contexts
 * that have both a token for the pair, repeat while a merge pays.
 *
 * What a merge of A and B is worth: every context with both carries one reference less (its weight counts the places
 * that apply it). What it costs: the pair's token writes the rules of A and of B under one more name, unless A (or B)
 * appears nowhere else and goes away, which makes its share free.
 */
function mergePairs(tokens, cover, contexts, ratio) {
  const BASE = 2 ** 26;
  const keyOf = (a, b) => (a < b ? a * BASE + b : b * BASE + a);
  const weight = new Map(); // pair -> summed weight of the contexts with both
  const count = new Map(); // pair -> number of contexts with both
  cover.forEach((set, i) => {
    const list = [...set];
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const k = keyOf(list[x], list[y]);
        weight.set(k, (weight.get(k) ?? 0) + contexts[i].weight);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
  });
  const gain = (k) => {
    const c = count.get(k);
    if (!c) return 0;
    const a = Math.floor(k / BASE);
    const b = k % BASE;
    const cost = (tokens[a].contexts.size > c ? tokens[a].ids.length : 0) + (tokens[b].contexts.size > c ? tokens[b].ids.length : 0);
    return weight.get(k) - ratio * cost;
  };

  // A binary max-heap of [gain, pair]; an entry whose gain is no longer the pair's is skipped (or put back).
  const heap = [];
  const before = (x, y) => x[0] > y[0] || (x[0] === y[0] && x[1] < y[1]);
  const push = (entry) => {
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i], heap[parent])) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < heap.length && before(heap[l], heap[best])) best = l;
        if (r < heap.length && before(heap[r], heap[best])) best = r;
        if (best === i) break;
        [heap[i], heap[best]] = [heap[best], heap[i]];
        i = best;
      }
    }
    return top;
  };
  const offer = (k) => {
    const g = gain(k);
    if (g > 0) push([g, k]);
  };
  for (const k of count.keys()) offer(k);
  /** Offer every pair of a token again: its cost may have dropped because the token now appears in fewer contexts. */
  const reoffer = (t) => {
    const partners = new Set();
    for (const i of tokens[t].contexts) for (const x of cover[i]) if (x !== t) partners.add(x);
    for (const x of partners) offer(keyOf(t, x));
  };

  while (heap.length) {
    const [g, k] = pop();
    const now = gain(k);
    if (now <= 0) continue; // merged already, or no longer worth it
    // A gain only rises when one of the pair's tokens loses contexts, and every pair of such a token is offered again
    // then; so an entry that is too high is stale and goes back to its real place.
    if (now < g) push([now, k]);
    else merge(k);
  }

  function merge(k) {
    const a = Math.floor(k / BASE);
    const b = k % BASE;
    const both = [...tokens[a].contexts].filter((i) => tokens[b].contexts.has(i));
    if (!both.length) return;
    const merged = tokens.push({ ids: [...tokens[a].ids, ...tokens[b].ids].sort(), contexts: new Set(both) }) - 1;
    for (const i of both) {
      const w = contexts[i].weight;
      const set = cover[i];
      set.delete(a);
      set.delete(b);
      for (const x of set) {
        for (const gone of [a, b]) {
          const old = keyOf(gone, x);
          const c = count.get(old) - 1;
          if (c) {
            count.set(old, c);
            weight.set(old, weight.get(old) - w);
          } else {
            count.delete(old);
            weight.delete(old);
          }
        }
        const fresh = keyOf(merged, x);
        weight.set(fresh, (weight.get(fresh) ?? 0) + w);
        count.set(fresh, (count.get(fresh) ?? 0) + 1);
      }
      set.add(merged);
      tokens[a].contexts.delete(i);
      tokens[b].contexts.delete(i);
    }
    count.delete(k);
    weight.delete(k);
    reoffer(merged);
    if (tokens[a].contexts.size) reoffer(a);
    if (tokens[b].contexts.size) reoffer(b);
  }
}
