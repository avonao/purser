// Colour parsing and conversion to CSS `lab()` (CIE Lab, D50), following the
// conversion chain and matrices of CSS Color 4 (https://drafts.csswg.org/css-color-4/).
//
// This module is build-time only; the runtime never imports it.

import { NAMED_COLORS } from './named-colors.js';

/** @typedef {{ l: number, a: number, b: number, alpha: number }} Lab */

// ---------------------------------------------------------------------------
// Matrices (CSS Color 4 §18 sample code)

const LIN_SRGB_TO_XYZ_D65 = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];

const LIN_P3_TO_XYZ_D65 = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];

// OKLab -> LMS (non-linear) and linear LMS -> linear sRGB (Björn Ottosson's
// matrices, as used by CSS Color 4 and by Chromium for oklab()/oklch()).
const OKLAB_TO_LMS = [
  [1.0, 0.3963377773761749, 0.2158037573099136],
  [1.0, -0.1055613458156586, -0.0638541728258133],
  [1.0, -0.0894841775298119, -1.2914855480194092],
];

const LMS_TO_LIN_SRGB = [
  [4.0767416360759583, -3.3077115392580629, 0.2309699031821043],
  [-1.2684379732850315, 2.6097573492876882, -0.3413193760026570],
  [-0.0041960761386756, -0.7034186179359363, 1.7076146940746117],
];

// Bradford chromatic adaptation D65 -> D50.
const D65_TO_D50 = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];

const D50_WHITE = [0.3457 / 0.3585, 1.0, (1.0 - 0.3457 - 0.3585) / 0.3585];
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

