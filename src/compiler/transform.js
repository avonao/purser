// The compiler: rewrite one source module so that the browser runs no style code.
//
//   css.create({ … })              → the class names it would compute, or nothing when every use was folded
//   css.props(s.a, on && s.b)      → "x1 x2"+(on?" x3":" x4")   (a string expression, no function call)
//   css.props(s.a, props.style)    → props(s.a, props.style)     (the merge alone, from @avonao/purser/compiled)
//   css.keyframes({ … })           → "x1abc234"
//   css.globals({ … })             → removed (the stylesheet has the rules)
//   defineTokens({ … })            → { color: { text: "var(--color-text)" }, … }
//
// The result is computed with the runtime itself, so a compiled module and an uncompiled one always agree. Line breaks
// are kept (a replacement is padded with the line breaks it removed), so the source map is one segment per line.
//
// Build-only module.

import { isImportPart, isPropertyName, extractFile } from '../build/extract.js';
import { PurserError } from '../errors.js';

/** Most guards a css.props call may have and still be folded (2^n class lists are computed). */
const MAX_GUARDS = 6;

/**
 * @typedef {object} TransformContext
 * @property {any} ts
 * @property {string} packageName
 * @property {(spec: string, fromFile: string) => any} resolveStatic
 * @property {(spec: string, fromFile: string) => boolean} [isCssModule]
 * @property {{ prefix: string, salt: string, names: string, granularity: string }} naming
 * @property {{ create: Function, props: Function, keyframes: Function }} css   createCss(naming)
 * @property {(spec: string, fromFile: string) => boolean} [isPure]
 *   may an import that nothing refers to any more be removed? (the package, the css module and the tokens module)
 */

/**
 * @param {string} code
 * @param {string} file absolute path
 * @param {TransformContext} ctx
 * @returns {null | { code: string, map: object, stats: { create: number, folded: number, dynamic: number, keyframes: number, globals: number, tokens: number } }}
 *   null when the module has nothing to compile (or has an error the stylesheet build reports)
 */
