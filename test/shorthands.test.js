import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeStyle } from '../src/normalize.js';

const flat = (style) => Object.fromEntries([...normalizeStyle(style).values()].map((e) => [e.key, e.tree]));

test('box shorthands expand with 1 to 4 values', () => {
  assert.deepEqual(flat({ padding: '1px' }), { 'padding-top': '1px', 'padding-right': '1px', 'padding-bottom': '1px', 'padding-left': '1px' });
  assert.deepEqual(flat({ margin: '1px 2px' }), { 'margin-top': '1px', 'margin-right': '2px', 'margin-bottom': '1px', 'margin-left': '2px' });
  assert.deepEqual(flat({ inset: '1px 2px 3px' }), { top: '1px', right: '2px', bottom: '3px', left: '2px' });
  assert.deepEqual(flat({ borderRadius: '1px 2px 3px 4px' }), {
    'border-top-left-radius': '1px', 'border-top-right-radius': '2px', 'border-bottom-right-radius': '3px', 'border-bottom-left-radius': '4px',
  });
  assert.deepEqual(flat({ borderWidth: 1 }), { 'border-top-width': '1px', 'border-right-width': '1px', 'border-bottom-width': '1px', 'border-left-width': '1px' });
  assert.deepEqual(Object.keys(flat({ borderColor: 'var(--color-line)', borderStyle: 'solid' })).length, 8);
  assert.deepEqual(flat({ padding: 'calc(1px + 2px) var(--space-2)' })['padding-right'], 'var(--space-2)');
});

test('two-value and logical shorthands expand', () => {
  assert.deepEqual(flat({ gap: '1px 2px' }), { 'row-gap': '1px', 'column-gap': '2px' });
  assert.deepEqual(flat({ overflow: 'hidden' }), { 'overflow-x': 'hidden', 'overflow-y': 'hidden' });
  assert.deepEqual(flat({ paddingInline: '1px 2px' }), { 'padding-inline-start': '1px', 'padding-inline-end': '2px' });
  assert.deepEqual(flat({ marginBlock: 0 }), { 'margin-block-start': '0', 'margin-block-end': '0' });
  assert.deepEqual(flat({ placeItems: 'center' }), { 'align-items': 'center', 'justify-items': 'center' });
  assert.deepEqual(flat({ placeContent: 'baseline' }), { 'align-content': 'baseline', 'justify-content': 'start' });
  assert.deepEqual(flat({ overscrollBehavior: 'contain none' }), { 'overscroll-behavior-x': 'contain', 'overscroll-behavior-y': 'none' });
});

test('grid placement shorthands follow the omitted-value rules', () => {
  assert.deepEqual(flat({ gridColumn: '1 / -1' }), { 'grid-column-start': '1', 'grid-column-end': '-1' });
  assert.deepEqual(flat({ gridColumn: 'span 2' }), { 'grid-column-start': 'span 2', 'grid-column-end': 'auto' });
  assert.deepEqual(flat({ gridRow: 'main' }), { 'grid-row-start': 'main', 'grid-row-end': 'main' });
  assert.deepEqual(flat({ gridArea: 'a' }), { 'grid-row-start': 'a', 'grid-column-start': 'a', 'grid-row-end': 'a', 'grid-column-end': 'a' });
  assert.deepEqual(flat({ gridArea: '1 / 2' }), { 'grid-row-start': '1', 'grid-column-start': '2', 'grid-row-end': 'auto', 'grid-column-end': 'auto' });
  assert.throws(() => flat({ gridColumn: 'var(--x)' }), /longhands/);
});

test('CSS-wide keywords and conditional values expand per leaf', () => {
  assert.equal(flat({ padding: 'inherit' })['padding-left'], 'inherit');
  assert.deepEqual(flat({ padding: { default: '1px', ':hover': '1px 2px' } })['padding-left'], { default: '1px', ':hover': '2px' });
  assert.deepEqual(flat({ margin: { default: '1px', ':hover': null } })['margin-top'], { default: '1px', ':hover': null });
});

test('shorthands with longhands that are not expanded are rejected with advice', () => {
  for (const [prop, advice] of [
    ['border', /borderWidth, borderStyle and borderColor/],
    ['background', /backgroundColor/],
    ['font', /fontFamily/],
    ['transition', /transitionProperty/],
    ['animation', /animationName/],
    ['flex', /flexGrow/],
    ['outline', /outlineWidth/],
    ['textDecoration', /textDecorationLine/],
    ['listStyle', /listStyleType/],
    ['grid', /gridTemplateColumns/],
    ['all', /overrides every other declaration/],
    ['wordWrap', /overflowWrap/],
    ['textWrapMode', /whiteSpace/],
  ]) {
    assert.throws(() => normalizeStyle({ [prop]: 'x' }), advice, prop);
  }
  assert.throws(() => normalizeStyle({ borderRadius: '1px / 2px' }), /elliptical/);
  assert.throws(() => normalizeStyle({ padding: '1px 2px 3px 4px 5px' }), /1 to 4 values/);
});

test('later keys win, including a longhand after its shorthand and vice versa', () => {
  assert.equal(flat({ padding: '1px', paddingTop: '9px' })['padding-top'], '9px');
  assert.equal(flat({ paddingTop: '9px', padding: '1px' })['padding-top'], '1px');
});

test('logical and physical twins of one side never coexist (later wins)', () => {
  assert.deepEqual(flat({ marginTop: 1, marginBlockStart: 2 }), { 'margin-block-start': '2px' });
  const r = flat({ padding: 4, paddingInline: 8 });
  assert.deepEqual(Object.keys(r).sort(), ['padding-bottom', 'padding-inline-end', 'padding-inline-start', 'padding-top']);
  assert.deepEqual(flat({ width: 1, inlineSize: 2 }), { 'inline-size': '2px' });
});

test('values: numbers get px except unitless properties, !important and arrays are rejected', () => {
  assert.deepEqual(flat({ width: 10, lineHeight: 1.5, opacity: 0.5, zIndex: 2, marginTop: 0, '--n': 3 }), {
    width: '10px', 'line-height': '1.5', opacity: '0.5', 'z-index': '2', 'margin-top': '0', '--n': '3',
  });
  assert.throws(() => normalizeStyle({ color: 'var(--x) !important' }), /!important/);
  assert.throws(() => normalizeStyle({ position: ['-webkit-sticky', 'sticky'] }), /override/);
  assert.throws(() => normalizeStyle({ ':hover': { color: 'x' } }), /conditions on each property/);
  assert.throws(() => normalizeStyle({ color: { hover: 'x' } }), /not a condition/);
  assert.throws(() => normalizeStyle({ '@layer x': { color: 'x' } }), /invalid property name/);
});

test('pseudo-elements nest one level and key their own properties', () => {
  const r = normalizeStyle({ color: 'a', '::before': { color: 'b', content: '""' } });
  assert.deepEqual([...r.keys()], ['color', '::before color', '::before content']);
  assert.throws(() => normalizeStyle({ '::before': { '::after': { color: 'x' } } }), /not allowed here/);
});
