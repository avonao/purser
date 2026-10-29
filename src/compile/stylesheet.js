// Assemble the single generated stylesheet from extracted calls.

import { flatten } from '../conditions.js';
import { PurserError } from '../errors.js';
import { resolveNaming } from '../hash.js';
import { atomClassName, canonical, keyframesCanonical, keyframesName, normalizeKeyframes, normalizeStyle } from '../normalize.js';
import { checkValue, leaves } from '../validate.js';
import { compileAtoms, cmp } from './atoms.js';
import { compileGlobals } from './globals.js';
import { layer, renderRules } from './render.js';
import { compileTokens } from './tokens.js';

/** Default names of the three cascade layers, lowest first. */
export const DEFAULT_LAYERS = Object.freeze({ tokens: 'purser.tokens', globals: 'purser.globals', atoms: 'purser.atoms' });

const LAYER_NAME = /^-?[A-Za-z_][\w-]*(?:\.-?[A-Za-z_][\w-]*)*$/;

/**
 * Resolve the cascade layer names. A host that adopts Purser next to existing CSS names the layers so that it can
 * order them around its own: for example globals below the existing rules and atoms above them.
 * @param {{ tokens?: string, globals?: string, atoms?: string }} [layers]
 * @returns {{ tokens: string, globals: string, atoms: string }}
 */
export function resolveLayers(layers = {}) {
  const out = { ...DEFAULT_LAYERS };
  for (const key of Object.keys(layers)) {
    if (!(key in DEFAULT_LAYERS)) throw new PurserError(`unknown layer "${key}" (expected tokens, globals or atoms)`);
    const name = layers[key];
    if (name === undefined) continue;
    if (typeof name !== 'string' || !LAYER_NAME.test(name)) throw new PurserError(`layer name ${JSON.stringify(name)} is not a CSS layer name`);
    out[key] = name;
  }
  if (new Set(Object.values(out)).size !== 3) throw new PurserError('the tokens, globals and atoms layers need three different names');
  return out;
}

/**
 * @typedef {object} Call
 * @property {'create'|'keyframes'|'globals'} kind
 * @property {any} value              statically evaluated argument
 * @property {string} [file]
 * @property {number} [line]
 * @property {number} [column]
 * @property {(path: (string|number)[]) => { line: number, column: number }} [locate]
 */

/**
 * @typedef {object} Diagnostic
 * @property {'error'|'warning'} severity
 * @property {string} message
 * @property {string} [file]
 * @property {number} [line]
 * @property {number} [column]
 */

/**
 * Compile token definitions and extracted calls into CSS.
 * @param {{ tokens?: { axes?: object, tokens: object } | null, tokensFile?: string, calls: Call[], prefix?: string, salt?: string, layers?: { tokens?: string, globals?: string, atoms?: string } }} input
 * @returns {{ css: string | null, diagnostics: Diagnostic[], stats: { atoms: number, rules: number, keyframes: number, tokens: number } }}
 */
