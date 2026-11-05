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

  // Same enumeration as before, made cheap: literals on fixed atoms are decided once (a term with a false literal can
  // never match, a true literal drops out), and only the atoms that survive in some term are enumerated, as bits of an
  // integer instead of a copied Map per state. The answer (and the first counterexample) is unchanged.
  const bit = new Map();
  const compile = (term) => {
    const lits = [];
    for (const l of term) {
      const id = atomId(l);
      if (fixed.has(id)) {
        if (Boolean(fixed.get(id)) === l.neg) return null; // false under the fixed values: the term never matches
        continue;
      }
      if (!bit.has(id)) bit.set(id, bit.size);
      lits.push([bit.get(id), l.neg]);
    }
    return lits;
  };
  const liveBranches = [];
  for (const b of branches) {
    if (!b.conj) continue;
    const lits = compile(b.conj);
    if (lits) liveBranches.push({ lits, value: b.value });
  }
  const liveRules = [];
  for (const r of rules) {
    const lits = compile(r.term);
    if (lits) liveRules.push({ lits, value: r.value });
  }
  const live = [...bit.keys()]; // enumerated atoms, by bit index
  const matches = (lits, mask) => lits.every(([b, neg]) => Boolean(mask & (1 << b)) !== neg);
  for (let mask = 0; mask < 2 ** live.length; mask++) {
    let expected = null;
    for (const b of liveBranches) if (matches(b.lits, mask)) expected = b.value;
    const matched = liveRules.filter((r) => matches(r.lits, mask)).map((r) => r.value);
    const ok = expected === null ? matched.length === 0 : matched.length === 1 && matched[0] === expected;
    if (!ok) {
      const asg = new Map(fixed);
      for (const id of ids) asg.set(id, false);
      live.forEach((id, i) => asg.set(id, Boolean(mask & (1 << i))));
      return { assignment: Object.fromEntries([...asg].map(([k, v]) => [k.replace(/\u0001/g, ' ').trim(), v])), expected, matched };
    }
  }
  return null;
}
