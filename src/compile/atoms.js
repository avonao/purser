// Compile atomic entries (one class per pseudo-element + property + value tree)
// into disjoint rules.

import { compileTree, disjointify, mergeTerms, renderSelectorLiterals, renderTerm } from '../conditions.js';
import { PurserError } from '../errors.js';
import { findOverlap } from '../verify.js';

/**
 * @typedef {object} AtomCoverage
 * @property {string} className
 * @property {import('../conditions.js').Literal[][]} gaps terms where this class does NOT set the property
 * @property {ReturnType<typeof compileTree>['branches']} branches
 * @property {ReturnType<typeof compileTree>['rules']} rules
 */

/**
 * @param {Map<string, import('../normalize.js').Entry>} atoms className -> entry
 * @returns {{ rules: import('./render.js').CssRule[], coverage: Map<string, AtomCoverage[]> }}
 *   coverage is keyed by `${pe}|${prop}`
 */
export function compileAtoms(atoms) {
  const items = [];
  /** @type {Map<string, AtomCoverage[]>} */
  const coverage = new Map();
  const sortedNames = [...atoms.keys()].sort((a, b) => {
    const x = atoms.get(a);
    const y = atoms.get(b);
    return cmp(x.prop, y.prop) || cmp(x.pe, y.pe) || cmp(a, b);
  });
  for (const className of sortedNames) {
    const entry = atoms.get(className);
    const { branches, rules, order } = compileTree(entry.tree, entry.path);
    const overlap = findOverlap(branches, rules);
    if (overlap) {
      throw new PurserError(`internal error: rules for ${entry.prop} are not exclusive (${JSON.stringify(overlap)})`, entry.path);
    }
    const grouped = new Map();
    for (const { term, value } of rules) {
      const { selector, atRules } = renderTerm(term);
      const sel = `.${className}${renderSelectorLiterals(selector)}${entry.pe}`;
      const key = `${atRules.join('\n')}\n${value}`;
      if (!grouped.has(key)) grouped.set(key, { atRules, selectors: [], decls: [[entry.prop, value]] });
      grouped.get(key).selectors.push(sel);
    }
    for (const r of grouped.values()) items.push({ rule: r, prop: entry.prop, pe: entry.pe, className });

    // Where does this class leave the property unset? (Used to keep globals exclusive.)
    const regions = disjointify([[], ...branches.map((b) => b.conj)], order);
    const gaps = [...regions[0]];
    branches.forEach((b, i) => {
      if (b.value === null) gaps.push(...regions[i + 1]);
    });
    const key = `${entry.pe}|${entry.prop}`;
    if (!coverage.has(key)) coverage.set(key, []);
    coverage.get(key).push({ className, gaps: mergeTerms(gaps), branches, rules });
  }
  // Unconditional rules first, then each at-rule context; stable within.
  items.sort((a, b) => {
    const ka = a.rule.atRules.join('\n');
    const kb = b.rule.atRules.join('\n');
    return (ka === '' ? 0 : 1) - (kb === '' ? 0 : 1) || cmp(ka, kb) || cmp(a.prop, b.prop) || cmp(a.pe, b.pe) || cmp(a.className, b.className);
  });
  return { rules: items.map((i) => i.rule), coverage };
}

export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