export function compileStylesheet(input) {
  const naming = resolveNaming({ prefix: input.prefix, salt: input.salt });
  const names = resolveLayers(input.layers);
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  const report = (err, call, severity = 'error') => {
    if (!(err instanceof PurserError)) throw err;
    const c = err.call ?? call;
    const pos = c?.locate ? c.locate(err.path) : { line: c?.line, column: c?.column };
    diagnostics.push({ severity, message: err.message, file: c?.file, line: pos.line, column: pos.column });
  };

  // Tokens.
  let tokens = { rules: [], names: new Set(), prefixes: [], warnings: [] };
  const tokenCall = { file: input.tokensFile };
  if (input.tokens) {
    try {
      tokens = compileTokens(input.tokens);
    } catch (err) {
      report(err, tokenCall);
    }
    for (const w of tokens.warnings) diagnostics.push({ severity: 'warning', message: w.message, file: input.tokensFile });
  }
  const valueCtx = { tokenNames: tokens.names, tokenPrefixes: tokens.prefixes };
  const checkLeaves = (prop, tree, call) => {
    for (const leaf of leaves(tree, [])) {
      for (const problem of checkValue(prop, leaf.value, valueCtx)) report(new PurserError(problem, leaf.path), call);
    }
  };

  // Atoms.
  const atoms = new Map();
  const atomCanon = new Map();
  const atomCall = new Map();
  for (const call of input.calls.filter((c) => c.kind === 'create')) {
    const styles = call.value;
    if (!styles || typeof styles !== 'object' || Array.isArray(styles)) {
      report(new PurserError('css.create expects an object of named styles'), call);
      continue;
    }
    for (const name of Object.keys(styles)) {
      let entries;
      try {
        entries = normalizeStyle(styles[name], [name]);
      } catch (err) {
        report(err, call);
        continue;
      }
      for (const entry of entries.values()) {
        if (entry.tree === null) continue;
        let ok = true;
        for (const leaf of leaves(entry.tree, entry.path)) {
          for (const problem of checkValue(entry.prop, leaf.value, valueCtx)) {
            report(new PurserError(problem, leaf.path), call);
            ok = false;
          }
        }
        try {
          flatten(entry.tree, entry.path); // parses every condition
        } catch (err) {
          report(err, call);
          ok = false;
        }
        if (!ok) continue;
        const className = atomClassName(entry, naming);
        const canon = `${entry.pe}|${entry.prop}|${canonical(entry.tree)}`;
        if (atomCanon.has(className)) {
          if (atomCanon.get(className) !== canon) {
            report(new PurserError(`class name collision on ${className}; set a different salt (css: createCss({ salt }), build: --salt)`, entry.path), call);
          }
          continue;
        }
        atomCanon.set(className, canon);
        atoms.set(className, entry);
        atomCall.set(className, call);
      }
    }
  }

  let atomResult = { rules: [], coverage: new Map() };
  try {
    atomResult = compileAtoms(atoms);
  } catch (err) {
    report(err, findCallByPath(err, atoms, atomCall));
  }

  // Globals (after atoms: they exclude atom classes).
  const globalCalls = input.calls.filter((c) => c.kind === 'globals').map((c) => ({ def: c.value, origin: c, ...c }));
  let globals = { rules: [], fontFaces: [], items: [] };
  try {
    globals = compileGlobals(globalCalls, atomResult.coverage);
  } catch (err) {
    report(err);
  }
  for (const it of globals.items) {
    if (it.prop.startsWith('--') && tokens.names.has(it.prop)) {
      report(new PurserError(`css.globals must not redeclare token ${it.prop}`, it.path), it.call);
    }
    if (it.tree !== null) checkLeaves(it.prop, it.tree, { ...it.call, locate: it.call.locate && (() => it.call.locate(it.path)) });
  }
  for (const face of globals.fontFaces) {
    for (const [p, v] of face) for (const problem of checkValue(p, v, { allowColors: true })) report(new PurserError(problem));
  }

  // Keyframes.
  const keyframes = new Map();
  for (const call of input.calls.filter((c) => c.kind === 'keyframes')) {
    let frames;
    try {
      frames = normalizeKeyframes(call.value);
    } catch (err) {
      report(err, call);
      continue;
    }
    let ok = true;
    for (const f of frames) {
      for (const e of f.entries.values()) {
        if (e.tree === null) continue;
        for (const problem of checkValue(e.prop, e.tree, valueCtx)) {
          report(new PurserError(problem, e.path), call);
          ok = false;
        }
      }
    }
    if (!ok) continue;
    const name = keyframesName(frames, naming);
    const canon = keyframesCanonical(frames);
    if (keyframes.has(name) && keyframes.get(name).canon !== canon) {
      report(new PurserError(`keyframes name collision on ${name}; set a different salt`), call);
      continue;
    }
    keyframes.set(name, { canon, frames });
  }

  const stats = { atoms: atoms.size, rules: atomResult.rules.length, keyframes: keyframes.size, tokens: tokens.names.size };
  if (diagnostics.some((d) => d.severity === 'error')) return { css: null, diagnostics, stats };

  // Render.
  let keyframesCss = '';
  for (const name of [...keyframes.keys()].sort(cmp)) {
    const { frames } = keyframes.get(name);
    keyframesCss += `  @keyframes ${name} {\n`;
    for (const f of frames) {
      const decls = [...f.entries.values()].filter((e) => e.tree !== null);
      keyframesCss += `    ${f.selector} {${decls.map((e) => ` ${e.prop}: ${e.tree};`).join('')} }\n`;
    }
    keyframesCss += '  }\n';
  }
  let globalsCss = '';
  for (const face of globals.fontFaces) {
    globalsCss += `  @font-face {\n${face.map(([p, v]) => `    ${p}: ${v};\n`).join('')}  }\n`;
  }
  globalsCss += renderRules(globals.rules, '  ');

  const blocks = [
    layer(names.tokens, renderRules(tokens.rules, '  ')),
    layer(names.globals, globalsCss),
    layer(names.atoms, renderRules(atomResult.rules, '  ') + keyframesCss),
  ].filter(Boolean);
  const statement = `@layer ${names.tokens}, ${names.globals}, ${names.atoms};`;
  const css = `/* Generated by purser. Do not edit. */\n${statement}\n${blocks.map((b) => `\n${b}`).join('')}`;
  return { css, diagnostics, stats };
}

function findCallByPath(err, atoms, atomCall) {
  for (const [cls, entry] of atoms) if (entry.path === err.path) return atomCall.get(cls);
  return undefined;
}
