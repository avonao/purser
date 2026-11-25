// What a build computes more than once, computed once: the stylesheet compiler and the module compiler both normalise
// every style and both compile every conditional value into rules. Build-only module (a page's runtime never repeats
// the work, so it carries no cache).

import { compileTree } from '../conditions.js';
import { atomClassName, canonical, normalizeStyle } from '../normalize.js';
import { entryRules } from '../rules.js';

/** @type {WeakMap<object, Map<string, ReturnType<typeof normalizeStyle>>>} */
const normalized = new WeakMap();

/**
 * normalizeStyle for one named style of a css.create call, remembered by the style object itself.
 * @param {unknown} style
 * @param {string} name the style's name in its css.create call (the path errors are reported under)
 */
export function normalizeNamedStyle(style, name) {
  if (style === null || typeof style !== 'object') return normalizeStyle(style, [name]);
  let byName = normalized.get(style);
  if (!byName) normalized.set(style, (byName = new Map()));
  let entries = byName.get(name);
  if (!entries) byName.set(name, (entries = normalizeStyle(style, [name])));
  return entries;
}

/** @type {Map<string, ReturnType<typeof compileTree>>} */
const shapes = new Map();
const MARK = '\u0001';

/**
 * compileTree, compiled once per shape. What the rules of a conditional value are depends on its conditions, on which
 * of its values are equal and on which are null, never on what the values say: `color: { default: A, ':hover': B }`
 * compiles the same way for every A and B. So a tree is compiled with numbered placeholders for its values, the result
 * is kept under the tree's shape, and each tree of that shape only puts its values in.
 * @param {any} tree a normalised conditional value
 * @param {(string|number)[]} [path]
 * @returns {ReturnType<typeof compileTree>}
 */
export function compileTreeOnce(tree, path = []) {
  const values = [];
  const index = new Map();
  const sketch = (node) => {
    if (node === null) return 'null';
    if (typeof node === 'string') {
      let i = index.get(node);
      if (i === undefined) {
        i = values.push(node) - 1;
        index.set(node, i);
      }
      return String(i);
    }
    let out = '{';
    for (const key of Object.keys(node)) out += `${JSON.stringify(key)}:${sketch(node[key])},`;
    return `${out}}`;
  };
  const shape = sketch(tree);
  let compiled = shapes.get(shape);
  if (!compiled) {
    const stand = (node) => {
      if (node === null) return null;
      if (typeof node === 'string') return MARK + index.get(node);
      const out = {};
      for (const key of Object.keys(node)) out[key] = stand(node[key]);
      return out;
    };
    try {
      compiled = compileTree(stand(tree), []);
    } catch {
      return compileTree(tree, path); // a condition that does not parse: report it where it is written
    }
    shapes.set(shape, compiled);
  }
  const real = (value) => (value === null ? null : values[Number(value.slice(1))]);
  return {
    branches: compiled.branches.map((b) => ({ conj: b.conj, value: real(b.value), path: [...path, ...b.path] })),
    rules: compiled.rules.map((r) => ({ term: r.term, value: real(r.value) })),
    order: compiled.order,
  };
}

const entryKey = (entry) => `${entry.pe}|${entry.prop}|${typeof entry.tree === 'string' ? `"${entry.tree}` : canonical(entry.tree)}`;

/** @type {Map<string, Map<string, ReturnType<typeof entryRules>>>} naming -> entry -> rules */
const compiled = new Map();

/**
 * entryRules, remembered by what the entry is (pseudo-element, property, value tree) under one naming.
 * @param {import('../normalize.js').Entry} entry
 * @param {{ prefix: string, salt: string, names: string, rename?: unknown }} naming
 */
export function cachedEntryRules(entry, naming) {
  if (naming.rename) return entryRules(entry, naming, compileTreeOnce); // names that change with every build are never remembered
  const scope = `${naming.prefix}\u0000${naming.salt}\u0000${naming.names}`;
  let byEntry = compiled.get(scope);
  if (!byEntry) compiled.set(scope, (byEntry = new Map()));
  const key = entryKey(entry);
  let rules = byEntry.get(key);
  if (!rules) byEntry.set(key, (rules = entryRules(entry, naming, compileTreeOnce)));
  return rules;
}

/**
 * The class names of an atomic entry (what ../rules.js atomClassNames computes), remembered.
 * @returns {(entry: import('../normalize.js').Entry, naming: object) => string}
 */
export function memoizedClassNames() {
  const memo = new Map();
  return (entry, naming) => {
    const key = entryKey(entry);
    let names = memo.get(key);
    if (names === undefined) {
      if (naming.granularity !== 'rule') names = atomClassName(entry, naming);
      else {
        const { rules, marker } = cachedEntryRules(entry, naming);
        names = '';
        for (const r of rules) names = names ? `${names} ${r.className}` : r.className;
        if (marker) names = names ? `${names} ${marker}` : marker;
      }
      memo.set(key, names);
    }
    return names;
  };
}
