// Extraction: find css.create / css.keyframes / css.globals calls in a source
// file (using the host project's TypeScript parser) and statically evaluate
// their arguments.

/**
 * @typedef {object} ExtractContext
 * @property {any} ts                   the host's `typescript` module
 * @property {string} packageName       import specifier of the runtime ("@avonao/purser")
 * @property {(spec: string, fromFile: string) => any} resolveStatic
 *   returns the exports object of a module whose values are statically known
 *   (the tokens module), or undefined
 * @property {{ prefix: string, salt: string }} naming  must match the runtime's createCss options
 * @property {(spec: string, fromFile: string) => boolean} [isCssModule]
 *   true for the project module that exports a custom `css` (from createCss)
 * @property {boolean} [nodes]
 *   also return what a source transform needs: the parsed file, the node of every call, the css.props calls and the
 *   imports (the compiler in ../compile/module.js)
 */

import { keyframesName, normalizeKeyframes } from '../normalize.js';
import { PurserError } from '../errors.js';
import { defineTokens, TOKENS } from '../tokens.js';

const KINDS = new Set(['create', 'keyframes', 'globals']);
const API = new Set(['create', 'keyframes', 'globals', 'props']);

class StaticError extends Error {
  constructor(node, message) {
    super(message);
    this.node = node;
  }
}

