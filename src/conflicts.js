// Logical and physical properties that can set the same physical value
// (margin-top / margin-block-start, …). Two of them on one element is an
// override, so they are treated as conflicting: the later one wins and the
// earlier one is dropped. The block axis assumes horizontal writing modes;
// the inline axis is direction-agnostic (inline-start may be left or right,
// so it conflicts with both). Shared by runtime and build.

/** @type {Map<string, Set<string>>} */
const TABLE = new Map();

function link(a, b) {
  if (!TABLE.has(a)) TABLE.set(a, new Set());
  if (!TABLE.has(b)) TABLE.set(b, new Set());
  TABLE.get(a).add(b);
  TABLE.get(b).add(a);
}

function box(physical, logical) {
  // physical(side) and logical(axis, edge) build property names.
  link(physical('top'), logical('block', 'start'));
  link(physical('bottom'), logical('block', 'end'));
  for (const side of ['left', 'right']) {
    link(physical(side), logical('inline', 'start'));
    link(physical(side), logical('inline', 'end'));
  }
}

for (const p of ['margin', 'padding', 'scroll-margin', 'scroll-padding']) {
  box((side) => `${p}-${side}`, (axis, edge) => `${p}-${axis}-${edge}`);
}
box((side) => side, (axis, edge) => `inset-${axis}-${edge}`);
for (const part of ['width', 'style', 'color']) {
  box((side) => `border-${side}-${part}`, (axis, edge) => `border-${axis}-${edge}-${part}`);
}
// Corners: border-<block>-<inline>-radius.
for (const [block, phys] of [['start', 'top'], ['end', 'bottom']]) {
  for (const inline of ['start', 'end']) {
    link(`border-${block}-${inline}-radius`, `border-${phys}-left-radius`);
    link(`border-${block}-${inline}-radius`, `border-${phys}-right-radius`);
  }
}
for (const [phys, logical] of [
  ['width', 'inline-size'],
  ['height', 'block-size'],
  ['min-width', 'min-inline-size'],
  ['min-height', 'min-block-size'],
  ['max-width', 'max-inline-size'],
  ['max-height', 'max-block-size'],
  ['overflow-x', 'overflow-inline'],
  ['overflow-y', 'overflow-block'],
  ['overscroll-behavior-x', 'overscroll-behavior-inline'],
  ['overscroll-behavior-y', 'overscroll-behavior-block'],
  ['contain-intrinsic-width', 'contain-intrinsic-inline-size'],
  ['contain-intrinsic-height', 'contain-intrinsic-block-size'],
]) {
  link(phys, logical);
}

const NONE = Object.freeze([]);

/**
 * Properties that may set the same physical value as `prop`.
 * @param {string} prop kebab-case longhand
 * @returns {readonly string[]}
 */
export function conflictsOf(prop) {
  const set = TABLE.get(prop);
  return set ? [...set] : NONE;
}
