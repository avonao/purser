// Brute-force proof that compiled rules are mutually exclusive. Used by the
// build as a self-check on every compiled property, and by the test suite.

import { atomId, termMatches } from './conditions.js';

/** Largest number of free atoms the brute force enumerates (2^n states). */
export const MAX_ATOMS = 14;

/**
 * Enumerate every assignment of the atoms used by `branches` and `rules` and
 * check that exactly the authoring-order winner matches (or nothing, when no
 * branch applies or the winner is null).
 * @param {{ conj: import('./conditions.js').Literal[] | null, value: string | null }[]} branches
 * @param {{ term: import('./conditions.js').Literal[], value: string }[]} rules
 * @param {{ fixed?: Map<string, boolean> }} [opts] atoms with a fixed truth value (not enumerated)
 * @returns {null | { assignment: Record<string, boolean>, expected: string | null, matched: string[] }}
 *   null when exclusive (or too many atoms to enumerate); otherwise a counterexample
 */
export function findOverlap(branches, rules, opts = {}) {
  const fixed = opts.fixed ?? new Map();
  const atoms = new Set();
  for (const b of branches) for (const l of b.conj ?? []) atoms.add(atomId(l));
  for (const r of rules) for (const l of r.term) atoms.add(atomId(l));
  const ids = [...atoms].filter((id) => !fixed.has(id));
  if (ids.length > MAX_ATOMS) return null;
  for (let mask = 0; mask < 2 ** ids.length; mask++) {
    const asg = new Map(fixed);
    ids.forEach((id, i) => asg.set(id, Boolean(mask & (1 << i))));
    let expected = null;
    for (const b of branches) if (b.conj && termMatches(b.conj, asg)) expected = b.value;
    const matched = rules.filter((r) => termMatches(r.term, asg)).map((r) => r.value);
    const ok = expected === null ? matched.length === 0 : matched.length === 1 && matched[0] === expected;
    if (!ok) {
      return { assignment: Object.fromEntries([...asg].map(([k, v]) => [k.replace(/\u0001/g, ' ').trim(), v])), expected, matched };
    }
  }
  return null;
}
