// Normalisation of style objects into atomic entries. Shared by the runtime
// (to compute class names) and by the build (to compile CSS), so both always
// produce identical names.

import { conflictsOf } from './conflicts.js';
import { PurserError } from './errors.js';
import { makeName } from './hash.js';
import { cssPropertyName, formatNumberValue } from './properties.js';
import { expandProperty } from './shorthands.js';

/** Is `key` a condition key (as opposed to a property or pseudo-element)? */
export function conditionKind(key) {
  if (key.startsWith('::')) return null;
  if (key.startsWith(':') || key.startsWith('[')) return 'selector';
  if (/^@media\s/.test(key)) return 'media';
  if (/^@supports\s/.test(key)) return 'supports';
  if (/^@container\s/.test(key)) return 'container';
  return null;
}

/** Collapse whitespace so trivially different spellings of a condition dedupe. */
export function normalizeConditionKey(key) {
  return key.trim().replace(/\s+/g, ' ');
}

/**
 * Normalise a property value: numbers get units, conditional objects get a
 * canonical shape ({ default, …conditions in authoring order }).
 * @param {unknown} value
 * @param {string} prop kebab-case property
 * @param {(string|number)[]} path
 * @param {{ conditions: boolean }} opts
 * @returns {string | null | object | undefined}
 */
export function normalizeTree(value, prop, path, opts) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const v = value.trim();
    if (v === '') throw new PurserError(`empty value for "${prop}"`, path);
    if (/!\s*important/i.test(v)) throw new PurserError(`"!important" is not allowed (${prop}: ${v})`, path);
    return v;
  }
  if (typeof value === 'number') {
    try {
      return formatNumberValue(prop, value);
    } catch (e) {
      throw new PurserError(`${e.message} for "${prop}"`, path);
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (!opts.conditions) throw new PurserError(`conditional values are not allowed here ("${prop}")`, path);
    const out = {};
    if (Object.hasOwn(value, 'default')) {
      const d = normalizeTree(value.default, prop, [...path, 'default'], opts);
      if (d !== undefined) out.default = d;
    }
    for (const rawKey of Object.keys(value)) {
      if (rawKey === 'default') continue;
      if (!conditionKind(rawKey)) {
        throw new PurserError(
          `"${rawKey}" is not a condition; condition keys start with ":", "[", "@media ", "@supports " or "@container " (and "default" is the fallback)`,
          [...path, rawKey],
        );
      }
      const key = normalizeConditionKey(rawKey);
      const v = normalizeTree(value[rawKey], prop, [...path, rawKey], opts);
      if (v === undefined) continue;
      if (Object.hasOwn(out, key)) throw new PurserError(`duplicate condition "${key}"`, [...path, rawKey]);
      out[key] = v;
    }
    if (Object.keys(out).length === 0) throw new PurserError(`empty conditional value for "${prop}"`, path);
    return out;
  }
  if (Array.isArray(value)) {
    throw new PurserError(
      `array values (fallback lists) are not allowed for "${prop}": two declarations of one property is an override; use @supports conditions instead`,
      path,
    );
  }
  throw new PurserError(`unsupported value of type ${typeof value} for "${prop}"`, path);
}

/** Canonical, order-preserving serialisation of a normalised tree. */
export function canonical(tree) {
  if (tree === null) return 'null';
  if (typeof tree === 'string') return JSON.stringify(tree);
  return `{${Object.keys(tree).map((k) => `${JSON.stringify(k)}:${canonical(tree[k])}`).join(',')}}`;
}

/**
 * @typedef {object} Entry
 * @property {string} key       merge key: property, prefixed by the pseudo-element if any
 * @property {string} pe        pseudo-element ('' when none)
 * @property {string} prop      kebab-case longhand
 * @property {any} tree         normalised value tree (null = explicitly unset)
 * @property {(string|number)[]} path where the value came from
 */

/**
 * Normalise a style object into atomic entries (one per longhand and pseudo-element).
 * Later keys win over earlier ones that resolve to the same longhand.
 * @param {Record<string, unknown>} style
 * @param {(string|number)[]} path
 * @param {{ conditions?: boolean, pseudoElements?: boolean, pe?: string }} [opts]
 * @returns {Map<string, Entry>}
 */
