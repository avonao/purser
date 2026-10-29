// Conditions and the boolean algebra that makes rules for one property
// mutually exclusive.
//
// A condition key (":hover", "@media (width >= 768px)", …) parses into a
// conjunction of literals. A literal is an atom (a selector fragment, a media
// feature, a supports or container condition) with a polarity. A property's
// conditional value tree flattens into ordered branches; branch i applies
// where its own literals hold AND no later branch applies. That region is
// expanded into disjoint terms (conjunctions of literals), each rendered as
// one CSS rule — so two rules for one property can never match at once.
//
// Build-only module.

import { matchParen } from './color.js';
import { PurserError } from './errors.js';

/**
 * @typedef {object} Literal
 * @property {'sel'|'media-type'|'media'|'supports'|'container'|'subject'} kind
 * @property {string} text     normalised atom text
 * @property {string} [name]   container name
 * @property {boolean} neg
 */

/** Stable identity of a literal's atom (polarity excluded). */
export const atomId = (l) => `${l.kind}\u0001${l.name ?? ''}\u0001${l.text}`;
const lit = (kind, text, neg = false, name = undefined) => ({ kind, text, neg, ...(name ? { name } : {}) });
export const negate = (l) => ({ ...l, neg: !l.neg });

const norm = (s) => s.trim().replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// Parsing

function matchBracket(s, open) {
  let quote = '';
  for (let i = open + 1; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ']') return i;
  }
  return -1;
}

/** Split at top-level occurrences of `sep` (a single character). */
function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/**
 * Split a compound selector into its simple selectors.
 * @param {string} s
 * @param {(msg: string) => never} fail
 */
export function splitCompound(s, fail) {
  const parts = [];
  let i = 0;
  while (i < s.length) {
    const start = i;
    const c = s[i];
    if (c === ':') {
      if (s[i + 1] === ':') fail(`pseudo-elements cannot be conditions ("${s}"); use a "::before"-style key on the style object`);
      i++;
      while (i < s.length && /[\w-]/.test(s[i])) i++;
      if (i === start + 1) fail(`invalid pseudo-class in "${s}"`);
      if (s[i] === '(') i = matchParen(s, i) + 1;
    } else if (c === '[') {
      const close = matchBracket(s, i);
      if (close === -1) fail(`unclosed "[" in "${s}"`);
      i = close + 1;
    } else if (c === '.' || c === '#') {
      i++;
      while (i < s.length && (/[\w-]/.test(s[i]) || s[i] === '\\')) i += s[i] === '\\' ? 2 : 1;
      if (i === start + 1) fail(`invalid selector "${s}"`);
    } else if (/\s|[>+~,]/.test(c)) {
      fail(`"${s}" contains a combinator or list; a condition must be one compound selector. For ancestor or sibling state use :is(.ancestor *), :has(…) or :is(.prev + *)`);
    } else {
      fail(`unexpected "${c}" in selector condition "${s}"`);
    }
    parts.push(s.slice(start, i));
  }
  return parts;
}

/**
 * Parse a compound selector condition (":hover", ".dark", "[aria-expanded=true]:not(.x)") into literals.
 * @param {string} text
 * @param {(string|number)[]} [path]
 */
export function parseSelectorCondition(text, path = []) {
  return parseSelector(text, (msg) => {
    throw new PurserError(msg, path);
  });
}

function parseSelector(text, fail) {
  const s = text.trim();
  const out = [];
  for (const part of splitCompound(s, fail)) {
    const m = /^:not\((.*)\)$/s.exec(part);
    if (m) {
      const items = splitTop(m[1], ',').map((x) => x.trim());
      let simple = items.every((it) => {
        if (!it) return false;
        try {
          const p = splitCompound(it, (msg) => {
            throw new Error(msg);
          });
          return p.length === 1 && !/^:not\(/.test(p[0]);
        } catch {
          return false;
        }
      });
      if (simple) {
        for (const it of items) out.push(lit('sel', norm(it), true));
        continue;
      }
    }
    out.push(lit('sel', norm(part)));
  }
  return out;
}

/** Split a condition list on top-level " and " (case-insensitive). */
function splitAnd(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  let hasOr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && /\s/.test(c)) {
      const rest = s.slice(i + 1);
      if (/^and\s/i.test(rest)) {
        out.push(s.slice(start, i));
        start = i + 5;
        i += 4;
      } else if (/^or\s/i.test(rest)) hasOr = true;
    }
  }
  out.push(s.slice(start));
  return hasOr ? [s] : out.map((x) => x.trim());
}