function scriptKind(ts, file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** Parse one file and set up static evaluation in it: imports, const bindings, literals. */
function createScope(file, text, ctx, always = false) {
  const { ts } = ctx;
  // Parsed without parent links: letting the parser set them costs twice the parse itself. The one walk below sets
  // them and notes the nodes extraction looks at, so the tree is walked once instead of three times.
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, scriptKind(ts, file));
  const pos = (node) => {
    const p = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return { line: p.line + 1, column: p.character + 1 };
  };

  // --- imports ---------------------------------------------------------------
  const cssNames = new Set(); // local names bound to the package's `css`
  const nsNames = new Set(); // namespace imports of the package
  const tokenFns = new Set(); // local names bound to the package's `defineTokens`
  const imports = new Map(); // local -> { spec, imported } ('*' for namespace, 'default')
  const importNodes = []; // { node, spec, own, locals: Map(local -> specifier node | 'default' | 'namespace') }
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const clause = st.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const spec = st.moduleSpecifier.text;
    // The package's rule-granularity runtime (…/rule) has the same API.
    const own = spec === ctx.packageName || spec === `${ctx.packageName}/rule`;
    const locals = new Map();
    if (clause.name) {
      imports.set(clause.name.text, { spec, imported: 'default' });
      locals.set(clause.name.text, 'default');
    }
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) {
      locals.set(nb.name.text, 'namespace');
      if (own) nsNames.add(nb.name.text);
      else imports.set(nb.name.text, { spec, imported: '*' });
    } else if (nb) {
      for (const el of nb.elements) {
        if (el.isTypeOnly) continue;
        const imported = (el.propertyName ?? el.name).text;
        locals.set(el.name.text, el);
        if (imported === 'css' && (own || ctx.isCssModule?.(spec, file))) cssNames.add(el.name.text);
        else if (imported === 'defineTokens' && own) tokenFns.add(el.name.text);
        else if (!own) imports.set(el.name.text, { spec, imported });
      }
    }
    importNodes.push({ node: st, spec, own, locals });
  }

  // --- static evaluation -----------------------------------------------------
  const positions = new WeakMap(); // object -> Map(key -> node)
  const constCache = new Map(); // declaration -> value
  const state = { recovered: null }; // StaticErrors collected while evaluating one call argument
  const evaluating = new Set();

  const isCssRef = (expr) =>
    (ts.isIdentifier(expr) && cssNames.has(expr.text)) ||
    (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && nsNames.has(expr.expression.text) && expr.name.text === 'css');
  const isTokenFn = (expr) =>
    (ts.isIdentifier(expr) && tokenFns.has(expr.text)) ||
    (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && nsNames.has(expr.expression.text) && expr.name.text === 'defineTokens');
  function lookup(id) {
    const name = id.text;
    for (let n = id.parent; n; n = n.parent) {
      if (ts.isFunctionLike(n) && n.parameters?.some((p) => bindsName(p.name, name))) {
        throw new StaticError(id, `"${name}" is a function parameter, not a static value`);
      }
      if ((ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) && n.initializer && ts.isVariableDeclarationList(n.initializer)) {
        if (n.initializer.declarations.some((d) => bindsName(d.name, name))) throw new StaticError(id, `"${name}" is a loop variable, not a static value`);
      }
      if (ts.isCatchClause(n) && n.variableDeclaration && bindsName(n.variableDeclaration.name, name)) {
        throw new StaticError(id, `"${name}" is not a static value`);
      }
      const statements = n.statements;
      if (!statements) continue;
      for (const st of statements) {
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === name) {
              if (!(st.declarationList.flags & ts.NodeFlags.Const)) {
                throw new StaticError(id, `"${name}" is declared with let/var; only const bindings can be used in styles`);
              }
              if (!d.initializer) throw new StaticError(id, `"${name}" has no initializer`);
              return { decl: d };
            }
            if (!ts.isIdentifier(d.name) && bindsName(d.name, name)) {
              throw new StaticError(id, `"${name}" comes from destructuring; use a plain const binding or member access`);
            }
          }
        } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name?.text === name) {
          throw new StaticError(id, `"${name}" is a ${ts.SyntaxKind[st.kind].replace('Declaration', '').toLowerCase()}, not a static value`);
        }
      }
    }
    if (imports.has(name)) return { import: imports.get(name) };
    throw new StaticError(id, `"${name}" is not a static value (for runtime values, set a CSS custom property through the style prop and read it with var())`);
  }

  function resolveIdentifier(id) {
    if (id.text === 'undefined') return undefined;
    const found = lookup(id);
    if (found.import) {
      const { spec, imported } = found.import;
      const exportsObj = ctx.resolveStatic(spec, file);
      if (!exportsObj) {
        throw new StaticError(
          id,
          `"${id.text}" is imported from "${spec}", which is not statically known; styles may only use the tokens module, literals and const bindings in the same file`,
        );
      }
      if (imported === '*') return exportsObj;
      if (!Object.hasOwn(exportsObj, imported)) throw new StaticError(id, `"${spec}" has no static export "${imported}"`);
      return exportsObj[imported];
    }
    const d = found.decl;
    if (constCache.has(d)) return constCache.get(d);
    if (evaluating.has(d)) throw new StaticError(id, `"${id.text}" refers to itself`);
    evaluating.add(d);
    const v = ev(d.initializer);
    evaluating.delete(d);
    constCache.set(d, v);
    return v;
  }

  function member(obj, key, node) {
    if (obj === null || obj === undefined || typeof obj !== 'object') throw new StaticError(node, `cannot read "${key}" of ${obj === null ? 'null' : typeof obj}`);
    if (!Object.hasOwn(obj, key)) throw new StaticError(node, `unknown property "${key}"${isTokenish(node) ? ' (no such token)' : ''}`);
    return obj[key];
  }

  const isTokenish = (node) => /^[\w$]+(\.[\w$]+)+/.test(node.getText(sf));

  function propKey(name) {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
    if (ts.isNumericLiteral(name)) return String(Number(name.text));
    if (ts.isComputedPropertyName(name)) {
      const k = ev(name.expression);
      if (typeof k !== 'string' && typeof k !== 'number') throw new StaticError(name, 'computed keys must be strings or numbers');
      return String(k);
    }
    throw new StaticError(name, 'unsupported property name');
  }

  function property(p, out, where) {
    if (ts.isPropertyAssignment(p)) {
      const k = propKey(p.name);
      out[k] = ev(p.initializer);
      where.set(k, p);
    } else if (ts.isShorthandPropertyAssignment(p)) {
      out[p.name.text] = resolveIdentifier(p.name);
      where.set(p.name.text, p);
    } else if (ts.isSpreadAssignment(p)) {
      const v = ev(p.expression);
      if (v === null || v === undefined) return;
      if (typeof v !== 'object' || Array.isArray(v)) throw new StaticError(p, 'only objects can be spread into a style');
      const inner = positions.get(v);
      for (const k of Object.keys(v)) {
        out[k] = v[k];
        where.set(k, inner?.get(k) ?? p);
      }
    } else {
      throw new StaticError(p, 'methods, getters and setters are not allowed in static styles');
    }
  }

  function ev(node) {
    const K = ts.SyntaxKind;
    switch (node.kind) {
      case K.StringLiteral:
      case K.NoSubstitutionTemplateLiteral:
        return node.text;
      case K.NumericLiteral:
        return Number(node.text);
      case K.TrueKeyword:
        return true;
      case K.FalseKeyword:
        return false;
      case K.NullKeyword:
        return null;
      case K.Identifier:
        return resolveIdentifier(node);
      case K.ParenthesizedExpression:
      case K.AsExpression:
      case K.SatisfiesExpression:
      case K.NonNullExpression:
      case K.TypeAssertionExpression:
        return ev(node.expression);
      case K.PrefixUnaryExpression: {
        const v = ev(node.operand);
        if (typeof v !== 'number') throw new StaticError(node, 'unary operators only apply to numbers');
        if (node.operator === K.MinusToken) return -v;
        if (node.operator === K.PlusToken) return v;
        throw new StaticError(node, 'unsupported unary operator');
      }
      case K.TemplateExpression: {
        let s = node.head.text;
        for (const span of node.templateSpans) {
          const v = ev(span.expression);
          if (typeof v !== 'string' && typeof v !== 'number') throw new StaticError(span.expression, 'template substitutions must be strings or numbers');
          s += String(v) + span.literal.text;
        }
        return s;
      }
      case K.ObjectLiteralExpression: {
        const out = {};
        const where = new Map();
        for (const p of node.properties) {
          if (!state.recovered) {
            property(p, out, where);
            continue;
          }
          // Inside a css.* argument: report every non-static property, not only the first.
          try {
            property(p, out, where);
          } catch (err) {
            if (!(err instanceof StaticError)) throw err;
            state.recovered.push(err);
          }
        }
        positions.set(out, where);
        return out;
      }
      case K.ArrayLiteralExpression: {
        const out = [];
        for (const el of node.elements) {
          if (ts.isSpreadElement(el)) {
            const v = ev(el.expression);
            if (!Array.isArray(v)) throw new StaticError(el, 'only arrays can be spread into an array');
            out.push(...v);
          } else out.push(ev(el));
        }
        return out;
      }
      case K.CallExpression: {
        // css.keyframes(…) evaluates to its generated animation name.
        const callee = node.expression;
        if (ts.isPropertyAccessExpression(callee) && isCssRef(callee.expression) && callee.name.text === 'keyframes' && node.arguments.length === 1) {
          try {
            return keyframesName(normalizeKeyframes(ev(node.arguments[0])), ctx.naming);
          } catch (err) {
            if (err instanceof PurserError) throw new StaticError(node, err.message);
            throw err;
          }
        }
        // defineTokens(…) evaluates to the token object it returns (a tokens module is read without running it).
        if (isTokenFn(callee) && node.arguments.length === 1) {
          try {
            return defineTokens(ev(node.arguments[0]));
          } catch (err) {
            if (err instanceof TypeError) throw new StaticError(node, err.message);
            throw err;
          }
        }
        throw new StaticError(node, `${describe(ts, node)} is not static; styles may only contain literals, tokens, const bindings and css.keyframes(…) names`);
      }
      case K.PropertyAccessExpression:
        return member(ev(node.expression), node.name.text, node);
      case K.ElementAccessExpression: {
        const k = ev(node.argumentExpression);
        if (typeof k !== 'string' && typeof k !== 'number') throw new StaticError(node.argumentExpression, 'element access keys must be strings or numbers');
        return member(ev(node.expression), String(k), node);
      }
      default:
        throw new StaticError(node, `${describe(ts, node)} is not static; styles may only contain literals, tokens and const bindings (use a CSS custom property for runtime values)`);
    }
  }

  // --- one walk: parent links, and the nodes that can matter, in source order -----------------------------------
  /** Identifiers bound to `css`, property accesses (with a namespace import) and calls. */
  const candidates = [];
  /** Every identifier of the file (kept for the compiler, which asks where a few names are referred to). */
  const identifiers = [];
  const keepIdentifiers = ctx.nodes === true;
  if (always || cssNames.size > 0 || nsNames.size > 0 || tokenFns.size > 0) {
    const K = ts.SyntaxKind;
    const watchAccess = nsNames.size > 0;
    let current = sf;
    const step = (node) => {
      node.parent = current;
      const kind = node.kind;
      if (kind === K.Identifier) {
        if (keepIdentifiers) identifiers.push(node);
        if (cssNames.has(node.text)) candidates.push(node);
      } else if (kind === K.CallExpression || (watchAccess && kind === K.PropertyAccessExpression)) candidates.push(node);
      const saved = current;
      current = node;
      ts.forEachChild(node, step);
      current = saved;
    };
    ts.forEachChild(sf, step);
  }

  return { ts, sf, pos, cssNames, nsNames, tokenFns, imports, importNodes, positions, state, isCssRef, isTokenFn, lookup, ev, candidates, identifiers };
}

