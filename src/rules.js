// Rule granularity: one class per generated rule instead of one class per property.
//
// With property granularity a style's `color: { default: A, ':hover': B }` is one class with two rules, and another
// style with `color: { default: A, ':hover': C }` is a second class that writes `color: A` again. With rule
// granularity each rule has its own class, named after the rule itself (pseudo-element, property, condition, value),
// so both styles carry the same class for `color: A` outside hover and the stylesheet holds that rule once. The rules
// of one property are still mutually exclusive by construction: they are the same rules, under more names.
//
// Shared by the runtime and the build so both always agree.

import { compileTree, renderSelectorLiterals, renderTerm } from './conditions.js';
import { makeName } from './hash.js';
import { atomClassName } from './normalize.js';

const KIND_RANK = { sel: 0, subject: 0, class: 0, 'media-type': 1, media: 2, supports: 3, container: 4 };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A term's literals in one fixed order (a style's own order depends on which condition it names first), so the same
 * condition always renders, and hashes, the same way.
 * @param {import('./conditions.js').Literal[]} term
 */
export function canonicalTerm(term) {
  return [...term].sort(
    (a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || cmp(a.name ?? '', b.name ?? '') || cmp(a.text, b.text) || Number(a.neg) - Number(b.neg),
  );
}

/** What a rule class is named after. */
export const ruleKey = (pe, prop, atRules, suffix, value) => `${pe}|${prop}|${atRules.join('&')}|${suffix}|${value}`;

/**
 * Is there a state in which the tree leaves the property unset? True without an unconditional value or with a null
 * anywhere. Such a style also carries its property class as a marker: css.globals rules use it to apply in the gap.
 */
function hasGap(branches) {
  let covered = false;
  for (const b of branches) {
    if (b.value === null) return true;
    if (b.conj && b.conj.length === 0) covered = true;
  }
  return !covered;
}

/**
 * The rules of one entry with their class names.
 * @param {import('./normalize.js').Entry} entry  entry.tree must not be null
 * @param {{ prefix: string, salt: string, names: 'short' | 'legacy' }} naming
 * @param {typeof compileTree} [compile]  a build passes one that remembers its results
 * @returns {{ rules: { className: string, key: string, atRules: string[], suffix: string, value: string }[], marker: string | null, compiled: ReturnType<typeof compileTree> | null }}
 */
export function entryRules(entry, naming, compile = compileTree) {
  const { pe, prop, tree } = entry;
  if (typeof tree === 'string') {
    // An unconditional value is one rule with no condition: no need for the condition compiler.
    const key = ruleKey(pe, prop, [], '', tree);
    return { rules: [{ className: makeName(key, naming), key, atRules: [], suffix: '', value: tree }], marker: null, compiled: null };
  }
  const compiled = compile(tree, entry.path);
  const rules = compiled.rules.map(({ term, value }) => {
    const { selector, atRules } = renderTerm(canonicalTerm(term));
    const suffix = renderSelectorLiterals(selector);
    const key = ruleKey(pe, prop, atRules, suffix, value);
    return { className: makeName(key, naming), key, atRules, suffix, value };
  });
  return { rules, marker: hasGap(compiled.branches) ? atomClassName(entry, naming) : null, compiled };
}

/**
 * The class names of an atomic entry, space-separated: one name with property granularity, one per rule (and the
 * marker of a style with a gap) with rule granularity.
 * @param {import('./normalize.js').Entry} entry  entry.tree must not be null
 * @param {{ prefix: string, salt: string, names: 'short' | 'legacy', granularity?: 'property' | 'rule' }} naming
 * @returns {string}
 */
export function atomClassNames(entry, naming) {
  if (naming.granularity !== 'rule') return atomClassName(entry, naming);
  const { rules, marker } = entryRules(entry, naming);
  let out = '';
  for (const r of rules) out = out ? `${out} ${r.className}` : r.className;
  if (marker) out = out ? `${out} ${marker}` : marker;
  return out;
}
