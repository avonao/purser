// Compile atomic entries into disjoint rules: one class per pseudo-element + property + value tree (property
// granularity) or one class per rule (rule granularity).

import { compileTree, disjointify, mergeTerms, renderSelectorLiterals, renderTerm } from '../conditions.js';
import { PurserError } from '../errors.js';
import { entryRules } from '../rules.js';
import { findOverlap } from '../verify.js';

/**
 * @typedef {object} AtomCoverage  one value tree of a property, as css.globals needs to see it
 * @property {string | null} className  the class a global rule can name to reach this tree's gap (null: no gap)
 * @property {string[]} classNames      every class an element with this tree carries for the property
 * @property {import('../conditions.js').Literal[][]} gaps terms where the tree does NOT set the property
 * @property {ReturnType<typeof compileTree>['branches']} branches
 * @property {{ term: import('../conditions.js').Literal[], value: string, className: string }[]} rules
 */

/**
 * Selectors that every browser Purser targets parses. Rules are only merged into one selector list when all of their
 * selectors are of this kind: a list is dropped whole when a browser does not know one selector in it, so a newer
 * pseudo-class must never share a rule with anything else.
 */
const SAFE_PSEUDO = /^:(?:hover|focus|focus-visible|focus-within|active|visited|link|any-link|target|disabled|enabled|checked|indeterminate|default|required|optional|read-only|read-write|placeholder-shown|valid|invalid|in-range|out-of-range|first-child|last-child|only-child|first-of-type|last-of-type|only-of-type|empty|root)$/;
const SAFE_ELEMENT = /^(?:|::before|::after|::placeholder|::selection|::marker|::first-line|::first-letter|::backdrop|::file-selector-button)$/;

function safeToGroup(literals, pe) {
  if (!SAFE_ELEMENT.test(pe)) return false;
  return literals.every((l) => {
    if (l.kind !== 'sel') return false;
    if (l.text.startsWith('[')) return !/\s[is]\]$/i.test(l.text) || /\si\]$/i.test(l.text); // [a="b" s] is newer than the targets
    if (l.text.startsWith('.') || l.text.startsWith('#')) return /^[.#][\w-]+$/.test(l.text);
    return SAFE_PSEUDO.test(l.text);
  });
}

/**
 * @param {{ className: string, entry: import('../normalize.js').Entry, call?: unknown, uses?: number }[]} atoms distinct value trees
 * @param {{ prefix: string, salt: string, names: 'short' | 'legacy', granularity?: 'property' | 'rule' }} naming
 * @param {{ group?: boolean, finalize?: (uses: Map<string, number>) => (name: string) => string }} [options]
 *   group: merge rules that write the same declaration into one selector list;
 *   finalize: called once with every class and its number of uses, returns the name each class is written under
 * @returns {{ rules: import('./render.js').CssRule[], coverage: Map<string, AtomCoverage[]>, classes: number, ruleCount: number, rename: (name: string) => string }}
 *   coverage is keyed by `${pe}|${prop}`
 */