export function normalizeStyle(style, path = [], opts = {}) {
  const conditions = opts.conditions ?? true;
  const pseudoElements = opts.pseudoElements ?? true;
  const pe = opts.pe ?? '';
  /** @type {Map<string, Entry>} */
  const out = new Map();
  if (style === null || typeof style !== 'object' || Array.isArray(style)) {
    throw new PurserError('a style must be a plain object of CSS properties', path);
  }
  for (const rawKey of Object.keys(style)) {
    const value = style[rawKey];
    const here = [...path, rawKey];
    if (value === undefined) continue;
    if (rawKey.startsWith('::')) {
      if (!pseudoElements || pe) throw new PurserError(`pseudo-element "${rawKey}" is not allowed here`, here);
      for (const [k, e] of normalizeStyle(value, here, { conditions, pseudoElements: false, pe: rawKey })) {
        out.delete(k);
        for (const other of conflictsOf(e.prop)) out.delete(mergeKey(e.pe, other));
        out.set(k, e);
      }
      continue;
    }
    if (conditionKind(rawKey)) {
      throw new PurserError(
        `"${rawKey}" cannot be a style key; put conditions on each property value, e.g. color: { default: …, "${rawKey}": … }`,
        here,
      );
    }
    if (!/^(--[\w-]+|-?[a-zA-Z][a-zA-Z0-9-]*)$/.test(rawKey)) throw new PurserError(`invalid property name "${rawKey}"`, here);
    const prop = cssPropertyName(rawKey);
    const tree = normalizeTree(value, prop, here, { conditions });
    if (tree === undefined) continue;
    const fail = (msg) => {
      throw new PurserError(msg, here);
    };
    for (const [longhand, t] of expandProperty(prop, tree, fail)) {
      const key = mergeKey(pe, longhand);
      out.delete(key);
      for (const other of conflictsOf(longhand)) out.delete(mergeKey(pe, other));
      out.set(key, { key, pe, prop: longhand, tree: t, path: here });
    }
  }
  return out;
}

/** Key under which css.props merges a property ("color", "::before color"). */
export function mergeKey(pe, prop) {
  return pe ? `${pe} ${prop}` : prop;
}

/** Class name for an atomic entry. */
export function atomClassName(entry, naming) {
  return makeName(`${entry.pe}|${entry.prop}|${canonical(entry.tree)}`, naming);
}

/**
 * Normalise a keyframes definition: { from: {...}, '50%': {...}, to: {...} }.
 * @returns {{ selector: string, entries: Map<string, Entry> }[]}
 */
export function normalizeKeyframes(frames, path = []) {
  if (frames === null || typeof frames !== 'object' || Array.isArray(frames)) {
    throw new PurserError('keyframes must be an object of frames', path);
  }
  const out = [];
  for (const key of Object.keys(frames)) {
    const sel = key.trim().replace(/\s*,\s*/g, ', ');
    if (!/^(from|to|\d+(\.\d+)?%)(, (from|to|\d+(\.\d+)?%))*$/.test(sel)) {
      throw new PurserError(`invalid keyframe selector "${key}" (use from, to or percentages)`, [...path, key]);
    }
    out.push({ selector: sel, entries: normalizeStyle(frames[key], [...path, key], { conditions: false, pseudoElements: false }) });
  }
  if (out.length === 0) throw new PurserError('keyframes must have at least one frame', path);
  return out;
}

/** Canonical form of normalised keyframes. */
export function keyframesCanonical(frames) {
  return frames
    .map((f) => `${JSON.stringify(f.selector)}:{${[...f.entries.values()].map((e) => `${JSON.stringify(e.prop)}:${canonical(e.tree)}`).join(',')}}`)
    .join(',');
}

/** Generated animation name for normalised keyframes. */
export function keyframesName(frames, naming) {
  return makeName(`@keyframes|${keyframesCanonical(frames)}`, naming);
}