/**
 * Extract every style call from one file.
 * @param {string} file absolute path
 * @param {string} text file contents
 * @param {ExtractContext} ctx
 * @returns {{ calls: import('../compile/stylesheet.js').Call[], diagnostics: import('../compile/stylesheet.js').Diagnostic[] }}
 */
export function extractFile(file, text, ctx) {
  const scope = createScope(file, text, ctx);
  const { ts, sf, pos, cssNames, nsNames, positions, state, isCssRef, ev } = scope;
  const diagnostics = [];
  const calls = [];
  const propsCalls = [];
  const tokenCalls = [];
  if (cssNames.size === 0 && nsNames.size === 0 && !(ctx.nodes && scope.tokenFns.size)) {
    return ctx.nodes ? { calls, diagnostics, propsCalls, tokenCalls, scope } : { calls, diagnostics };
  }

  // --- find calls --------------------------------------------------------------
  const inspect = (node) => {
    if (ctx.nodes && ts.isCallExpression(node) && node.arguments.length === 1 && scope.isTokenFn(node.expression)) {
      try {
        tokenCalls.push({ node, value: ev(node) });
      } catch (err) {
        if (!(err instanceof StaticError)) throw err; // not static: the call stays as it is
      }
    }
    if (ts.isIdentifier(node) && cssNames.has(node.text) && !isImportPart(ts, node) && !isPropertyName(ts, node)) checkUse(node);
    if (ts.isPropertyAccessExpression(node) && nsNames.size && isCssRef(node)) checkUse(node);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && isCssRef(node.expression.expression)) {
      const kind = node.expression.name.text;
      if (kind === 'props' && ctx.nodes) propsCalls.push(node);
      if (KINDS.has(kind)) {
        const at = pos(node);
        const max = kind === 'globals' ? 2 : 1;
        if (node.arguments.length < 1 || node.arguments.length > max) {
          const takes = max === 2 ? 'one argument and an optional options object' : 'exactly one argument';
          diagnostics.push({ severity: 'error', message: `css.${kind} takes ${takes}`, file, ...at });
        } else {
          const arg = node.arguments[0];
          state.recovered = [];
          try {
            const value = ev(arg);
            const call = { kind, value, file, ...at, locate: (path) => locate(value, arg, path) };
            if (node.arguments.length === 2) call.options = ev(node.arguments[1]);
            if (ctx.nodes) call.node = node;
            calls.push(call);
          } catch (err) {
            if (!(err instanceof StaticError)) throw err;
            state.recovered.push(err);
          }
          for (const err of state.recovered) diagnostics.push({ severity: 'error', message: `css.${kind}: ${err.message}`, file, ...pos(err.node) });
          state.recovered = null;
        }
      }
    }
  };

  /** Every use of `css` must be a direct css.<api>(…) call, or the build would miss styles. */
  function checkUse(node) {
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node && API.has(parent.name.text)) {
      if (ts.isCallExpression(parent.parent) && parent.parent.expression === parent) return;
      diagnostics.push({ severity: 'error', message: `css.${parent.name.text} must be called directly so the build can see it`, file, ...pos(node) });
      return;
    }
    diagnostics.push({
      severity: 'error',
      message: 'css must be used as css.create(…), css.props(…), css.keyframes(…) or css.globals(…) so the build can see every style',
      file,
      ...pos(node),
    });
  }

  function locate(root, rootNode, path) {
    let node = rootNode;
    let value = root;
    for (const key of path ?? []) {
      const where = value && typeof value === 'object' ? positions.get(value) : undefined;
      if (!where || !where.has(String(key))) break;
      node = where.get(String(key));
      value = value[key];
    }
    return pos(node);
  }

  for (const node of scope.candidates) inspect(node);
  return ctx.nodes ? { calls, diagnostics, propsCalls, tokenCalls, scope } : { calls, diagnostics };
}

