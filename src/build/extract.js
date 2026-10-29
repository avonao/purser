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
 */

import { keyframesName, normalizeKeyframes } from '../normalize.js';
import { PurserError } from '../errors.js';

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

/**
 * Extract every style call from one file.
 * @param {string} file absolute path
 * @param {string} text file contents
 * @param {ExtractContext} ctx
 * @returns {{ calls: import('../compile/stylesheet.js').Call[], diagnostics: import('../compile/stylesheet.js').Diagnostic[] }}
 */
export function extractFile(file, text, ctx) {
  const { ts } = ctx;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file));
  const pos = (node) => {
    const p = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return { line: p.line + 1, column: p.character + 1 };
  };
  const diagnostics = [];
  const calls = [];

  // --- imports ---------------------------------------------------------------
  const cssNames = new Set(); // local names bound to the package's `css`
  const nsNames = new Set(); // namespace imports of the package
  const imports = new Map(); // local -> { spec, imported } ('*' for namespace, 'default')
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const clause = st.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const spec = st.moduleSpecifier.text;
    const own = spec === ctx.packageName;
    if (clause.name) imports.set(clause.name.text, { spec, imported: 'default' });
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) {
      if (own) nsNames.add(nb.name.text);
      else imports.set(nb.name.text, { spec, imported: '*' });
    } else if (nb) {
      for (const el of nb.elements) {
        if (el.isTypeOnly) continue;
        const imported = (el.propertyName ?? el.name).text;
        if (imported === 'css' && (own || ctx.isCssModule?.(spec, file))) cssNames.add(el.name.text);
        else if (!own) imports.set(el.name.text, { spec, imported });
      }
    }
  }
  if (cssNames.size === 0 && nsNames.size === 0) return { calls, diagnostics };

  // --- static evaluation -----------------------------------------------------
  const positions = new WeakMap(); // object -> Map(key -> node)
  const constCache = new Map(); // declaration -> value
  let recovered = null; // StaticErrors collected while evaluating one call argument
  const evaluating = new Set();

  const isCssRef = (expr) =>
    (ts.isIdentifier(expr) && cssNames.has(expr.text)) ||
    (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && nsNames.has(expr.expression.text) && expr.name.text === 'css');

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
          if (!recovered) {
            property(p, out, where);
            continue;
          }
          // Inside a css.* argument: report every non-static property, not only the first.
          try {
            property(p, out, where);
          } catch (err) {
            if (!(err instanceof StaticError)) throw err;
            recovered.push(err);
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

  // --- find calls --------------------------------------------------------------
  const visit = (node) => {
    if (ts.isIdentifier(node) && cssNames.has(node.text) && !isImportPart(ts, node) && !isPropertyName(ts, node)) checkUse(node);
    if (ts.isPropertyAccessExpression(node) && nsNames.size && isCssRef(node)) checkUse(node);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && isCssRef(node.expression.expression)) {
      const kind = node.expression.name.text;
      if (KINDS.has(kind)) {
        const at = pos(node);
        if (node.arguments.length !== 1) {
          diagnostics.push({ severity: 'error', message: `css.${kind} takes exactly one argument`, file, ...at });
        } else {
          const arg = node.arguments[0];
          recovered = [];
          try {
            const value = ev(arg);
            calls.push({ kind, value, file, ...at, locate: (path) => locate(value, arg, path) });
          } catch (err) {
            if (!(err instanceof StaticError)) throw err;
            recovered.push(err);
          }
          for (const err of recovered) diagnostics.push({ severity: 'error', message: `css.${kind}: ${err.message}`, file, ...pos(err.node) });
          recovered = null;
        }
      }
    }
    ts.forEachChild(node, visit);
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

  visit(sf);
  return { calls, diagnostics };
}

function bindsName(binding, name) {
  if (!binding) return false;
  if (binding.kind === undefined) return false;
  if (binding.escapedText !== undefined) return binding.text === name;
  if (binding.elements) return binding.elements.some((e) => e.name && bindsName(e.name, name));
  return false;
}

function isPropertyName(ts, node) {
  const p = node.parent;
  return (
    (ts.isPropertyAccessExpression(p) && p.name === node) ||
    (ts.isPropertyAssignment(p) && p.name === node) ||
    (ts.isQualifiedName(p) && p.right === node) ||
    ts.isTypeQueryNode(p)
  );
}

function isImportPart(ts, node) {
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
