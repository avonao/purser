// Independent check of the generated CSS text, parsed with the host's
// PostCSS: the rules purser promises must hold in the output itself.

import { findColors } from '../color.js';

/**
 * @param {string} css
 * @param {any} postcss the host's postcss module
 * @returns {string[]} problems (empty when the output is clean)
 */
export function selfCheck(css, postcss) {
  const problems = [];
  let root;
  try {
    root = postcss.parse(css);
  } catch (err) {
    return [`generated CSS does not parse: ${err.message}`];
  }
  const seen = new Set();
  const blocks = new Map();
  root.walkDecls((d) => {
    const where = context(d);
    if (d.important) problems.push(`!important in output at ${where}`);
    const named = d.prop.startsWith('--') ? /^--(color|shadow)-/.test(d.prop) : /color|shadow|^fill$|^stroke$|^background/.test(d.prop);
    for (const c of findColors(d.value, { named })) {
      if (!/^lab\(/i.test(c.text)) problems.push(`colour "${c.text}" is not lab() at ${where} { ${d.prop} }`);
    }
    // Style rules: one declaration per property per selector and context.
    // Descriptor blocks (@font-face): one per property per block.
    if (d.parent.type === 'rule') {
      const key = `${where}\u0000${d.prop}`;
      if (seen.has(key)) problems.push(`${d.prop} declared twice at ${where}`);
      seen.add(key);
    } else {
      if (!blocks.has(d.parent)) blocks.set(d.parent, new Set());
      if (blocks.get(d.parent).has(d.prop)) problems.push(`${d.prop} declared twice in ${where}`);
      blocks.get(d.parent).add(d.prop);
    }
  });
  return problems;
}

function context(node) {
  const parts = [];
  for (let n = node.parent; n && n.type !== 'root'; n = n.parent) {
    parts.unshift(n.type === 'rule' ? n.selector : `@${n.name} ${n.params}`);
  }
  return parts.join(' > ');
}
