import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTree, parseCondition, renderSelectorLiterals, renderTerm } from '../src/conditions.js';
import { normalizeTree } from '../src/normalize.js';
import { assertExclusive, assertMatchesOracle, rng } from './helpers/exclusive.js';

const render = (raw) => {
  const tree = normalizeTree(raw, 'color', [], { conditions: true });
  return compileTree(tree).rules.map(({ term, value }) => {
    const { selector, atRules } = renderTerm(term);
    return `${atRules.map((a) => `${a} { `).join('')}.x${renderSelectorLiterals(selector)} { ${value} }`;
  });
};

test('a pseudo-class branch excludes the default', () => {
  assert.deepEqual(render({ default: 'A', ':hover': 'B' }), ['.x:not(:hover) { A }', '.x:hover { B }']);
});

test('media branches become disjoint ranges (Media Queries 4 negation)', () => {
  assert.deepEqual(render({ default: 'block', '@media (width >= 768px)': 'flex', '@media (width >= 1024px)': 'grid' }), [
    '@media (not (width >= 768px)) and (not (width >= 1024px)) { .x { block }',
    '@media (width >= 768px) and (not (width >= 1024px)) { .x { flex }',
    '@media (width >= 1024px) { .x { grid }',
  ]);
});

test('negating a conjunction yields disjoint pieces', () => {
  assert.deepEqual(render({ default: 'A', ':hover:focus': 'B' }), ['.x:not(:hover) { A }', '.x:hover:not(:focus) { A }', '.x:hover:focus { B }']);
});

test('equal values merge into fewer rules; no default means no fallback rule', () => {
  assert.deepEqual(render({ default: 'A', ':hover': 'A' }), ['.x { A }']);
  assert.deepEqual(render({ ':hover': 'B' }), ['.x:hover { B }']);
  assert.deepEqual(render({ default: 'A', ':hover': null }), ['.x:not(:hover) { A }']);
});

test(':not() conditions are recognised as negations of the same atom', () => {
  assert.deepEqual(render({ default: 'A', ':not(:hover)': 'B' }), ['.x:hover { A }', '.x:not(:hover) { B }']);
  assert.deepEqual(parseCondition(':not(.a, .b)').map((l) => [l.text, l.neg]), [['.a', true], ['.b', true]]);
});

test('supports, container, media types and nesting render as nested at-rules', () => {
  const rules = render({ default: 'A', '@media print': 'P', '@supports (display: grid)': 'G', '@container side (width > 400px)': 'C' });
  assert.equal(rules.at(-1), '@container side (width > 400px) { .x { C }');
  assert.ok(rules[0].startsWith('@media not print { @supports not (display: grid) { @container side not (width > 400px)'), rules[0]);
  assert.deepEqual(parseCondition('@media screen and (min-width: 1px)').map((l) => l.kind), ['media-type', 'media']);
  assert.deepEqual(parseCondition('@media (a: 1) and (b: 2)').length, 2);
  assert.deepEqual(parseCondition('@media (a: 1) or (b: 2)').length, 1);
});

test('invalid conditions are rejected with guidance', () => {
  assert.throws(() => parseCondition(':hover > .child'), /combinator/);
  assert.throws(() => parseCondition('.dark'), /:is\(\.dark \*\)/);
  assert.throws(() => parseCondition('::before'), /pseudo-elements cannot be conditions/);
  assert.throws(() => parseCondition('@media (a), (b)'), /use "or"/);
  assert.throws(() => parseCondition('@media not screen and (a)'), /not supported/);
});

test('hand-written trees are exclusive and match the oracle in every state', () => {
  const cases = [
    { default: 'A', ':hover': 'B' },
    { default: 'A', ':hover': { default: 'B', '@media (width >= 768px)': 'C' }, ':focus-visible': 'D' },
    { default: 'A', '[aria-expanded="true"]': 'B', ':disabled': 'C', ':hover': { default: 'D', ':disabled': 'E' } },
    { ':hover': { '@media (hover: hover)': 'A' }, '@media (width >= 1px)': { ':not(:hover)': 'B' } },
    { default: 'A', ':hover': null, ':focus': 'C' },
    { default: 'A', '@media (a: 1)': 'B', '@media not (a: 1)': 'C', '@supports (x: y)': { ':hover': 'D' } },
  ];
  for (const c of cases) {
    assertExclusive(c);
    assertMatchesOracle(c);
  }
});

test('random condition trees are exclusive and match the oracle (property-based)', () => {
  const keys = [':hover', ':focus', ':not(:hover)', '[data-a]', ':disabled', '@media (width >= 768px)', '@media not (width >= 768px)', '@supports (display: grid)', '@container (width > 1px)'];
  const values = ['A', 'B', 'C', 'D', null];
  const random = rng(20261029);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const gen = (depth) => {
    if (depth > 2 || random() < 0.35) return pick(values);
    const node = {};
    if (random() < 0.7) node.default = pick(values);
    const n = 1 + Math.floor(random() * 3);
    for (let i = 0; i < n; i++) node[pick(keys)] = gen(depth + 1);
    return node;
  };
  let checked = 0;
  for (let i = 0; i < 400; i++) {
    const tree = gen(0);
    if (tree === null || typeof tree !== 'object') continue;
    assertExclusive(tree);
    assertMatchesOracle(tree);
    checked++;
  }
  assert.ok(checked > 200);
});
