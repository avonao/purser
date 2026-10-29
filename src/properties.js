// Property names and number handling. Shared by runtime and build.

/**
 * `backgroundColor` -> `background-color`, `WebkitLineClamp` -> `-webkit-line-clamp`,
 * `msFlex` -> `-ms-flex`; custom properties (`--x`) and kebab names pass through.
 * @param {string} name
 */
export function cssPropertyName(name) {
  if (name.startsWith('--')) return name;
  if (name.includes('-')) return name.toLowerCase();
  const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  if (/^ms-/.test(kebab)) return `-${kebab}`;
  return kebab;
}

// Properties whose numeric values carry no unit (React's list, kebab-cased, plus a few newer ones).
const UNITLESS = new Set([
  'animation-iteration-count', 'aspect-ratio', 'border-image-outset', 'border-image-slice',
  'border-image-width', 'box-flex', 'box-flex-group', 'box-ordinal-group', 'column-count',
  'fill-opacity', 'flex-grow', 'flex-shrink', 'flood-opacity', 'font-weight', 'grid-column-end',
  'grid-column-start', 'grid-row-end', 'grid-row-start', 'initial-letter', 'line-clamp',
  'line-height', 'math-depth', 'opacity', 'order', 'orphans', 'scale', 'shape-image-threshold',
  'stop-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'stroke-opacity',
  'stroke-width', 'tab-size', 'widows', 'z-index', 'zoom', '-webkit-line-clamp', 'font-size-adjust',
  'counter-increment', 'counter-reset', 'counter-set',
]);

/**
 * Format a number for a property: unitless properties and custom properties keep
 * the bare number, `0` stays `0`, everything else gets `px`.
 * @param {string} property kebab-case name
 * @param {number} n
 */
export function formatNumberValue(property, n) {
  if (!Number.isFinite(n)) throw new TypeError(`non-finite number ${n}`);
  if (property.startsWith('--') || UNITLESS.has(property) || n === 0) return String(n);
  return `${n}px`;
}
