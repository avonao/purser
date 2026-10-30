// Compile css.globals() rules. Globals obey the same exclusivity as atoms:
// for each property, global rules are disjointified in authoring order, and
// every global rule excludes elements carrying an atom class for the same
// property (except where that class leaves the property unset).

import { and, atomOrder, disjointify, flatten, mergeTerms, renderTerm } from '../conditions.js';
import { conflictsOf } from '../conflicts.js';
import { PurserError } from '../errors.js';
import { normalizeStyle } from '../normalize.js';
import { cssPropertyName } from '../properties.js';
import { findOverlap } from '../verify.js';

const PE_RE = /(::[a-zA-Z-]+(?:\([^)]*\))?(?::[a-zA-Z-]+(?:\([^)]*\))?)*|:(?:before|after|first-line|first-letter))$/;

/** Split a selector list on top-level commas. */
function splitList(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim());
}

/**
 * Split a complex selector into the subject part and a trailing pseudo-element.
 * @param {string} sel
 * @param {(string|number)[]} path
 */
export function parseGlobalSelector(sel, path) {
  const s = sel.trim().replace(/\s+/g, ' ');
  if (!s) throw new PurserError('empty selector in css.globals', path);
  if (/[{};]/.test(s) || /!\s*important/i.test(s)) throw new PurserError(`invalid selector "${s}"`, path);
  let subject = s;
  let pe = '';
  const m = PE_RE.exec(s);
  if (m) {
    pe = m[1].startsWith('::') ? m[1] : `:${m[1]}`;
    const head = s.slice(0, m.index);
    // `.site ::placeholder` is the placeholder of any element inside .site: the space is a descendant combinator.
    subject = head.trim() && head.endsWith(' ') ? `${head.trim()} *` : head.trim();
  }
  if (!subject || /[>+~]$/.test(subject)) subject = `${subject}*`;
  if (subject.includes('::')) throw new PurserError(`the pseudo-element must come last in "${s}"`, path);
  return { subject, pe };
}

const subjectLit = (subject) => ({ kind: 'subject', text: subject, neg: false });
const classLit = (className, neg) => ({ kind: 'class', text: className, neg });

/**
 * @param {{ def: Record<string, unknown>, origin: unknown }[]} calls in authoring order
 * @param {Map<string, import('./atoms.js').AtomCoverage[]>} coverage
 * @returns {{ rules: import('./render.js').CssRule[], fontFaces: [string, string][][], items: object[] }}
 */
export function compileGlobals(calls, coverage) {
  const items = [];
  const fontFaces = [];
  calls.forEach((call, callIndex) => {
    for (const key of Object.keys(call.def ?? {})) {
      const value = call.def[key];
      const path = [key];
      const where = { call, callIndex };
      if (key === '@font-face') {
        for (const [i, face] of [value].flat().entries()) fontFaces.push({ decls: descriptors(face, [key, i]), where, path: [key, i] });
        continue;
      }
      if (key.startsWith('@')) {
        throw withCall(new PurserError(`unsupported global at-rule "${key}" (supported: @font-face; use css.keyframes for @keyframes)`, path), call);
      }
      for (const part of splitList(key)) {
        let parsed;
        try {
          parsed = parseGlobalSelector(part, path);
          for (const e of normalizeStyle(value, path, { pseudoElements: !parsed.pe }).values()) {
            items.push({ subject: parsed.subject, pe: parsed.pe || e.pe, prop: e.prop, tree: e.tree, path: e.path, call, layer: call.layer ?? 'globals' });
          }
        } catch (err) {
          throw withCall(err, call);
        }
      }
    }
  });

  const buckets = new Map();
  for (const it of items) {
    const k = `${it.pe}|${it.prop}`;
    if (!buckets.has(k)) buckets.set(k, { pe: it.pe, prop: it.prop });
  }

  const emitted = []; // { item, rule }
  for (const [key, { pe, prop }] of buckets) {
    // Items for this property and for logical/physical twins of it: a rule
    // for `prop` must also give way to a later twin on the same element.
    const related = new Set([prop, ...conflictsOf(prop)]);
    const list = items.filter((it) => it.pe === pe && related.has(it.prop));
    const branches = [];
    for (const it of list) {
      let flat;
      try {
        flat = flatten(it.tree, it.path);
      } catch (err) {
        throw withCall(err, it.call);
      }
      for (const b of flat) {
        branches.push({ conj: b.conj && and([subjectLit(it.subject)], b.conj), value: b.value, item: it, own: it.prop === prop });
      }
    }
    const order = atomOrder(branches.map((b) => b.conj));
    const regions = disjointify(branches.map((b) => b.conj), order);
    const cov = [...related]
      .flatMap((p) => coverage.get(`${pe}|${p}`) ?? [])
      .sort((a, b) => (a.className < b.className ? -1 : 1));
    const noClass = cov.map((c) => classLit(c.className, true));

    // Group terms by (item, value) so merging never drops an item's own subject.
    const groups = new Map();
    branches.forEach((b, i) => {
      if (b.value === null || !b.own) return;
      if (!groups.has(b.item)) groups.set(b.item, new Map());
      const byValue = groups.get(b.item);
      if (!byValue.has(b.value)) byValue.set(b.value, []);
      byValue.get(b.value).push(...regions[i]);
    });

    const ruleTerms = [];
    for (const [item, byValue] of groups) {
      for (const [value, terms] of byValue) {
        for (const term of mergeTerms(terms)) {
          const base = and(term, noClass);
          ruleTerms.push({ term: base, value });
          emitted.push({ item, rule: renderGlobal(item, base, value) });
          // (a null rule is unsatisfiable by tag names; the verifier still sees its term)
          for (const c of cov) {
            for (const gap of c.gaps) {
              const withClass = and(term, [classLit(c.className, false)]);
              const t = withClass && and(withClass, gap);
              if (!t) continue;
              ruleTerms.push({ term: t, value });
              emitted.push({ item, rule: renderGlobal(item, t, value) });
            }
          }
        }
      }
    }
    verify(
      list,
      branches.map((b) => (b.own ? b : { ...b, value: null })),
      ruleTerms,
      cov,
    );
  }
  return { rules: mergeSameSelector(emitted.map((e) => e.rule).filter(Boolean)), fontFaces: fontFaces.map((f) => f.decls), items };
}