const IN_PARENS = /^(\(|[a-z-]+\()/i;

function parseConditionList(text, kind, fail, name) {
  const out = [];
  for (const part of splitAnd(norm(text))) {
    let neg = false;
    let p = part;
    const m = /^not\s+(.*)$/is.exec(p);
    if (m) {
      neg = true;
      p = m[1].trim();
    }
    if (!IN_PARENS.test(p)) fail(`cannot parse "${text}": expected "(…)" conditions`);
    if (matchParen(p, p.indexOf('(')) !== p.length - 1 && !/\sor\s/i.test(p)) {
      fail(`cannot parse "${text}": mix "and"/"or"/"not" only with parentheses, e.g. (a) and ((b) or (c))`);
    }
    out.push(lit(kind, p, neg, name));
  }
  return out;
}

function parseMedia(text, fail) {
  let q = norm(text);
  if (splitTop(q, ',').length > 1) fail(`media query lists ("${text}") are not supported; use "or": (a) or (b)`);
  q = q.replace(/^only\s+/i, '');
  const notType = /^not\s+([a-z][\w-]*)(.*)$/i.exec(q);
  if (notType && !notType[2].trimStart().startsWith('(')) {
    if (notType[2].trim()) fail(`"not <media type> and …" is not supported ("${text}"); nest the feature condition inside the type condition instead`);
    return [lit('media-type', notType[1].toLowerCase(), true)];
  }
  const type = /^([a-z][\w-]*)(?:\s+and\s+(.*)|\s*)$/is.exec(q);
  if (type && type[1].toLowerCase() !== 'not') {
    const t = type[1].toLowerCase();
    const lits = t === 'all' ? [] : [lit('media-type', t)];
    if (type[2]) lits.push(...parseConditionList(type[2], 'media', fail));
    return lits;
  }
  return parseConditionList(q, 'media', fail);
}

function parseContainer(text, fail) {
  const q = norm(text);
  // A leading identifier followed by whitespace (not a keyword, not a function) names the container.
  const m = /^([a-zA-Z_-][\w-]*)\s+(.+)$/s.exec(q);
  if (m && !['not', 'and', 'or', 'none'].includes(m[1].toLowerCase())) {
    return parseConditionList(m[2], 'container', fail, m[1]);
  }
  return parseConditionList(q, 'container', fail);
}

/**
 * Parse one condition key into a conjunction of literals.
 * @param {string} key
 * @param {(string|number)[]} [path] for error reporting
 * @returns {Literal[]}
 */
export function parseCondition(key, path = []) {
  const fail = (msg) => {
    throw new PurserError(msg, path);
  };
  if (key.startsWith(':') || key.startsWith('[')) return parseSelector(key, fail);
  let m;
  if ((m = /^@media\s+(.+)$/s.exec(key))) return parseMedia(m[1], fail);
  if ((m = /^@supports\s+(.+)$/s.exec(key))) return parseConditionList(m[1], 'supports', fail);
  if ((m = /^@container\s+(.+)$/s.exec(key))) return parseContainer(m[1], fail);
  return fail(`unknown condition "${key}": conditions start with ":", "[", "@media", "@supports" or "@container" (for ancestor state such as a theme class use ":is(.dark *)")`);
}

// ---------------------------------------------------------------------------
// Algebra

/**
 * Conjunction of two terms; null when contradictory.
 * @param {Literal[]} a
 * @param {Literal[]} b
 * @returns {Literal[] | null}
 */
export function and(a, b) {
  const map = new Map();
  for (const l of [...a, ...b]) {
    const id = atomId(l);
    const prev = map.get(id);
    if (prev) {
      if (prev.neg !== l.neg) return null;
    } else map.set(id, l);
  }
  return [...map.values()];
}

/**
 * Flatten a normalised value tree into ordered branches.
 * `default` is always the base of its object; condition keys follow in authoring order.
 * @param {any} tree
 * @param {(string|number)[]} [path]
 * @returns {{ conj: Literal[] | null, value: string | null, path: (string|number)[] }[]}
 */
export function flatten(tree, path = [], conj = []) {
  if (tree === null || typeof tree !== 'object') return [{ conj, value: tree, path }];
  const out = [];
  for (const key of Object.keys(tree)) {
    const here = [...path, key];
    if (key === 'default') {
      out.push(...flatten(tree.default, here, conj));
      continue;
    }
    const c = conj === null ? null : and(conj, parseCondition(key, here));
    out.push(...flatten(tree[key], here, c));
  }
  return out;
}

/**
 * For each branch, the disjoint terms where it is the winning branch
 * (its conjunction holds and no later branch's conjunction holds).
 * @param {(Literal[] | null)[]} conjs
 * @param {(l: Literal) => number} order sort key for literals
 * @returns {Literal[][][]}
 */
export function disjointify(conjs, order) {
  const sorted = (t) => [...t].sort((x, y) => order(x) - order(y));
  return conjs.map((own, i) => {
    if (own === null) return [];
    let terms = [own];
    for (let j = i + 1; j < conjs.length; j++) {
      const other = conjs[j];
      if (other === null) continue;
      const next = [];
      for (const t of terms) {
        const ids = new Map(t.map((l) => [atomId(l), l]));
        if (other.some((l) => ids.has(atomId(l)) && ids.get(atomId(l)).neg !== l.neg)) {
          next.push(t); // already outside `other`
          continue;
        }
        const rest = sorted(other.filter((l) => !ids.has(atomId(l))));
        if (rest.length === 0) continue; // t lies entirely inside `other`
        // ¬(r1 ∧ … ∧ rk) as disjoint pieces: ¬r1 | r1∧¬r2 | r1∧r2∧¬r3 | …
        for (let m = 0; m < rest.length; m++) next.push([...t, ...rest.slice(0, m), negate(rest[m])]);
      }
      terms = next;
    }
    return terms.map(sorted);
  });
}

/**
 * Merge disjoint terms that differ only in the polarity of one literal.
 * The union stays disjoint from every other term.
 * @param {Literal[][]} terms
 */
export function mergeTerms(terms) {
  let list = terms.map((t) => [...t]);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const x = list[a];
        const y = list[b];
        if (x.length !== y.length) continue;
        const yIds = new Map(y.map((l) => [atomId(l), l]));
        let diff = -1;
        let ok = true;
        for (let k = 0; k < x.length; k++) {
          const other = yIds.get(atomId(x[k]));
          if (!other) {
            ok = false;
            break;
          }
          if (other.neg !== x[k].neg) {
            if (diff !== -1) {
              ok = false;
              break;
            }
            diff = k;
          }
        }
        if (ok && diff !== -1) {
          list[a] = x.filter((_, k) => k !== diff);
          list.splice(b, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return list;
}

/**
 * Compile a value tree into disjoint rules.
 * @param {any} tree normalised tree
 * @param {(string|number)[]} [path]
 * @returns {{ branches: ReturnType<typeof flatten>, rules: { term: Literal[], value: string }[], order: (l: Literal) => number }}
 */
export function compileTree(tree, path = []) {
  const branches = flatten(tree, path);
  const order = atomOrder(branches.map((b) => b.conj));
  const regions = disjointify(branches.map((b) => b.conj), order);
  // Group regions by value so identical values can merge into fewer rules.
  const byValue = new Map();
  branches.forEach((b, i) => {
    if (b.value === null) return;
    if (!byValue.has(b.value)) byValue.set(b.value, []);
    byValue.get(b.value).push(...regions[i]);
  });
  const rules = [];
  for (const [value, terms] of byValue) {
    for (const term of mergeTerms(terms)) rules.push({ term: [...term].sort((x, y) => order(x) - order(y)), value });
  }
  return { branches, rules, order };
}

/** Order atoms by first appearance; selector literals first, then at-rules. */
export function atomOrder(conjs) {
  const seen = new Map();
  for (const c of conjs) for (const l of c ?? []) if (!seen.has(atomId(l))) seen.set(atomId(l), seen.size);
  return (l) => seen.get(atomId(l)) ?? seen.size;
}

// ---------------------------------------------------------------------------
// Rendering

/** Wrap a condition in parentheses unless it already is one group or function. */
export function wrap(text) {
  const t = text.trim();
  const open = t.indexOf('(');
  if (open !== -1 && matchParen(t, open) === t.length - 1 && /^[a-z-]*\($/i.test(t.slice(0, open + 1))) return t;
  return `(${t})`;
}

function group(lits) {
  if (lits.length === 1) return lits[0].neg ? `not ${wrap(lits[0].text)}` : lits[0].text;
  return lits.map((l) => (l.neg ? `(not ${wrap(l.text)})` : wrap(l.text))).join(' and ');
}

/**
 * Split a term into its selector literals and at-rule preludes (outermost first).
 * @param {Literal[]} term
 * @returns {{ selector: Literal[], atRules: string[] }}
 */
export function renderTerm(term) {
  const selector = [];
  const types = [];
  const media = [];
  const supports = [];
  const containers = new Map();
  for (const l of term) {
    if (l.kind === 'media-type') types.push(l);
    else if (l.kind === 'media') media.push(l);
    else if (l.kind === 'supports') supports.push(l);
    else if (l.kind === 'container') {
      const k = l.name ?? '';
      if (!containers.has(k)) containers.set(k, []);
      containers.get(k).push(l);
    } else selector.push(l);
  }
  const atRules = [];
  for (const t of types) atRules.push(`@media ${t.neg ? 'not ' : ''}${t.text}`);
  if (media.length) atRules.push(`@media ${group(media)}`);
  if (supports.length) atRules.push(`@supports ${group(supports)}`);
  for (const name of [...containers.keys()].sort()) {
    atRules.push(`@container ${name ? `${name} ` : ''}${group(containers.get(name))}`);
  }
  return { selector, atRules };
}

/** Render selector literals as a suffix (":hover:not(:focus)"). */
export function renderSelectorLiterals(lits) {
  return lits.map((l) => (l.neg ? `:not(${l.text})` : l.text)).join('');
}

/**
 * Evaluate a term under an assignment of atoms (used by tests and by
 * self-checks): true when every literal agrees with the assignment.
 * @param {Literal[]} term
 * @param {Map<string, boolean>} assignment
 */
export function termMatches(term, assignment) {
  return term.every((l) => Boolean(assignment.get(atomId(l))) !== l.neg);
}
