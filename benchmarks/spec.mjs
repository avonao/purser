// A neutral description of a design system: tokens and components, generated from a seed so every tool is given the same
// styles. Nothing here is specific to one tool; the emitters in ./emit translate it.

/** Deterministic PRNG (mulberry32). */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const COLORS = {
  text: ['#1a1a1a', '#ededed'],
  muted: ['#6b7280', '#9ca3af'],
  accent: ['#e4572e', '#ff7a59'],
  surface: ['#ffffff', '#121212'],
  raised: ['#f6f6f7', '#1c1c1f'],
  line: ['#e5e7eb', '#2a2a2e'],
  focus: ['#0a84ff', '#4da3ff'],
  success: ['#15803d', '#4ade80'],
  danger: ['#b91c1c', '#f87171'],
  warning: ['#b45309', '#fbbf24'],
  info: ['#1d4ed8', '#60a5fa'],
  inverse: ['#111827', '#f9fafb'],
};
export const SPACE = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16]; // × 4px
export const RADIUS = { sm: 4, md: 8, lg: 12, full: 9999 };
export const FONT_SIZE = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, xxl: 24 };
export const BREAKPOINTS = { md: 768, lg: 1024 };

/**
 * Every property the corpus uses: the values it can take, and how often it appears in a style (weight).
 * `kind` tells an emitter how to spell the value: a keyword, a space step, a colour token, a radius, a font size or a number.
 */
export const PROPERTIES = [
  { prop: 'display', kind: 'keyword', values: ['flex', 'block', 'grid', 'inline-flex', 'none'], weight: 10, skew: 2.2 },
  { prop: 'flexDirection', kind: 'keyword', values: ['row', 'column'], weight: 4, skew: 1 },
  { prop: 'alignItems', kind: 'keyword', values: ['center', 'flex-start', 'flex-end', 'stretch'], weight: 7, skew: 2 },
  { prop: 'justifyContent', kind: 'keyword', values: ['space-between', 'center', 'flex-start', 'flex-end'], weight: 5, skew: 1.5 },
  { prop: 'gap', kind: 'space', weight: 6, skew: 1.3 },
  { prop: 'paddingInline', kind: 'space', weight: 8, skew: 1.2 },
  { prop: 'paddingBlock', kind: 'space', weight: 8, skew: 1.2 },
  { prop: 'marginTop', kind: 'space', weight: 4, skew: 1.2 },
  { prop: 'marginBottom', kind: 'space', weight: 4, skew: 1.2 },
  { prop: 'color', kind: 'color', weight: 9, skew: 1.6 },
  { prop: 'backgroundColor', kind: 'color', weight: 8, skew: 1.4 },
  { prop: 'borderColor', kind: 'color', weight: 4, skew: 1.6 },
  { prop: 'borderWidth', kind: 'px', values: [1, 2], weight: 4, skew: 2.5 },
  { prop: 'borderStyle', kind: 'keyword', values: ['solid', 'dashed'], weight: 4, skew: 3 },
  { prop: 'borderRadius', kind: 'radius', weight: 6, skew: 1.2 },
  { prop: 'fontSize', kind: 'fontSize', weight: 7, skew: 1.2 },
  { prop: 'fontWeight', kind: 'number', values: [400, 500, 600, 700], weight: 5, skew: 1.2 },
  { prop: 'lineHeight', kind: 'number', values: [1.5, 1.25, 1], weight: 4, skew: 1.5 },
  { prop: 'opacity', kind: 'number', values: [1, 0.75, 0.5], weight: 2, skew: 1 },
  { prop: 'cursor', kind: 'keyword', values: ['pointer', 'not-allowed', 'default'], weight: 3, skew: 2 },
  { prop: 'position', kind: 'keyword', values: ['relative', 'absolute', 'sticky'], weight: 3, skew: 2 },
  { prop: 'zIndex', kind: 'number', values: [10, 20, 50], weight: 1, skew: 1 },
  { prop: 'textAlign', kind: 'keyword', values: ['left', 'center', 'right'], weight: 2, skew: 1.5 },
  { prop: 'width', kind: 'size', weight: 3, skew: 1 },
  { prop: 'height', kind: 'size', weight: 2, skew: 1 },
];

/** Conditions a value can carry. `hover` and friends are states; `md` and `lg` are viewport widths. */
export const CONDITIONS = ['hover', 'focusVisible', 'disabled', 'selected', 'md', 'lg'];

/**
 * Which properties a condition changes in real interface code: a hover changes colours, a disabled state changes
 * opacity and the cursor, a breakpoint changes layout. The default model ("interface") follows this table; the
 * "uniform" model lets any condition change any property, which no codebase does and which is the hardest case for a
 * tool that compiles each property's conditions together.
 */
