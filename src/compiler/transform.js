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
 * What a module compiles to, before any class has its final name: plain data, so the build can keep it in its cache,
 * hand it to a worker thread and read every group of classes the module applies from it.
 * @typedef {object} ModuleRecord
 * @property {{ start: number, end: number, text: string }[]} edits  replacements that need no class name
 * @property {{ start: number, end: number, guards: { text: string, simple: boolean, top: boolean }[], always: string[], groups: [string, string[]][] }[]} sites
 *   folded css.props calls: the classes every outcome has, and those that appear under the same assignments of the
 *   guards (the key has one character per assignment: "1" when the group is present)
 * @property {{ start: number, end: number, styles: Record<string, Record<string, string | null>> }[]} maps
 *   css.create calls that stay, as class maps (style -> merge key -> class ids)
 * @property {{ create: number, folded: number, dynamic: number, keyframes: number, globals: number, tokens: number }} stats
 */

/**
 * Compile one module.
 * @param {string} code
 * @param {string} file absolute path
 * @param {TransformContext} ctx  ctx.resolve: the final names of a group of class ids (default: the ids themselves)
 * @returns {null | { code: string, map: object, stats: ModuleRecord['stats'] }}
 *   null when the module has nothing to compile (or has an error the stylesheet build reports)
 */
export function transformSource(code, file, ctx) {
  let found;
  try {
    found = extractFile(file, code, { ...ctx, nodes: true });
  } catch {
    return null;
  }
  const record = analyzeModule(found, code, file, ctx);
  return record && emitModule(code, file, record, ctx.resolve);
}

/**
 * Everything the compiler does to a module except naming its classes.
 * @param {ReturnType<typeof extractFile>} found  an extraction with `nodes: true`
 * @param {string} code
 * @param {string} file
 * @param {TransformContext} ctx  ctx.css computes class ids (the names before the build renames them)
 * @returns {ModuleRecord | null}
 */
export function analyzeModule(found, code, file, ctx) {
  const { ts } = ctx;
  const { calls, diagnostics, propsCalls, tokenCalls, scope } = found;
  if (diagnostics.length) return null;
  if (calls.length === 0 && propsCalls.length === 0 && tokenCalls.length === 0) return null;
  const { sf } = scope;
  const K = ts.SyntaxKind;
  const stats = { create: 0, folded: 0, dynamic: 0, keyframes: 0, globals: 0, tokens: 0 };
  /** @type {ModuleRecord['sites']} */
  const sites = [];
  /** @type {ModuleRecord['maps']} */
  const maps = [];

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
    sites.push({ start: call.getStart(sf), end: call.getEnd(), guards, ...groupOutcomes(outcomes) });
    for (const node of guardNodes) kept.push({ start: node.getStart(sf), end: node.getEnd() });
    stats.folded++;
  }

  // --- references that are left ----------------------------------------------------------------------------------------
  // What is certain to be rewritten: the edits so far, and every css.create call (removed with its statement or
  // replaced by its class maps, decided below from the references that are left).
  const gone = [...edits.map((e) => [e.start, e.end]), ...sites.map((e) => [e.start, e.end]), ...creates.map((c) => [c.node.getStart(sf), c.node.getEnd()])].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
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
  // Only two kinds of names are ever asked about: the css.create bindings and what the removable imports bind.
  const asked = new Set(creates.map((c) => c.decl?.name.text).filter(Boolean));
  for (const imp of scope.importNodes) for (const [local] of imp.locals) asked.add(local);
  for (const node of scope.identifiers) {
    if (!asked.has(node.text) || isPropertyName(ts, node) || isImportPart(ts, node) || isDeclarationName(ts, node)) continue;
    let r = refs.get(node.text);
    if (!r) refs.set(node.text, (r = { all: 0, left: 0 }));
    r.all++;
    const pos = node.getStart(sf);
    if (!inEdit(pos) || kept.some((k) => pos >= k.start && pos < k.end)) r.left++;
  }
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
      maps.push({ start: record.node.getStart(sf), end: record.node.getEnd(), styles: record.maps });
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

  return { edits, sites, maps, stats };
}

/**
 * Write a compiled module: the record's replacements, with every group of class ids under its final names.
 * @param {string} code  the source the record was made from
 * @param {string} file
 * @param {ModuleRecord} record
 * @param {(ids: string[]) => string[]} [resolve]  the classes a group of class ids is written as (default: the ids)
 * @returns {{ code: string, map: object, stats: ModuleRecord['stats'] }}
 */
export function emitModule(code, file, record, resolve = (ids) => ids) {
  const edits = [...record.edits];
  for (const site of record.sites) edits.push({ start: site.start, end: site.end, text: renderSite(site, resolve) });
  for (const m of record.maps) {
    const styles = {};
    for (const name of Object.keys(m.styles)) {
      const out = (styles[name] = {});
      for (const key of Object.keys(m.styles[name])) {
        const ids = m.styles[name][key];
        out[key] = ids === null ? null : resolve(ids.split(' ')).join(' ');
      }
    }
    edits.push({ start: m.start, end: m.end, text: `${HELPER_STYLES}(${JSON.stringify(styles)})` });
  }
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
  return { code: out, map, stats: record.stats };
}

/**
 * Every group of class ids a module applies whole: what the build plans fused classes from.
 * @param {ModuleRecord} record
 * @returns {string[][]}
 */
