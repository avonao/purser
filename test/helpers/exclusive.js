// Brute-force helpers for exclusivity tests.

import assert from 'node:assert/strict';
import { atomId, compileTree, parseCondition, termMatches } from '../../src/conditions.js';
import { normalizeTree } from '../../src/normalize.js';
import { findOverlap } from '../../src/verify.js';

/** Compile a raw conditional value and assert its rules are exclusive (via the shared checker). */
export function assertExclusive(raw, prop = 'color') {
  const tree = normalizeTree(raw, prop, [], { conditions: true });
  const compiled = compileTree(tree);
  assert.equal(findOverlap(compiled.branches, compiled.rules), null);
  return compiled;
}

/**
 * Independent oracle: evaluate a raw tree under the truth of each condition key
 * (`truth(key)`), with the documented semantics: `default` is the base, later
 * condition keys win. Returns the winning value, or undefined for "no value".
 */
export function evaluateRaw(tree, truth) {
  if (tree === null || typeof tree !== 'object') return tree;
  let result = Object.hasOwn(tree, 'default') ? evaluateRaw(tree.default, truth) : undefined;
  for (const key of Object.keys(tree)) {
    if (key === 'default' || !truth(key)) continue;
    const v = evaluateRaw(tree[key], truth);
    if (v !== undefined) result = v;
  }
  return result;
}

/**
 * Exhaustively compare compiled rules with the independent oracle. Every key
 * must parse to exactly one literal (possibly negated).
 */
export function assertMatchesOracle(raw) {
  const tree = normalizeTree(raw, 'color', [], { conditions: true });
  const { rules } = compileTree(tree);
  const keys = new Set();
  (function collect(t) {
    if (t && typeof t === 'object') for (const k of Object.keys(t)) {
      if (k !== 'default') keys.add(k);
      collect(t[k]);
    }
  })(tree);
  const lits = new Map([...keys].map((k) => [k, parseCondition(k)[0]]));
  const ids = [...new Set([...lits.values()].map(atomId))];
  for (let mask = 0; mask < 2 ** ids.length; mask++) {
    const asg = new Map(ids.map((id, i) => [id, Boolean(mask & (1 << i))]));
    const truth = (k) => asg.get(atomId(lits.get(k))) !== lits.get(k).neg;
    const expected = evaluateRaw(tree, truth);
    const matched = rules.filter((r) => termMatches(r.term, asg));
    if (expected === undefined || expected === null) assert.equal(matched.length, 0, `state ${mask}: expected no rule`);
    else {
      assert.equal(matched.length, 1, `state ${mask}: expected exactly one rule, got ${matched.length}`);
      assert.equal(matched[0].value, expected, `state ${mask}`);
    }
  }
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