export function transformSource(code, file, ctx) {
  const { ts } = ctx;
  let found;
  try {
    found = extractFile(file, code, { ...ctx, nodes: true });
  } catch {
    return null;
  }
  const { calls, diagnostics, propsCalls, tokenCalls, scope } = found;
  if (diagnostics.length) return null;
  if (calls.length === 0 && propsCalls.length === 0 && tokenCalls.length === 0) return null;
  const { sf } = scope;
  const K = ts.SyntaxKind;
  const stats = { create: 0, folded: 0, dynamic: 0, keyframes: 0, globals: 0, tokens: 0 };

  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  const replace = (node, text) => edits.push({ start: node.getStart(sf), end: node.getEnd(), text });

  // --- css.create: class maps, by binding ------------------------------------------------------------------------------
  /** declaration node -> { name, maps, call, node } for `const s = css.create(…)` */
  const bindings = new Map();
  const creates = [];
  try {
    for (const call of calls) {
      if (call.kind === 'create') {
        const maps = ctx.css.create(call.value);
        const decl = unwrapParent(call.node);
        const record = { maps, node: call.node, decl: null };
        if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name) && decl.parent.flags & ts.NodeFlags.Const) {
          record.decl = decl;
          bindings.set(decl, record);
        }
        creates.push(record);
      } else if (call.kind === 'keyframes') {
        replace(call.node, JSON.stringify(ctx.css.keyframes(call.value)));
        stats.keyframes++;
      } else if (call.kind === 'globals') {
        const st = call.node.parent;
        // A statement of its own is removed; anywhere else the call evaluates to undefined, as it does at run time.
        if (ts.isExpressionStatement(st)) replace(st, '');
        else replace(call.node, 'void 0');
        stats.globals++;
      }
    }
  } catch (err) {
    if (err instanceof PurserError) return null; // the stylesheet build reports it with its position
    throw err;
  }
  function unwrapParent(node) {
    let p = node.parent;
    while (p && (p.kind === K.ParenthesizedExpression || p.kind === K.AsExpression || p.kind === K.SatisfiesExpression || p.kind === K.NonNullExpression)) p = p.parent;
    return p;
  }

  // --- defineTokens ----------------------------------------------------------------------------------------------------
  for (const t of tokenCalls) {
    replace(t.node, `(${JSON.stringify(t.value)})`);
    stats.tokens++;
  }

  // --- css.props -------------------------------------------------------------------------------------------------------
  const strip = (node) => {
    let n = node;
    while (n.kind === K.ParenthesizedExpression || n.kind === K.AsExpression || n.kind === K.SatisfiesExpression || n.kind === K.NonNullExpression) n = n.expression;
    return n;
  };
  /** The class map a `s.name` expression refers to, when `s` is a css.create binding of this file. */
  const styleOf = (node) => {
    let object;
    let name;
    if (ts.isPropertyAccessExpression(node) && !node.questionDotToken) {
      object = node.expression;
      name = node.name.text;
    } else if (ts.isElementAccessExpression(node) && !node.questionDotToken && ts.isStringLiteralLike(node.argumentExpression)) {
      object = node.expression;
      name = node.argumentExpression.text;
    } else return null;
    if (!ts.isIdentifier(object)) return null;
    let found;
    try {
      found = scope.lookup(object);
    } catch {
      return null;
    }
    const binding = found.decl && bindings.get(found.decl);
    if (!binding || !Object.hasOwn(binding.maps, name)) return null;
    return binding.maps[name];
  };

  const SIMPLE_BINARY = new Set([
    K.EqualsEqualsEqualsToken, K.ExclamationEqualsEqualsToken, K.EqualsEqualsToken, K.ExclamationEqualsToken, K.LessThanToken, K.GreaterThanToken,
    K.LessThanEqualsToken, K.GreaterThanEqualsToken, K.AmpersandAmpersandToken, K.BarBarToken, K.QuestionQuestionToken, K.PlusToken, K.MinusToken,
    K.AsteriskToken, K.SlashToken, K.PercentToken, K.InKeyword, K.InstanceOfKeyword,
  ]);
  /** Can the expression be evaluated again (or not at all) without anyone noticing? Reads and operators only. */
  const isSimple = (node) => {
    switch (node.kind) {
      case K.Identifier:
      case K.ThisKeyword:
      case K.StringLiteral:
      case K.NoSubstitutionTemplateLiteral:
      case K.NumericLiteral:
      case K.TrueKeyword:
      case K.FalseKeyword:
      case K.NullKeyword:
        return true;
      case K.ParenthesizedExpression:
      case K.AsExpression:
      case K.SatisfiesExpression:
      case K.NonNullExpression:
        return isSimple(node.expression);
      case K.PropertyAccessExpression:
        return isSimple(node.expression);
      case K.ElementAccessExpression:
        return isSimple(node.expression) && isSimple(node.argumentExpression);
      case K.PrefixUnaryExpression:
        return (node.operator === K.ExclamationToken || node.operator === K.MinusToken || node.operator === K.PlusToken) && isSimple(node.operand);
      case K.TypeOfExpression:
        return isSimple(node.expression);
      case K.BinaryExpression:
        return SIMPLE_BINARY.has(node.operatorToken.kind) && isSimple(node.left) && isSimple(node.right);
      case K.ConditionalExpression:
        return isSimple(node.condition) && isSimple(node.whenTrue) && isSimple(node.whenFalse);
      default:
        return false;
    }
  };

  /** Guard expressions of folded calls: their text is written again, so what they refer to is still referred to. */
  const kept = [];
  for (const call of propsCalls) {
    const guards = []; // { text, simple, top }
    const byText = new Map();
    const guardNodes = [];
    const guardOf = (node, top) => {
      guardNodes.push(node);
      const text = node.getText(sf);
      const simple = isSimple(node);
      if (simple) {
        const key = text.replace(/\s+/g, ' ');
        if (byText.has(key)) return byText.get(key);
        const index = guards.push({ text, simple, top }) - 1;
        byText.set(key, index);
        return index;
      }
      if (!top) return -1; // a guard that runs code, evaluated only on some paths: leave the call to the runtime
      return guards.push({ text, simple, top }) - 1;
    };
    /** @returns {null | object} the shape of one argument, or null when only the runtime can decide it */
    const shapeOf = (raw, top) => {
      const node = strip(raw);
      if (node.kind === K.FalseKeyword || node.kind === K.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined')) return { kind: 'none' };
      const map = styleOf(node);
      if (map) return { kind: 'style', map };
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === K.AmpersandAmpersandToken) {
        const guard = guardOf(node.left, top);
        const then = guard === -1 ? null : shapeOf(node.right, false);
        return then && { kind: 'when', guard, then, otherwise: { kind: 'none' } };
      }
      if (ts.isConditionalExpression(node)) {
        const guard = guardOf(node.condition, top);
        const then = guard === -1 ? null : shapeOf(node.whenTrue, false);
        const otherwise = then && shapeOf(node.whenFalse, false);
        return otherwise && { kind: 'when', guard, then, otherwise };
      }
      if (ts.isArrayLiteralExpression(node)) {
        const items = [];
        for (const el of node.elements) {
          const item = ts.isSpreadElement(el) || ts.isOmittedExpression(el) ? null : shapeOf(el, top);
          if (!item) return null;
          items.push(item);
        }
        return { kind: 'list', items };
      }
      return null;
    };

    let shapes = [];
    for (const arg of call.arguments) {
      const shape = ts.isSpreadElement(arg) ? null : shapeOf(arg, true);
      if (!shape || guards.length > MAX_GUARDS) {
        shapes = null;
        break;
      }
      shapes.push(shape);
    }
    if (!shapes) {
      // Only the merge is left for the runtime; the styles it is given are compiled class maps.
      replace(call.expression, HELPER_PROPS);
      stats.dynamic++;
      continue;
    }

    // Every outcome, computed by the runtime itself.
    const count = 1 << guards.length;
    const outcomes = [];
    const pick = (shape, bits, out) => {
      if (shape.kind === 'style') out.push(shape.map);
      else if (shape.kind === 'when') pick(bits & (1 << shape.guard) ? shape.then : shape.otherwise, bits, out);
      else if (shape.kind === 'list') for (const item of shape.items) pick(item, bits, out);
    };
    for (let bits = 0; bits < count; bits++) {
      const selected = [];
      for (const shape of shapes) pick(shape, bits, selected);
      const text = ctx.css.props(...selected);
      outcomes.push(text ? text.split(' ') : []);
    }
    replace(call, foldOutcomes(outcomes, guards));
    for (const node of guardNodes) kept.push({ start: node.getStart(sf), end: node.getEnd() });
    stats.folded++;
  }

  // --- references that are left ----------------------------------------------------------------------------------------
  // What is certain to be rewritten: the edits so far, and every css.create call (removed with its statement or
  // replaced by its class maps, decided below from the references that are left).
  const gone = [...edits.map((e) => [e.start, e.end]), ...creates.map((c) => [c.node.getStart(sf), c.node.getEnd()])].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const spans = [];
  for (const g of gone) {
    const last = spans.at(-1);
    if (last && g[0] < last[1]) last[1] = Math.max(last[1], g[1]);
    else spans.push([...g]);
  }
  const inEdit = (pos) => {
    let lo = 0;
    let hi = spans.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pos < spans[mid][0]) hi = mid - 1;
      else if (pos >= spans[mid][1]) lo = mid + 1;
      else return true;
    }
    return false;
  };
  const refs = new Map(); // name -> { all, left }
  const countRefs = (node) => {
    if (ts.isIdentifier(node) && !isPropertyName(ts, node) && !isImportPart(ts, node) && !isDeclarationName(ts, node)) {
      let r = refs.get(node.text);
      if (!r) refs.set(node.text, (r = { all: 0, left: 0 }));
      r.all++;
      const pos = node.getStart(sf);
      if (!inEdit(pos) || kept.some((k) => pos >= k.start && pos < k.end)) r.left++;
    }
    ts.forEachChild(node, countRefs);
  };
  countRefs(sf);
  const left = (name) => refs.get(name)?.left ?? 0;

  // css.create: gone when nothing refers to the styles any more, otherwise its class maps.
  let needStyles = false;
  for (const record of creates) {
    stats.create++;
    const decl = record.decl;
    const st = decl?.parent.parent;
    const removable =
      decl &&
      left(decl.name.text) === 0 &&
      st &&
      ts.isVariableStatement(st) &&
      st.declarationList.declarations.length === 1 &&
      !st.modifiers?.some((m) => m.kind === K.ExportKeyword) &&
      ts.isSourceFile(st.parent);
    if (removable) replace(st, '');
    else {
      replace(record.node, `${HELPER_STYLES}(${JSON.stringify(record.maps)})`);
      needStyles = true;
    }
  }
  const needProps = stats.dynamic > 0;

  // Imports: drop what only the compiled-away code referred to.
  const helper = [needProps && `props as ${HELPER_PROPS}`, needStyles && `styles as ${HELPER_STYLES}`].filter(Boolean);
  let helperImport = helper.length ? `import { ${helper.join(', ')} } from ${JSON.stringify(`${ctx.packageName}/compiled`)};` : '';
  for (const imp of scope.importNodes) {
    const pure = imp.own || (ctx.isCssModule?.(imp.spec, file) ?? false) || (ctx.isPure?.(imp.spec, file) ?? false);
    if (!pure) continue;
    const clause = imp.node.importClause;
    const keep = [];
    let dropped = false;
    for (const [local, how] of imp.locals) {
      const r = refs.get(local);
      const css = scope.cssNames.has(local);
      // `css` is dropped whenever every call was rewritten; other names only when their last reference went away.
      const unused = css ? left(local) === 0 : r !== undefined && r.all > 0 && r.left === 0;
      if (unused && how !== 'namespace') dropped = true;
      else keep.push([local, how]);
    }
    if (!dropped) continue;
    const typeOnly = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.filter((el) => el.isTypeOnly) : [];
    let text = '';
    if (keep.length || typeOnly.length) {
      const def = keep.find(([, how]) => how === 'default');
      const ns = keep.find(([, how]) => how === 'namespace');
      const named = [...typeOnly.map((el) => el.getText(sf)), ...keep.filter(([, how]) => typeof how === 'object').map(([, el]) => el.getText(sf))];
      const parts = [];
      if (def) parts.push(def[0]);
      if (ns) parts.push(`* as ${ns[0]}`);
      else if (named.length) parts.push(`{ ${named.join(', ')} }`);
      text = `import ${parts.join(', ')} from ${imp.node.moduleSpecifier.getText(sf)};`;
    }
    if (helperImport && (imp.own || ctx.isCssModule?.(imp.spec, file))) {
      text = text ? `${text} ${helperImport}` : helperImport;
      helperImport = '';
    }
    replace(imp.node, text);
  }
  if (helperImport) {
    // No import was rewritten (a namespace import of the package): put the helper right after the last import.
    const last = scope.importNodes.at(-1)?.node;
    const at = last ? last.getEnd() : firstStatementStart(ts, sf);
    edits.push({ start: at, end: at, text: last ? ` ${helperImport}` : `${helperImport} ` });
  }

  // --- write -----------------------------------------------------------------------------------------------------------
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let at = 0;
  for (const e of edits) {
    if (e.start < at) continue; // inside an earlier replacement (a call inside a removed statement)
    const removed = code.slice(e.start, e.end);
    let breaks = 0;
    for (let i = 0; i < removed.length; i++) if (removed.charCodeAt(i) === 10) breaks++;
    out += code.slice(at, e.start) + e.text + '\n'.repeat(breaks);
    at = e.end;
  }
  out += code.slice(at);
  let lines = 1;
  for (let i = 0; i < out.length; i++) if (out.charCodeAt(i) === 10) lines++;
  const map = { version: 3, file, sources: [file], sourcesContent: [code], names: [], mappings: `AAAA${';AACA'.repeat(lines - 1)}` };
  return { code: out, map, stats };
}