export function moduleContexts(record) {
  const out = [];
  for (const site of record.sites) {
    if (site.always.length) out.push(site.always);
    for (const [, ids] of site.groups) out.push(ids);
  }
  for (const m of record.maps) {
    for (const name of Object.keys(m.styles)) {
      for (const key of Object.keys(m.styles[name])) {
        const ids = m.styles[name][key];
        if (ids) out.push(ids.split(' '));
      }
    }
  }
  return out;
}

const HELPER_PROPS = '_purserProps';
const HELPER_STYLES = '_purserStyles';

/**
 * The classes of a css.props call by where they appear: in every outcome, or under the same assignments of the guards.
 * @param {string[][]} outcomes class ids per assignment of the guards (bit i of the index: guard i is truthy)
 * @returns {{ always: string[], groups: [string, string[]][] }}
 */
export function groupOutcomes(outcomes) {
  const count = outcomes.length;
  if (count === 1) return { always: [...new Set(outcomes[0])], groups: [] };
  // id -> one character per outcome, "1" where the id is present; ids in order of first appearance
  const presence = new Map();
  for (let bits = 0; bits < count; bits++) {
    for (const id of outcomes[bits]) {
      let marks = presence.get(id);
      if (!marks) presence.set(id, (marks = new Array(count).fill('0')));
      marks[bits] = '1';
    }
  }
  const everywhere = '1'.repeat(count);
  const always = [];
  const groups = new Map(); // presence key -> ids
  for (const [id, marks] of presence) {
    const key = marks.join('');
    if (key === everywhere) always.push(id);
    else {
      const g = groups.get(key);
      if (g) g.push(id);
      else groups.set(key, [id]);
    }
  }
  return { always, groups: [...groups] };
}

// Class order decides nothing (no two classes of one element set the same property), so every list is written in one
// fixed order, shortest names first: lists of different components then start alike, which compresses better in the
// JavaScript and in the HTML it renders.
const byName = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/**
 * One string expression for every outcome of a css.props call.
 * @param {ModuleRecord['sites'][number]} site
 * @param {(ids: string[]) => string[]} resolve
 */
function renderSite(site, resolve) {
  const { guards } = site;
  const count = 1 << guards.length;
  const always = site.always.length ? [...resolve(site.always)].sort(byName) : [];
  if (count === 1) return JSON.stringify(always.join(' '));
  const groups = site.groups.map(([key, ids]) => ({ key, text: ` ${[...resolve(ids)].sort(byName).join(' ')}` }));
  // A guard that runs code is evaluated once, where the call was, and passed in; the others are read in place.
  const hoist = guards.some((g) => !g.simple);
  const ref = (i) => (hoist && guards[i].top ? `_${i}` : `(${guards[i].text})`);
  const present = (g, bits) => g.key.charCodeAt(bits) === 49;
  /** Among the assignments that agree with `base` on the guards before i: is the group always there, never, or both? */
  const fixedAt = (g, i, base) => {
    const mask = (1 << i) - 1;
    let first = null;
    for (let bits = 0; bits < count; bits++) {
      if ((bits & mask) !== base) continue;
      const p = present(g, bits);
      if (first === null) first = p;
      else if (p !== first) return null;
    }
    return first;
  };
  /** Among those assignments: does guard i change whether the group is there? */
  const dependsOn = (g, i, base) => {
    const mask = (1 << i) - 1;
    const bit = 1 << i;
    for (let bits = 0; bits < count; bits++) {
      if ((bits & mask) !== base || bits & bit) continue;
      if (present(g, bits) !== present(g, bits | bit)) return true;
    }
    return false;
  };
  // One test per guard: every group whose presence hangs on a guard goes into that guard's one conditional, so a
  // guard is read once per path however many groups it decides. Each part is "" or starts with a space.
  const build = (list, i, base) => {
    let fixed = '';
    let open = [];
    for (const g of list) {
      const state = fixedAt(g, i, base);
      if (state === null) open.push(g);
      else if (state) fixed += g.text;
    }
    const parts = fixed ? [JSON.stringify(fixed)] : [];
    for (let j = i; open.length; j++) {
      const dependent = open.filter((g) => dependsOn(g, j, base));
      if (!dependent.length) continue;
      parts.push(`(${ref(j)}?${build(dependent, j + 1, base | (1 << j))}:${build(dependent, j + 1, base)})`);
      // a group that guard j does not decide is the same with the guard off: go on with the next guard
      open = open.filter((g) => !dependent.includes(g));
    }
    return parts.length ? parts.join('+') : '""';
  };
  const rest = build(groups, 0, 0);
  // Without a fixed part in front the first space is cut off.
  const body = always.length ? `(${JSON.stringify(always.join(' '))}+${rest})` : `(${rest}).slice(1)`;
  if (!hoist) return body;
  const params = guards.map((g, i) => (g.top ? `_${i}` : null)).filter(Boolean);
  const args = guards.filter((g) => g.top).map((g) => g.text);
  return `((${params.join(',')})=>${body})(${args.join(',')})`;
}

/**
 * One string expression for every outcome of a css.props call.
 * @param {string[][]} outcomes class names per assignment of the guards (bit i of the index: guard i is truthy)
 * @param {{ text: string, simple: boolean, top: boolean }[]} guards
 */
export function foldOutcomes(outcomes, guards) {
  return renderSite({ start: 0, end: 0, guards, ...groupOutcomes(outcomes) }, (ids) => ids);
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
