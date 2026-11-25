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
// With fusion (./fuse.js) a name can stand for several classes that are always applied together. The registry then
// also holds the plan: for every group of classes the build has seen, the names it is written as.
//
// Build-only module.

import fs from 'node:fs';
import path from 'node:path';
import { cacheDirectory, hashText } from './build/cache.js';
import { contextKey } from './fuse.js';

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
  /** @type {null | { level: string, covers: Map<string, string[]> }} */
  let plan = null;
  const get = (id) => names.get(id) ?? give(id);
  return {
    prefix,
    /** The name of a class, giving it the next free one when it has none. */
    get,
    /**
     * The names a group of classes that is applied whole is written as. Without a plan every class has its own name;
     * with one, the group must be one the build has seen (it decided which classes share a name).
     * @param {string[]} ids
     * @returns {string[]}
     */
    resolve(ids) {
      if (!plan) return ids.map(get);
      if (ids.length === 0) return [];
      const cover = plan.covers.get(contextKey(ids));
      if (!cover) throw new PlanError();
      return cover;
    },
    /** The fusion plan of the last build (null: every class has its own name). */
    get plan() {
      return plan;
    },
    /** @param {null | { level: string, covers: Map<string, string[]> }} next */
    setPlan(next) {
      if (plan === null && next === null) return;
      plan = next;
      version++;
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

/** A group of classes the fusion plan does not have: the module was not part of the build, or changed after it. */
export class PlanError extends Error {
  constructor() {
    super(
      'purser: this module applies a group of classes the stylesheet build has not seen, and with fuse the build decides which classes share a name. Build the stylesheet from the same sources first (the module must be in src, unchanged since)',
    );
    this.name = 'PlanError';
  }
}

/**
 * Where the plan that belongs to a names file is kept for a compiler in another process (a webpack or Turbopack
 * loader). It is derived data, rewritten by every build, so it lives in the project's cache directory and not in the
 * names file, which a project may commit.
 * @param {string} namesFile absolute path
 * @param {string} projectDir
 */
export function planFileFor(namesFile, projectDir) {
  return path.join(cacheDirectory(projectDir), `plan-${hashText(namesFile).slice(0, 10)}.json`);
}

/**
 * Write the plan that belongs to a names file: which names every group of classes is written as, or that the build did
 * not fuse. The file is complete in itself (a compiler that reads it needs nothing from the names file) and replaced
 * in one step, so a compiler in another process never reads half of it.
 * @param {string} namesFile
 * @param {string} projectDir
 * @param {null | { level: string, covers: Map<string, string[]> }} plan
 */
export function writePlan(namesFile, projectDir, plan) {
  const file = planFileFor(namesFile, projectDir);
  const data = plan
    ? { v: 1, level: plan.level, covers: Object.fromEntries([...plan.covers].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k, v.join(' ')])) }
    : { v: 1, level: null };
  const text = `${JSON.stringify(data)}\n`;
  let saved = null;
  try {
    saved = fs.readFileSync(file, 'utf8');
  } catch {
    // not written yet
  }
  if (saved === text) return;
  if (!plan && saved === null) return; // nothing to clear
  writeAtomic(file, text);
}

/**
 * Read the plan that belongs to a names file.
 * @param {string} namesFile
 * @param {string} projectDir
 * @returns {null | { level: string, covers: Map<string, string[]> }} null: the build did not fuse
 */
export function readPlan(namesFile, projectDir) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(planFileFor(namesFile, projectDir), 'utf8'));
  } catch {
    return null;
  }
  if (!data || data.v !== 1 || !data.level) return null;
  return { level: data.level, covers: new Map(Object.entries(data.covers).map(([k, v]) => [k, v.split(' ')])) };
}

/** Replace a file in one step (write beside it, then rename), so no reader ever sees part of it. */
export function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