export const AFFINITY = {
  hover: ['color', 'backgroundColor', 'borderColor', 'opacity'],
  focusVisible: ['borderColor', 'backgroundColor', 'color'],
  disabled: ['opacity', 'cursor', 'color', 'backgroundColor'],
  selected: ['backgroundColor', 'color', 'fontWeight', 'borderColor'],
  md: ['display', 'flexDirection', 'gap', 'paddingInline', 'paddingBlock', 'fontSize', 'width', 'marginTop', 'marginBottom', 'alignItems', 'justifyContent'],
  lg: ['display', 'flexDirection', 'gap', 'paddingInline', 'paddingBlock', 'fontSize', 'width', 'marginTop', 'marginBottom', 'justifyContent'],
};

function pick(rand, list, skew = 1) {
  // skew > 1 makes the first entries more likely, the way a few declarations dominate a real codebase
  return list[Math.min(list.length - 1, Math.floor(rand() ** skew * list.length))];
}

function valueFor(rand, p, arbitraryShare) {
  switch (p.kind) {
    case 'keyword':
    case 'number':
      return { kind: p.kind, value: pick(rand, p.values, p.skew) };
    case 'px':
      return { kind: 'px', value: pick(rand, p.values, p.skew) };
    case 'space':
      return rand() < arbitraryShare ? { kind: 'px', value: 3 + Math.floor(rand() * 90) } : { kind: 'space', value: pick(rand, SPACE.slice(1), p.skew) };
    case 'color':
      return { kind: 'color', value: pick(rand, Object.keys(COLORS), p.skew) };
    case 'radius':
      return { kind: 'radius', value: pick(rand, Object.keys(RADIUS), p.skew) };
    case 'fontSize':
      return { kind: 'fontSize', value: pick(rand, Object.keys(FONT_SIZE), p.skew) };
    case 'size':
      return rand() < 0.5 ? { kind: 'keyword', value: '100%' } : { kind: 'px', value: 16 + Math.floor(rand() * 60) * 8 };
    default:
      throw new Error(`unknown kind ${p.kind}`);
  }
}

function style(rand, count, conditionalShare, arbitraryShare, model) {
  const total = PROPERTIES.reduce((n, p) => n + p.weight, 0);
  const chosen = new Map();
  let guard = 0;
  while (chosen.size < count && guard++ < 500) {
    let r = rand() * total;
    const p = PROPERTIES.find((x) => (r -= x.weight) < 0) ?? PROPERTIES[0];
    if (chosen.has(p.prop)) continue;
    const base = valueFor(rand, p, arbitraryShare);
    const conditions = [];
    const allowed = model === 'uniform' ? CONDITIONS : CONDITIONS.filter((c) => AFFINITY[c].includes(p.prop));
    if (allowed.length && rand() < conditionalShare * (model === 'uniform' ? 1 : CONDITIONS.length / allowed.length / 2)) {
      const n = rand() < 0.75 ? 1 : 2;
      const used = new Set();
      for (let i = 0; i < n; i++) {
        const c = pick(rand, allowed, 1.3);
        if (used.has(c)) continue;
        used.add(c);
        let v = valueFor(rand, p, arbitraryShare);
        for (let k = 0; k < 4 && same(v, base); k++) v = valueFor(rand, p, arbitraryShare);
        if (!same(v, base)) conditions.push({ when: c, value: v });
      }
    }
    chosen.set(p.prop, { prop: p.prop, value: base, conditions });
  }
  // property order is part of the spec so every tool is given the same source order
  return [...chosen.values()];
}

const same = (a, b) => a.kind === b.kind && a.value === b.value;

/**
 * @param {{ components: number, seed?: number, arbitraryShare?: number, model?: 'interface' | 'uniform' }} options
 * @returns {{ components: { name: string, base: object[], variants: { name: string, style: object[] }[] }[] }}
 */
export function generateSpec({ components, seed = 20261125, arbitraryShare = 0.08, model = 'interface' }) {
  const rand = prng(seed);
  const out = [];
  for (let i = 0; i < components; i++) {
    const base = style(rand, 8 + Math.floor(rand() * 7), 0.3, arbitraryShare, model);
    const variants = [];
    const names = ['primary', 'quiet', 'danger', 'compact', 'wide'];
    const count = 2 + Math.floor(rand() * 2);
    for (let v = 0; v < count; v++) variants.push({ name: names[v], style: style(rand, 3 + Math.floor(rand() * 3), 0.2, arbitraryShare, model) });
    out.push({ name: `C${String(i).padStart(4, '0')}`, base, variants });
  }
  return { components: out };
}

/** Deterministic use of the components on a page: which component, which variants are on. */
export function generatePage(spec, elements, seed = 7) {
  const rand = prng(seed);
  const out = [];
  for (let i = 0; i < elements; i++) {
    const c = spec.components[Math.floor(rand() ** 1.5 * spec.components.length)];
    const on = c.variants.filter(() => rand() < 0.35).map((v) => v.name);
    out.push({ component: c.name, variants: on });
  }
  return out;
}
