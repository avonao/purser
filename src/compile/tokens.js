// Compile token definitions into custom-property rules.
//
// Each axis (mode, contrast, …) is a list of root conditions made exclusive
// in authoring order (a later value wins if several match). Each token's
// value is resolved for every combination of axis values; the axes it really
// depends on are computed, tokens are grouped by that axis subset, and each
// group gets one rule per combination of its axes. So every custom property
// is declared by exactly one rule in any root state.

import { convertColorsInValue, ColorError } from '../color.js';
import {
  and,
  atomId,
  atomOrder,
  disjointify,
  mergeTerms,
  parseCondition,
  parseSelectorCondition,
  renderSelectorLiterals,
  renderTerm,
  termMatches,
} from '../conditions.js';
import { PurserError } from '../errors.js';
import { isConditionalTokenValue, tokenVarName, walkTokens } from '../tokens.js';
import { checkValue } from '../validate.js';
import { MAX_ATOMS } from '../verify.js';

const NAMED_COLOR_GROUPS = new Set(['color', 'shadow']);

/**
 * @typedef {object} CompiledTokens
 * @property {import('./render.js').CssRule[]} rules
 * @property {Set<string>} names     declared custom property names
 * @property {string[]} prefixes     "--<group>-" prefixes, for unknown-token checks
 * @property {{ message: string, path: (string|number)[] }[]} warnings
 */

/**
 * @param {{ axes: Record<string, Record<string, string | string[]>>, tokens: object }} def
 * @returns {CompiledTokens}
 */
export function compileTokens(def) {
  const warnings = [];
  const axes = parseAxes(def.axes ?? {}, warnings);
  const axisNames = axes.map((a) => a.name);

  // Collect tokens.
  const tokens = [];
  const byVar = new Map();
  walkTokens(def.tokens, (path, raw) => {
    const name = tokenVarName(path);
    if (byVar.has(name)) {
      throw new PurserError(`tokens ${byVar.get(name).join('.')} and ${path.join('.')} both map to ${name}`, ['tokens', ...path]);
    }
    byVar.set(name, path);
    tokens.push({ path, name, group: path[0], candidates: parseCandidates(raw, path, axes) });
  });

  // Every combination of axis values.
  const combos = product(axes.map((a) => a.values.map((v) => v.name)));
  const names = new Set(tokens.map((t) => t.name));
  const prefixes = [...new Set(tokens.map((t) => tokenVarName([t.group]) + '-'))];

  const groups = new Map();
  for (const t of tokens) {
    const resolved = combos.map((combo) => resolve(t, combo, axisNames));
    const depends = axisNames.filter((axis, ai) =>
      combos.some((combo, ci) =>
        axes[ai].values.some((v) => {
          if (v.name === combo[ai]) return false;
          const other = [...combo];
          other[ai] = v.name;
          return resolved[indexOf(combos, other)] !== resolved[ci];
        }),
      ),
    );
    t.resolved = resolved;
    t.dependsOn = depends;
    const key = depends.join('&');
    if (!groups.has(key)) groups.set(key, { depends, tokens: [] });
    groups.get(key).tokens.push(t);
  }

  for (const t of tokens) {
    for (let i = 0; i < t.resolved.length; i++) t.resolved[i] = compileValue(t, t.resolved[i], names, prefixes);
  }

  const ordered = [...groups.values()].sort(
    (a, b) => a.depends.length - b.depends.length || axisKey(a.depends, axisNames).localeCompare(axisKey(b.depends, axisNames)),
  );
  const rules = [];
  for (const g of ordered) {
    const dIdx = g.depends.map((d) => axisNames.indexOf(d));
    for (const sub of product(dIdx.map((ai) => axes[ai].values.map((v) => v.name)))) {
      // Root condition for this combination: product of each axis value's region.
      let terms = [[]];
      sub.forEach((valueName, k) => {
        const axis = axes[dIdx[k]];
        const region = axis.values.find((v) => v.name === valueName).region;
        terms = terms.flatMap((t) => region.map((r) => and(t, r)).filter(Boolean));
      });
      if (terms.length === 0) continue;
      const full = combos[0].map((v, ai) => (dIdx.includes(ai) ? sub[dIdx.indexOf(ai)] : v));
      const ci = indexOf(combos, full);
      const decls = g.tokens.map((t) => [t.name, t.resolved[ci]]);
      const byContext = new Map();
      for (const term of terms) {
        const { selector, atRules } = renderTerm(term);
        const k = atRules.join('\n');
        if (!byContext.has(k)) byContext.set(k, { atRules, selectors: [], decls, terms: [] });
        byContext.get(k).selectors.push(`:root${renderSelectorLiterals(selector)}`);
        byContext.get(k).terms.push(term);
      }
      rules.push(...byContext.values());
    }
  }
  verifyTokens(axes, tokens, rules, combos);
  return { rules: rules.map(({ terms, ...r }) => r), names, prefixes, warnings };
}

