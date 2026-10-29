// strike-count.js — count overridden ("struck through") declarations on a page.
//
// Paste into the DevTools console, inject with a <script> tag, or evaluate over
// the DevTools protocol: evaluating this file returns the report object.
//
// For every element (and its ::before / ::after and other pseudo-elements) it
// collects the author rules that match in the CURRENT state (hover, focus,
// viewport width, root classes) and reports each property declared by more
// than one of them, which is exactly what DevTools strikes through in the
// element's own rules. Rules are walked recursively through @layer, @media
// (matchMedia), @supports (CSS.supports) and @import. @container rules cannot
// be evaluated from script and are reported as skipped. The inline style
// attribute counts as a source. Logical properties are mapped to physical
// sides (horizontal writing modes) so margin-top vs margin-block-start counts.
//
// Report: { struck: [{ element, pseudo, property, sources }], count, rules, skipped }

(function install(global) {
  const PSEUDO = /(::?(?:before|after|first-line|first-letter)|::[a-zA-Z-]+(?:\([^)]*\))?(?::[a-zA-Z-]+)*)$/;

  function splitSelectors(text) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ',' && depth === 0) {
        out.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    out.push(text.slice(start).trim());
    return out.filter(Boolean);
  }

  function collectRules(list, out, skipped) {
    for (const rule of list) {
      if (typeof CSSImportRule !== 'undefined' && rule instanceof CSSImportRule) {
        if (rule.styleSheet && (!rule.media || !rule.media.mediaText || matchMedia(rule.media.mediaText).matches)) {
          collectRules(rule.styleSheet.cssRules, out, skipped);
        }
      } else if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) {
        collectRules(rule.cssRules, out, skipped);
      } else if (rule instanceof CSSMediaRule) {
        if (matchMedia(rule.media.mediaText).matches) collectRules(rule.cssRules, out, skipped);
      } else if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) collectRules(rule.cssRules, out, skipped);
      } else if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
        skipped.push(`@container ${rule.conditionText}`);
      } else if (rule instanceof CSSStyleRule) {
        if (rule.cssRules && rule.cssRules.length) skipped.push(`nested rules in ${rule.selectorText}`);
        out.push(rule);
      }
    }
  }

  function physical(prop, style) {
    const m = /^(margin|padding|inset|scroll-margin|scroll-padding|border)-(block|inline)-(start|end)(-width|-style|-color)?$/.exec(prop);
    if (!m) {
      const sizes = { 'inline-size': 'width', 'block-size': 'height', 'min-inline-size': 'min-width', 'min-block-size': 'min-height', 'max-inline-size': 'max-width', 'max-block-size': 'max-height' };
      return sizes[prop] || prop;
    }
    const [, base, axis, edge, part = ''] = m;
    const rtl = style.direction === 'rtl';
    const side = axis === 'block' ? (edge === 'start' ? 'top' : 'bottom') : (edge === 'start') !== rtl ? 'left' : 'right';
    return base === 'inset' ? side : `${base}-${side}${part}`;
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    if (cls.length) s += `.${cls.slice(0, 3).join('.')}${cls.length > 3 ? '…' : ''}`;
    return s;
  }

  function purserStrikeCount() {
    const rules = [];
    const skipped = [];
    for (const sheet of document.styleSheets) {
      let list;
      try {
        list = sheet.cssRules;
      } catch {
        skipped.push(`cross-origin stylesheet ${sheet.href}`);
        continue;
      }
      if (sheet.media && sheet.media.mediaText && !matchMedia(sheet.media.mediaText).matches) continue;
      collectRules(list, rules, skipped);
    }

    // (element, pseudo) -> property -> [source rules]
    const seen = new Map();
    const add = (el, pseudo, prop, source) => {
      if (!seen.has(el)) seen.set(el, new Map());
      const byPseudo = seen.get(el);
      if (!byPseudo.has(pseudo)) byPseudo.set(pseudo, new Map());
      const props = byPseudo.get(pseudo);
      const key = prop.startsWith('--') ? prop : physical(prop, getComputedStyle(el));
      if (!props.has(key)) props.set(key, []);
      const list = props.get(key);
      if (!list.includes(source)) list.push(source);
    };

    for (const rule of rules) {
      const props = [];
      for (let i = 0; i < rule.style.length; i++) props.push(rule.style[i]);
      if (!props.length) continue;
      const matched = new Map(); // element -> Set(pseudo), so a selector list counts once per rule
      for (const sel of splitSelectors(rule.selectorText)) {
        const m = PSEUDO.exec(sel);
        let pseudo = '';
        let base = sel;
        if (m) {
          pseudo = m[1].startsWith('::') ? m[1] : `:${m[1]}`;
          base = sel.slice(0, m.index).trim() || '*';
          if (/[\s>+~]$/.test(base)) base += '*';
        }
        let els;
        try {
          els = document.querySelectorAll(base);
        } catch {
          skipped.push(`unsupported selector ${sel}`);
          continue;
        }
        for (const el of els) {
          if (!matched.has(el)) matched.set(el, new Set());
          matched.get(el).add(pseudo);
        }
      }
      for (const [el, pseudos] of matched) for (const pseudo of pseudos) for (const p of props) add(el, pseudo, p, rule);
    }
    for (const el of document.querySelectorAll('[style]')) {
      for (let i = 0; i < el.style.length; i++) add(el, '', el.style[i], el.style);
    }

    const struck = [];
    for (const [el, byPseudo] of seen) {
      for (const [pseudo, props] of byPseudo) {
        for (const [property, sources] of props) {
          if (sources.length > 1) {
            const names = sources.map((src) => (src instanceof CSSStyleRule ? src.selectorText : 'style attribute'));
            struck.push({ element: describe(el), pseudo, property, sources: names });
          }
        }
      }
    }
    return { struck, count: struck.length, rules: rules.length, skipped };
  }

  global.purserStrikeCount = purserStrikeCount;
})(globalThis);

purserStrikeCount();