/**
 * Read the exports of a module without running it: every `export const` whose value is static, with defineTokens(…)
 * results apart. `ok` is false when the module has anything that only running it can decide (a call, a re-export, a
 * top-level statement), and the caller then loads it for real.
 * @param {string} file absolute path
 * @param {string} text file contents
 * @param {{ ts: any, packageName: string }} ctx
 * @returns {{ ok: boolean, sets: { name: string, def: { axes: object, tokens: object } }[], statics: Record<string, unknown> }}
 */
export function extractStaticExports(file, text, ctx) {
  const failed = { ok: false, sets: [], statics: {} };
  let scope;
  try {
    scope = createScope(file, text, { ...ctx, resolveStatic: () => undefined, naming: ctx.naming ?? { prefix: 'x', salt: '', names: 'legacy' } }, true);
  } catch {
    return failed;
  }
  const { ts, sf, ev } = scope;
  const K = ts.SyntaxKind;
  const sets = [];
  const statics = {};
  const publish = (name, value) => {
    if (value && typeof value === 'object' && value[TOKENS]) sets.push({ name, def: value[TOKENS] });
    else statics[name] = value;
  };
  const exported = (st) => st.modifiers?.some((m) => m.kind === K.ExportKeyword) ?? false;
  const notData = (init) => ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isClassExpression(init);
  try {
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) {
        // a side-effect import runs code this reader cannot see
        if (!st.importClause) return failed;
        continue;
      }
      if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || st.kind === K.EmptyStatement) continue;
      if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) continue; // never plain data, exported or not
      if (ts.isVariableStatement(st)) {
        if (!exported(st)) continue; // read on demand when an export refers to it
        if (!(st.declarationList.flags & ts.NodeFlags.Const)) return failed;
        for (const d of st.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !d.initializer) return failed;
          if (notData(d.initializer)) continue;
          publish(d.name.text, ev(d.name));
        }
        continue;
      }
      if (ts.isExportDeclaration(st)) {
        if (st.isTypeOnly) continue;
        if (st.moduleSpecifier || !st.exportClause || !ts.isNamedExports(st.exportClause)) return failed;
        for (const el of st.exportClause.elements) {
          if (el.isTypeOnly) continue;
          publish(el.name.text, ev(el.propertyName ?? el.name));
        }
        continue;
      }
      if (ts.isExportAssignment(st)) {
        if (st.isExportEquals || notData(st.expression)) return failed;
        publish('default', ev(st.expression));
        continue;
      }
      return failed;
    }
  } catch (err) {
    if (err instanceof StaticError) return failed;
    throw err;
  }
  return { ok: true, sets, statics };
}

function bindsName(binding, name) {
  if (!binding) return false;
  if (binding.kind === undefined) return false;
  if (binding.escapedText !== undefined) return binding.text === name;
  if (binding.elements) return binding.elements.some((e) => e.name && bindsName(e.name, name));
  return false;
}

export function isPropertyName(ts, node) {
  const p = node.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === node) ||
    (ts.isPropertyAssignment(p) && p.name === node) ||
    (ts.isQualifiedName(p) && p.right === node) ||
    ts.isTypeQueryNode(p)
  );
}

export function isImportPart(ts, node) {
  for (let n = node.parent; n; n = n.parent) if (ts.isImportDeclaration(n)) return true;
  return false;
}

function describe(ts, node) {
  const kind = ts.SyntaxKind[node.kind];
  const names = {
    CallExpression: 'a function call',
    BinaryExpression: 'an operator expression',
    ConditionalExpression: 'a conditional (?:) expression',
    ArrowFunction: 'a function',
    FunctionExpression: 'a function',
  };
  return names[kind] ?? `${kind.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`;
}
