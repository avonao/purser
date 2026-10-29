// Rendering of rule lists into CSS text. Rules sharing at-rule preludes are
// nested under one block; insertion order is preserved (callers sort first).

/**
 * @typedef {object} CssRule
 * @property {string[]} atRules    preludes, outermost first ("@media (…)")
 * @property {string[]} selectors
 * @property {[string, string][]} decls
 */

/**
 * @param {CssRule[]} rules
 * @param {string} indent
 * @returns {string}
 */
export function renderRules(rules, indent = '') {
  const root = { rules: [], children: new Map() };
  for (const r of rules) {
    let node = root;
    for (const p of r.atRules) {
      if (!node.children.has(p)) node.children.set(p, { rules: [], children: new Map() });
      node = node.children.get(p);
    }
    node.rules.push(r);
  }
  return renderNode(root, indent);
}

function renderNode(node, indent) {
  let out = '';
  for (const r of node.rules) out += renderRule(r, indent);
  for (const [prelude, child] of node.children) {
    out += `${indent}${prelude} {\n${renderNode(child, indent + '  ')}${indent}}\n`;
  }
  return out;
}

function renderRule(r, indent) {
  const sel = r.selectors.join(`,\n${indent}`);
  if (r.decls.length === 1) return `${indent}${sel} { ${r.decls[0][0]}: ${r.decls[0][1]}; }\n`;
  const body = r.decls.map(([p, v]) => `${indent}  ${p}: ${v};\n`).join('');
  return `${indent}${sel} {\n${body}${indent}}\n`;
}

/** Wrap rendered rules in a named layer block. */
export function layer(name, body) {
  return body ? `@layer ${name} {\n${body}}\n` : '';
}