/**
 * Rules with the same at-rules and selector become one rule, at the first one's place, with its declarations sorted by
 * property. Moving a rule is safe because globals are exclusive: no two of them set one property on the same element,
 * so their order decides nothing, and conflicting longhands (margin-left, margin-inline-start) never share a selector.
 */
function mergeSameSelector(rules) {
  const bySelector = new Map();
  const out = [];
  for (const r of rules) {
    const key = [r.layer, ...r.atRules, r.selectors.join(',')].join('\u0000');
    const seen = bySelector.get(key);
    if (seen) seen.decls.push(...r.decls);
    else {
      const rule = { ...r, decls: [...r.decls] };
      bySelector.set(key, rule);
      out.push(rule);
    }
  }
  for (const r of out) r.decls.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return out;
}

const TYPE_SELECTOR = /^[a-zA-Z][\w-]*$/;
const LEADING_TYPE = /^([a-zA-Z][\w-]*)(?=$|[.#:[])/;

/** The type selector of a selector's last compound (`.card h1` → `h1`), or null when that compound has none. */
function subjectType(sel) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) start = i + 1;
  }
  const m = LEADING_TYPE.exec(sel.slice(start));
  return m ? m[1].toLowerCase() : null;
}

/**
 * An element has exactly one tag name, so for a type-selector subject (h1)
 * another type selector (h2) is always false: `:not(h2)` is redundant and
 * `:is(h2)` makes the rule dead. The same holds for the last compounds of
 * complex selectors: `.card h1` never matches what `.card button` matches.
 * @returns {boolean | null} true/false when decided by tag names, null otherwise
 */
function decidedByTag(subject, other) {
  if (TYPE_SELECTOR.test(subject) && TYPE_SELECTOR.test(other)) return subject.toLowerCase() === other.toLowerCase();
  const a = subjectType(subject);
  const b = subjectType(other);
  return a && b && a !== b ? false : null;
}

/** Render one global rule: subject + other literals + class exclusions + pseudo-element. Null when dead. */
function renderGlobal(item, term, value) {
  const { selector, atRules } = renderTerm(term);
  let suffix = '';
  const excluded = [];
  let ownSubject = false;
  for (const l of selector) {
    if (l.kind === 'subject') {
      if (!l.neg && l.text === item.subject && !ownSubject) {
        ownSubject = true;
        continue;
      }
      const decided = decidedByTag(item.subject, l.text);
      if (decided === false) {
        if (l.neg) continue; // :not(h2) on an h1 always holds
        return null; // :is(h2) on an h1 never holds
      }
      suffix += l.neg ? `:not(${l.text})` : `:is(${l.text})`;
    } else if (l.kind === 'class') {
      if (l.neg) excluded.push(`.${l.text}`);
      else suffix += `.${l.text}`;
    } else suffix += l.neg ? `:not(${l.text})` : l.text;
  }
  if (excluded.length) suffix += `:not(${excluded.join(', ')})`;
  return { atRules, selectors: [`${item.subject}${suffix}${item.pe}`], decls: [[item.prop, value]], layer: item.layer };
}

/** Self-check: globals plus every atom class for the property are exclusive. */
function verify(list, branches, ruleTerms, cov) {
  const classIds = cov.map((c) => `class\u0001\u0001${c.className}`);
  const check = (extraBranches, extraRules, fixed) => {
    const overlap = findOverlap([...branches, ...extraBranches], [...ruleTerms, ...extraRules], { fixed });
    if (overlap) {
      throw withCall(
        new PurserError(`internal error: global rules for ${list[0].prop} overlap (${JSON.stringify(overlap)})`, list[0].path),
        list[0].call,
      );
    }
  };
  check([], [], new Map(classIds.map((id) => [id, false])));
  for (const c of cov) {
    const fixed = new Map(classIds.map((id) => [id, id.endsWith(`\u0001${c.className}`)]));
    const k = classLit(c.className, false);
    // The atom's own rules are disjoint and exactly cover where it sets the
    // property (they are verified separately), so they serve as later branches.
    const atomRules = c.rules.map((r) => ({ term: and([k], r.term), value: `atom:${r.value}` }));
    check(atomRules.map((r) => ({ conj: r.term, value: r.value })), atomRules, fixed);
  }
}

function descriptors(face, path) {
  if (!face || typeof face !== 'object') throw new PurserError('@font-face must be an object of descriptors', path);
  return Object.keys(face).map((k) => {
    const v = face[k];
    if (typeof v !== 'string' && typeof v !== 'number') throw new PurserError(`@font-face ${k} must be a string or number`, [...path, k]);
    return [cssPropertyName(k), String(v).trim()];
  });
}

function withCall(err, call) {
  if (err && typeof err === 'object' && !err.call) err.call = call;
  return err;
}