const HELPER_PROPS = '_purserProps';
const HELPER_STYLES = '_purserStyles';

/**
 * One string expression for every outcome of a css.props call.
 * @param {string[][]} outcomes class names per assignment of the guards (bit i of the index: guard i is truthy)
 * @param {{ text: string, simple: boolean, top: boolean }[]} guards
 */
export function foldOutcomes(outcomes, guards) {
  const count = outcomes.length;
  const all = new Set(outcomes[0]);
  for (const o of outcomes) for (const c of [...all]) if (!o.includes(c)) all.delete(c);
  // Class order decides nothing (no two classes of one element set the same property), so every list is written in
  // one fixed order, shortest names first: lists of different components then start alike, which compresses better
  // in the JavaScript and in the HTML it renders.
  const byName = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  const always = outcomes[0].filter((c) => all.has(c)).sort(byName);
  if (count === 1) return JSON.stringify(always.join(' '));

  // Class names that appear under the same assignments form one group.
  const groups = new Map(); // presence key -> { present: boolean[], names: string[] }
  for (let bits = 0; bits < count; bits++) {
    for (const name of outcomes[bits]) {
      if (all.has(name)) continue;
      let key = '';
      for (let b = 0; b < count; b++) key += outcomes[b].includes(name) ? '1' : '0';
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { present: [...key].map((c) => c === '1'), names: [] }));
      if (!g.names.includes(name)) g.names.push(name);
    }
  }
  // A guard that runs code is evaluated once, where the call was, and passed in; the others are read in place.
  const hoist = guards.some((g) => !g.simple);
  const ref = (i) => (hoist && guards[i].top ? `_${i}` : `(${guards[i].text})`);
  const expand = (g, i, base) => {
    // Is the group's presence the same for every assignment that agrees with `base` on guards 0..i-1?
    const mask = (1 << i) - 1;
    let first = null;
    let constant = true;
    for (let bits = 0; bits < count && constant; bits++) {
      if ((bits & mask) !== base) continue;
      if (first === null) first = g.present[bits];
      else if (g.present[bits] !== first) constant = false;
    }
    if (constant) return first ? JSON.stringify(` ${[...g.names].sort(byName).join(' ')}`) : '""';
    const yes = expand(g, i + 1, base | (1 << i));
    const no = expand(g, i + 1, base);
    return yes === no ? yes : `(${ref(i)}?${yes}:${no})`;
  };
  const parts = [...groups.values()].map((g) => expand(g, 0, 0));
  // Each part is "" or starts with a space; without a fixed part in front the first space is cut off.
  const body = always.length ? `(${[JSON.stringify(always.join(' ')), ...parts].join('+')})` : `(${parts.join('+')}).slice(1)`;
  if (!hoist) return body;
  const params = guards.map((g, i) => (g.top ? `_${i}` : null)).filter(Boolean);
  const args = guards.filter((g) => g.top).map((g) => g.text);
  return `((${params.join(',')})=>${body})(${args.join(',')})`;
}

function isDeclarationName(ts, node) {
  const p = node.parent;
  return (
    ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isFunctionExpression(p)) &&
      p.name === node) ||
    (ts.isBindingElement(p) && p.propertyName === node)
  );
}

function firstStatementStart(ts, sf) {
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) continue; // 'use client'
    return st.getStart(sf);
  }
  return sf.getEnd();
}