/** @param {number[][]} m @param {number[]} v */
function mul(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** sRGB transfer function, sign-preserving (CSS Color 4 lin_sRGB). */
function linearize(c) {
  const abs = Math.abs(c);
  if (abs <= 0.04045) return c / 12.92;
  return Math.sign(c) * ((abs + 0.055) / 1.055) ** 2.4;
}

/** XYZ (D50) -> Lab. */
function xyzD50ToLab(xyz) {
  const f = xyz.map((v, i) => {
    const x = v / D50_WHITE[i];
    return x > EPSILON ? Math.cbrt(x) : (KAPPA * x + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

/** @param {number[]} rgb gamma-encoded sRGB in 0..1 */
export function srgbToLab(rgb) {
  return xyzD50ToLab(mul(D65_TO_D50, mul(LIN_SRGB_TO_XYZ_D65, rgb.map(linearize))));
}

/** @param {number[]} lab OKLab (L in 0..1) */
export function oklabToLab(lab) {
  const lms = mul(OKLAB_TO_LMS, lab).map((v) => v ** 3);
  const linearSrgb = mul(LMS_TO_LIN_SRGB, lms);
  return xyzD50ToLab(mul(D65_TO_D50, mul(LIN_SRGB_TO_XYZ_D65, linearSrgb)));
}

function p3ToLab(rgb) {
  return xyzD50ToLab(mul(D65_TO_D50, mul(LIN_P3_TO_XYZ_D65, rgb.map(linearize))));
}

function linearSrgbToLab(rgb) {
  return xyzD50ToLab(mul(D65_TO_D50, mul(LIN_SRGB_TO_XYZ_D65, rgb)));
}

function hslToSrgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function hwbToSrgb(h, w, b) {
  if (w + b >= 1) {
    const gray = w / (w + b);
    return [gray, gray, gray];
  }
  return hslToSrgb(h, 1, 0.5).map((c) => c * (1 - w - b) + w);
}

// ---------------------------------------------------------------------------
// Parsing

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

/**
 * Parse one channel token.
 * @param {string} tok
 * @param {{ percent?: number, angle?: boolean }} opts percent: what 100% maps to
 * @returns {number}
 */
function channel(tok, opts = {}) {
  if (tok === 'none') return 0;
  const m = NUM.exec(tok);
  if (!m) throw new ColorError(`invalid colour channel "${tok}"`);
  const n = Number(m[0]);
  const unit = tok.slice(m[0].length).toLowerCase();
  if (unit === '') return n;
  if (unit === '%') {
    if (opts.percent === undefined) throw new ColorError(`percentage not allowed for channel "${tok}"`);
    return (n / 100) * opts.percent;
  }
  if (opts.angle) {
    if (unit === 'deg') return n;
    if (unit === 'rad') return (n * 180) / Math.PI;
    if (unit === 'grad') return n * 0.9;
    if (unit === 'turn') return n * 360;
  }
  throw new ColorError(`invalid unit in colour channel "${tok}"`);
}

/** Split function arguments into channel tokens and an optional alpha token. */
function splitArgs(body) {
  const legacy = body.includes(',');
  let parts;
  let alpha;
  if (legacy) {
    parts = body.split(',').map((s) => s.trim());
    if (parts.length === 4) alpha = parts.pop();
  } else {
    const [main, a] = body.split('/');
    parts = main.trim().split(/\s+/);
    if (a !== undefined) alpha = a.trim();
  }
  if (parts.length !== 3) throw new ColorError(`expected 3 channels, got ${parts.length}`);
  const alphaValue = alpha === undefined ? 1 : channel(alpha, { percent: 1 });
  return { parts, alpha: Math.min(1, Math.max(0, alphaValue)) };
}

export class ColorError extends Error {}

/**
 * Convert any supported CSS colour literal to Lab.
 * Supports hex, rgb()/rgba(), hsl()/hsla(), hwb(), lab(), lch(), oklab(), oklch(),
 * color(srgb|srgb-linear|display-p3 …), named colours and `transparent`.
 * @param {string} input
 * @returns {Lab}
 */
export function parseColor(input) {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { l: 0, a: 0, b: 0, alpha: 0 };
  if (s.startsWith('#')) return hexToLab(s);
  if (Object.hasOwn(NAMED_COLORS, s)) return hexToLab(NAMED_COLORS[s]);
  const m = /^([a-z-]+)\((.*)\)$/s.exec(s);
  if (!m) throw new ColorError(`unrecognised colour "${input}"`);
  const [, fn, body] = m;
  if (/\bfrom\b/.test(body) || body.includes('var(') || body.includes('calc(')) {
    throw new ColorError(`cannot convert "${input}" statically (relative colours, var() and calc() are not supported inside colour functions)`);
  }
  if (fn === 'color') return colorFn(body);
  const { parts, alpha } = splitArgs(body);
  let lab;
  switch (fn) {
    case 'rgb':
    case 'rgba': {
      lab = srgbToLab(parts.map((p) => channel(p, { percent: 255 }) / 255));
      break;
    }
    case 'hsl':
    case 'hsla': {
      const h = channel(parts[0], { angle: true });
      const sat = channel(parts[1], { percent: 100 }) / 100;
      const light = channel(parts[2], { percent: 100 }) / 100;
      lab = srgbToLab(hslToSrgb(h, sat, light));
      break;
    }
    case 'hwb': {
      const h = channel(parts[0], { angle: true });
      lab = srgbToLab(hwbToSrgb(h, channel(parts[1], { percent: 100 }) / 100, channel(parts[2], { percent: 100 }) / 100));
      break;
    }
    case 'lab': {
      lab = [channel(parts[0], { percent: 100 }), channel(parts[1], { percent: 125 }), channel(parts[2], { percent: 125 })];
      break;
    }
    case 'lch': {
      const L = channel(parts[0], { percent: 100 });
      const C = channel(parts[1], { percent: 150 });
      const H = (channel(parts[2], { angle: true }) * Math.PI) / 180;
      lab = [L, C * Math.cos(H), C * Math.sin(H)];
      break;
    }
    case 'oklab': {
      lab = oklabToLab([channel(parts[0], { percent: 1 }), channel(parts[1], { percent: 0.4 }), channel(parts[2], { percent: 0.4 })]);
      break;
    }
    case 'oklch': {
      const L = channel(parts[0], { percent: 1 });
      const C = channel(parts[1], { percent: 0.4 });
      const H = (channel(parts[2], { angle: true }) * Math.PI) / 180;
      lab = oklabToLab([L, C * Math.cos(H), C * Math.sin(H)]);
      break;
    }
    default:
      throw new ColorError(`unsupported colour function "${fn}()"`);
  }
  if (fn === 'lab' || fn === 'lch') lab[0] = Math.max(0, lab[0]);
  return { l: lab[0], a: lab[1], b: lab[2], alpha };
}

function colorFn(body) {
  const [main, a] = body.split('/');
  const [space, ...rest] = main.trim().split(/\s+/);
  if (rest.length !== 3) throw new ColorError(`color(): expected 3 channels`);
  const rgb = rest.map((p) => channel(p, { percent: 1 }));
  const alpha = a === undefined ? 1 : Math.min(1, Math.max(0, channel(a.trim(), { percent: 1 })));
  let lab;
  if (space === 'srgb') lab = srgbToLab(rgb);
  else if (space === 'srgb-linear') lab = linearSrgbToLab(rgb);
  else if (space === 'display-p3') lab = p3ToLab(rgb);
  else throw new ColorError(`color(): unsupported colour space "${space}"`);
  return { l: lab[0], a: lab[1], b: lab[2], alpha };
}

function hexToLab(hex) {
  const h = hex.slice(1);
  if (!/^[0-9a-f]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) throw new ColorError(`invalid hex colour "${hex}"`);
  const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
  const bytes = full.match(/../g).map((x) => parseInt(x, 16) / 255);
  const lab = srgbToLab(bytes.slice(0, 3));
  return { l: lab[0], a: lab[1], b: lab[2], alpha: bytes.length === 4 ? bytes[3] : 1 };
}

// ---------------------------------------------------------------------------
// Formatting

/** Round to 4 decimals, drop trailing zeros, never print -0. */
export function formatNumber(n) {
  let r = Math.round(n * 1e4) / 1e4;
  if (Object.is(r, -0) || Math.abs(r) < 5e-5) r = 0;
  return String(r);
}

/** @param {Lab} c */
export function formatLab(c) {
  const core = `${formatNumber(c.l)} ${formatNumber(c.a)} ${formatNumber(c.b)}`;
  const alpha = Math.round(c.alpha * 1e4) / 1e4;
  return alpha >= 1 ? `lab(${core})` : `lab(${core} / ${formatNumber(alpha)})`;
}

/** Convert a single colour literal to its `lab()` serialisation. */
export function toLab(input) {
  return formatLab(parseColor(input));
}

// ---------------------------------------------------------------------------
// Finding colours inside larger values

const COLOR_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color']);
// Functions whose arguments are never colours we should touch.
const OPAQUE_FUNCTIONS = new Set(['url', 'var', 'env', 'attr', 'image-set', 'format', 'local']);

/**
 * Scan a CSS value for colour literals.
 * @param {string} value
 * @param {{ named?: boolean }} [opts] named: also report named colours and `transparent`
 * @returns {{ start: number, end: number, text: string, kind: 'hex'|'function'|'named' }[]}
 */
export function findColors(value, opts = {}) {
  const found = [];
  let i = 0;
  const n = value.length;
  while (i < n) {
    const ch = value[i];
    if (ch === '"' || ch === "'") {
      i = skipString(value, i);
      continue;
    }
    if (ch === '#') {
      const m = /^#[0-9a-fA-F]+(?![\w-])/.exec(value.slice(i));
      if (m && [4, 5, 7, 9].includes(m[0].length)) {
        found.push({ start: i, end: i + m[0].length, text: m[0], kind: 'hex' });
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }
    if (/[a-zA-Z_-]/.test(ch) && (i === 0 || !/[\w-]/.test(value[i - 1]))) {
      const m = /^-?[a-zA-Z_][\w-]*/.exec(value.slice(i));
      if (!m) {
        i++;
        continue;
      }
      const word = m[0];
      const after = i + word.length;
      const lower = word.toLowerCase();
      if (value[after] === '(') {
        const close = matchParen(value, after);
        if (COLOR_FUNCTIONS.has(lower)) {
          found.push({ start: i, end: close + 1, text: value.slice(i, close + 1), kind: 'function' });
          i = close + 1;
          continue;
        }
        if (OPAQUE_FUNCTIONS.has(lower)) {
          // var() fallbacks may still hold raw colours: scan the fallback part.
          if (lower === 'var') {
            const inner = value.slice(after + 1, close);
            const comma = topLevelComma(inner);
            if (comma !== -1) {
              const offset = after + 1 + comma + 1;
              for (const f of findColors(inner.slice(comma + 1), opts)) {
                found.push({ ...f, start: f.start + offset, end: f.end + offset });
              }
            }
          }
          i = close + 1;
          continue;
        }
        i = after + 1;
        continue;
      }
      if (opts.named && (lower === 'transparent' || Object.hasOwn(NAMED_COLORS, lower))) {
        found.push({ start: i, end: after, text: word, kind: 'named' });
      }
      i = after;
      continue;
    }
    i++;
  }
  return found;
}

/** Replace every colour literal in `value` by its lab() form. */
export function convertColorsInValue(value, opts = {}) {
  const hits = findColors(value, opts);
  let out = '';
  let last = 0;
  for (const h of hits) {
    out += value.slice(last, h.start) + toLab(h.text);
    last = h.end;
  }
  return out + value.slice(last);
}

function skipString(s, i) {
  const q = s[i];
  i++;
  while (i < s.length && s[i] !== q) {
    if (s[i] === '\\') i++;
    i++;
  }
  return i + 1;
}

/** Index of the parenthesis matching the "(" at `open`. */
export function matchParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      i = skipString(s, i) - 1;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return s.length - 1;
}

function topLevelComma(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) return i;
  }
  return -1;
}