function axisKey(depends, axisNames) {
  return depends.map((d) => String(axisNames.indexOf(d)).padStart(4, '0')).join(',');
}

/** Parse axes into ordered values with disjoint root regions. */
function parseAxes(axesDef, warnings) {
  const axes = [];
  for (const name of Object.keys(axesDef)) {
    if (!/^[a-zA-Z_][\w-]*$/.test(name)) throw new PurserError(`invalid axis name "${name}"`, ['axes', name]);
    const valuesDef = axesDef[name];
    const valueNames = Object.keys(valuesDef ?? {});
    if (valueNames.length < 2) throw new PurserError(`axis "${name}" needs at least two values`, ['axes', name]);
    const conjs = valueNames.map((v) => {
      const path = ['axes', name, v];
      if (!/^[a-zA-Z0-9_-]+$/.test(v)) throw new PurserError(`invalid axis value name "${v}"`, path);
      const conds = [valuesDef[v]].flat();
      if (conds.length === 0 || conds.some((c) => typeof c !== 'string' || !c.trim())) {
        throw new PurserError(`axis value ${name}=${v} needs a root condition such as ".dark" or "@media (prefers-contrast: more)"`, path);
      }
      let conj = [];
      for (const c of conds) {
        const lits = c.trim().startsWith('@') ? parseCondition(c.trim(), path) : parseSelectorCondition(c.trim(), path);
        if (lits.some((l) => l.kind === 'container')) throw new PurserError('@container cannot be a root condition', path);
        conj = conj && and(conj, lits);
      }
      if (!conj) throw new PurserError(`axis value ${name}=${v} is contradictory`, path);
      return conj;
    });
    const order = atomOrder(conjs);
    const regions = disjointify(conjs, order).map(mergeTerms);
    const values = valueNames.map((v, i) => ({ name: v, region: regions[i] }));
    for (const v of values) {
      if (v.region.length === 0) warnings.push({ message: `axis value ${name}=${v.name} can never apply (a later value always wins)`, path: ['axes', name, v.name] });
    }
    // Exhaustiveness: does every root state match some value of this axis?
    const atoms = [...new Map(conjs.flat().map((l) => [atomId(l), l])).keys()];
    if (atoms.length <= MAX_ATOMS) {
      for (let mask = 0; mask < 2 ** atoms.length; mask++) {
        const asg = new Map(atoms.map((id, i) => [id, Boolean(mask & (1 << i))]));
        if (!regions.some((terms) => terms.some((t) => termMatches(t, asg)))) {
          warnings.push({
            message: `axis "${name}" is not exhaustive: some root states match none of its values, so tokens that depend on it are undefined there`,
            path: ['axes', name],
          });
          break;
        }
      }
    }
    axes.push({ name, values });
  }
  return axes;
}

/** Parse a token's value spec into candidates { clauses: Map(axis->value), value }. */
function parseCandidates(raw, path, axes) {
  const where = ['tokens', ...path];
  const scalar = (v, p) => {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    throw new PurserError(`token ${path.join('.')} must be a non-empty string or a number`, p);
  };
  if (!isConditionalTokenValue(raw)) return [{ clauses: new Map(), value: scalar(raw, where), key: 'default' }];
  return Object.keys(raw).map((key) => {
    const p = [...where, key];
    const clauses = new Map();
    if (key !== 'default') {
      for (const part of key.split('&')) {
        const [axis, value, extra] = part.split('=').map((s) => s.trim());
        const ax = axes.find((a) => a.name === axis);
        if (!ax || extra !== undefined) throw new PurserError(`unknown axis in "${key}" (axes: ${axes.map((a) => a.name).join(', ') || 'none'})`, p);
        if (!ax.values.some((v) => v.name === value)) {
          throw new PurserError(`unknown value "${value}" for axis "${axis}" (values: ${ax.values.map((v) => v.name).join(', ')})`, p);
        }
        if (clauses.has(axis)) throw new PurserError(`axis "${axis}" appears twice in "${key}"`, p);
        clauses.set(axis, value);
      }
    }
    return { clauses, value: scalar(raw[key], p), key };
  });
}