export function compileAtoms(atoms, naming, options = {}) {
  const byRule = naming.granularity === 'rule';
  const items = [];
  /** @type {Map<string, AtomCoverage[]>} */
  const coverage = new Map();
  const sorted = [...atoms].sort((a, b) => cmp(a.entry.prop, b.entry.prop) || cmp(a.entry.pe, b.entry.pe) || cmp(a.className, b.className));
  const ruleClasses = new Map(); // rule granularity: class -> what it is named after
  const markers = new Map(); // rule granularity: marker class -> atom
  const classes = new Set();
  const uses = new Map(); // class -> how many styles carry it
  const collision = (name, atom) => {
    const err = new PurserError(`class name collision on ${name}; set a different salt (css: createCss({ salt }), build: --salt)`, atom.entry.path);
    err.call = atom.call;
    return err;
  };

  for (const atom of sorted) {
    const { className, entry } = atom;
    const named = byRule ? entryRules(entry, naming) : null;
    let branches;
    let rules;
    let gaps = [];
    if (typeof entry.tree === 'string') {
      // An unconditional value (most of a stylesheet): one rule that always applies, nothing to prove, no gap.
      branches = [{ conj: [], value: entry.tree, path: entry.path }];
      rules = [{ term: [], value: entry.tree }];
    } else {
      const compiled = named?.compiled ?? compileTree(entry.tree, entry.path);
      ({ branches, rules } = compiled);
      const overlap = findOverlap(branches, rules);
      if (overlap) {
        throw new PurserError(`internal error: rules for ${entry.prop} are not exclusive (${JSON.stringify(overlap)})`, entry.path);
      }
      // Where does this tree leave the property unset? (Used to keep globals exclusive.)
      const regions = disjointify([[], ...branches.map((b) => b.conj)], compiled.order);
      gaps = [...regions[0]];
      branches.forEach((b, i) => {
        if (b.value === null) gaps.push(...regions[i + 1]);
      });
      gaps = mergeTerms(gaps);
    }
    const cover = { className, classNames: [className], gaps, branches, rules: rules.map((r) => ({ ...r, className })) };

    if (byRule) {
      // compileTree merges and orders rules the same way entryRules does, so the two lists line up.
      cover.classNames = [];
      cover.rules = [];
      named.rules.forEach((r, i) => {
        const known = ruleClasses.get(r.className);
        if (known !== undefined && known !== r.key) throw collision(r.className, atom);
        if (markers.has(r.className)) throw collision(r.className, atom);
        cover.classNames.push(r.className);
        cover.rules.push({ ...rules[i], className: r.className });
        if (known !== undefined) return;
        ruleClasses.set(r.className, r.key);
        classes.add(r.className);
        const { selector: literals } = renderTerm(rules[i].term);
        items.push({
          rule: { atRules: r.atRules, selectors: [], decls: [[entry.prop, r.value]] },
          parts: [[r.className, `${r.suffix}${entry.pe}`]],
          prop: entry.prop,
          pe: entry.pe,
          className: r.className,
          safe: safeToGroup(literals, entry.pe),
        });
      });
      if (named.marker) {
        if (ruleClasses.has(named.marker) || (markers.has(named.marker) && markers.get(named.marker) !== atom)) throw collision(named.marker, atom);
        markers.set(named.marker, atom);
        classes.add(named.marker);
        cover.classNames.push(named.marker);
        cover.className = named.marker;
      } else {
        if (cover.gaps.length) throw new PurserError(`internal error: ${entry.prop} has a gap but no marker class`, entry.path);
        cover.className = null;
      }
    } else {
      classes.add(className);
      const grouped = new Map();
      for (const { term, value } of rules) {
        const { selector, atRules } = renderTerm(term);
        const key = `${atRules.join('\n')}\n${value}`;
        if (!grouped.has(key)) grouped.set(key, { rule: { atRules, selectors: [], decls: [[entry.prop, value]] }, parts: [], safe: true });
        const g = grouped.get(key);
        g.parts.push([className, `${renderSelectorLiterals(selector)}${entry.pe}`]);
        g.safe &&= safeToGroup(selector, entry.pe);
      }
      for (const g of grouped.values()) items.push({ ...g, prop: entry.prop, pe: entry.pe, className });
    }
    for (const name of cover.classNames) uses.set(name, (uses.get(name) ?? 0) + (atom.uses ?? 1));

    const key = `${entry.pe}|${entry.prop}`;
    if (!coverage.has(key)) coverage.set(key, []);
    coverage.get(key).push(cover);
  }
  // Unconditional rules first, then each at-rule context; stable within.
  items.sort((a, b) => {
    const ka = a.rule.atRules.join('\n');
    const kb = b.rule.atRules.join('\n');
    return (ka === '' ? 0 : 1) - (kb === '' ? 0 : 1) || cmp(ka, kb) || cmp(a.prop, b.prop) || cmp(a.pe, b.pe) || cmp(a.className, b.className);
  });
  // Names are final only now: with minimal names the registry ranks every class by use before it gives a name.
  const rename = options.finalize ? options.finalize(uses) : (name) => name;
  for (const item of items) item.rule.selectors = item.parts.map(([name, rest]) => `.${rename(name)}${rest}`);
  const ruleCount = items.length;
  return { rules: options.group ? groupRules(items) : items.map((i) => i.rule), coverage, classes: classes.size, ruleCount, rename };
}

/**
 * Merge rules that write the same declaration in the same at-rule context into one rule with a selector list, at the
 * first one's place. Atom rules for one property never match the same element together, so neither their order nor
 * sharing a rule changes what applies; only selectors every target browser parses are merged (see SAFE_PSEUDO).
 */
function groupRules(items) {
  const out = [];
  const groups = new Map();
  for (const item of items) {
    if (!item.safe) {
      out.push(item.rule);
      continue;
    }
    const key = `${item.rule.atRules.join('\n')}\u0000${item.rule.decls[0][0]}\u0000${item.rule.decls[0][1]}`;
    const known = groups.get(key);
    if (known) known.selectors.push(...item.rule.selectors);
    else {
      const rule = { ...item.rule, selectors: [...item.rule.selectors] };
      groups.set(key, rule);
      out.push(rule);
    }
  }
  return out;
}

export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