/** Resolve a token for one full combination: the matching key with the most axes wins. */
function resolve(token, combo, axisNames) {
  let best = -1;
  let winners = [];
  for (const c of token.candidates) {
    const matches = [...c.clauses].every(([axis, value]) => combo[axisNames.indexOf(axis)] === value);
    if (!matches) continue;
    if (c.clauses.size > best) {
      best = c.clauses.size;
      winners = [c];
    } else if (c.clauses.size === best) winners.push(c);
  }
  const state = axisNames.map((a, i) => `${a}=${combo[i]}`).join('&') || '(no axes)';
  if (winners.length === 0) {
    throw new PurserError(`token ${token.path.join('.')} has no value when ${state}; add a "default"`, ['tokens', ...token.path]);
  }
  const values = new Set(winners.map((w) => w.value));
  if (values.size > 1) {
    throw new PurserError(
      `token ${token.path.join('.')} is ambiguous when ${state}: ${winners.map((w) => `"${w.key}"`).join(' and ')} match equally; add a more specific key`,
      ['tokens', ...token.path],
    );
  }
  return winners[0].value;
}

/** Convert colours to lab() and validate one resolved token value. */
function compileValue(token, value, names, prefixes) {
  let out;
  try {
    out = convertColorsInValue(value, { named: NAMED_COLOR_GROUPS.has(token.group) });
  } catch (e) {
    if (e instanceof ColorError) throw new PurserError(`token ${token.path.join('.')}: ${e.message}`, ['tokens', ...token.path]);
    throw e;
  }
  const problems = checkValue(token.name, out, { tokenNames: names, tokenPrefixes: prefixes, allowColors: true });
  if (problems.length) throw new PurserError(`token ${token.path.join('.')}: ${problems[0]}`, ['tokens', ...token.path]);
  return out;
}

/**
 * Self-check: in every root state each token is declared by at most one rule,
 * by exactly one when every axis it depends on has a value, and with the
 * value its definition resolves to.
 */
function verifyTokens(axes, tokens, rules, combos) {
  const atoms = new Set();
  for (const a of axes) for (const v of a.values) for (const t of v.region) for (const l of t) atoms.add(atomId(l));
  const ids = [...atoms];
  if (ids.length > MAX_ATOMS) return;
  for (let mask = 0; mask < 2 ** ids.length; mask++) {
    const asg = new Map(ids.map((id, i) => [id, Boolean(mask & (1 << i))]));
    const state = axes.map((a) => a.values.find((v) => v.region.some((t) => termMatches(t, asg)))?.name);
    const seen = new Map();
    for (const r of rules) {
      if (!r.terms.some((t) => termMatches(t, asg))) continue;
      for (const [name, value] of r.decls) {
        if (seen.has(name)) throw new PurserError(`internal error: ${name} is declared twice in one root state`, ['tokens']);
        seen.set(name, value);
      }
    }
    for (const t of tokens) {
      const known = state.every((v, ai) => v !== undefined || !t.dependsOn?.includes(axes[ai].name));
      if (!known) continue;
      const combo = state.map((v, ai) => v ?? axes[ai].values[0].name);
      const expected = t.resolved[indexOf(combos, combo)];
      if (seen.get(t.name) !== expected) {
        throw new PurserError(`internal error: ${t.name} resolves to ${seen.get(t.name)} instead of ${expected}`, ['tokens', ...t.path]);
      }
    }
  }
}

function product(lists) {
  return lists.reduce((acc, list) => acc.flatMap((a) => list.map((v) => [...a, v])), [[]]);
}

function indexOf(combos, combo) {
  return combos.findIndex((c) => c.every((v, i) => v === combo[i]));
}
