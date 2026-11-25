// StyleX sources: variables in tokens.stylex.ts, one .tsx file per component.
import fs from 'node:fs';
import path from 'node:path';
import { BREAKPOINTS, COLORS, FONT_SIZE, RADIUS, SPACE } from '../spec.mjs';

const COND = {
  hover: `':hover'`,
  focusVisible: `':focus-visible'`,
  disabled: `':disabled'`,
  selected: `'[aria-selected="true"]'`,
  md: `'@media (min-width: ${BREAKPOINTS.md}px)'`,
  lg: `'@media (min-width: ${BREAKPOINTS.lg}px)'`,
};

function lit(v) {
  switch (v.kind) {
    case 'keyword':
      return JSON.stringify(v.value);
    case 'number':
      return String(v.value);
    case 'px':
      return JSON.stringify(`${v.value}px`);
    case 'space':
      return `space.s${v.value}`;
    case 'color':
      return `color.${v.value}`;
    case 'radius':
      return `radius.${v.value}`;
    case 'fontSize':
      return `fontSize.${v.value}`;
    default:
      throw new Error(v.kind);
  }
}

function decl(d) {
  if (d.conditions.length === 0) return `${d.prop}: ${lit(d.value)}`;
  return `${d.prop}: { default: ${lit(d.value)}, ${d.conditions.map((c) => `${COND[c.when]}: ${lit(c.value)}`).join(', ')} }`;
}

export function emitStylex(spec, dir) {
  fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'lib/tokens.stylex.ts'),
    `import * as stylex from '@stylexjs/stylex';

export const color = stylex.defineVars({
${Object.entries(COLORS).map(([k, [light]]) => `  ${k}: '${light}',`).join('\n')}
});
export const space = stylex.defineVars({ ${SPACE.map((n) => `s${n}: '${n * 4}px'`).join(', ')} });
export const radius = stylex.defineVars({ ${Object.entries(RADIUS).map(([k, v]) => `${k}: '${v}px'`).join(', ')} });
export const fontSize = stylex.defineVars({ ${Object.entries(FONT_SIZE).map(([k, v]) => `${k}: '${v}px'`).join(', ')} });
`,
  );
  fs.writeFileSync(
    path.join(dir, 'lib/dark.ts'),
    `import * as stylex from '@stylexjs/stylex';
import { color } from './tokens.stylex';

export const dark = stylex.createTheme(color, {
${Object.entries(COLORS).map(([k, [, d]]) => `  ${k}: '${d}',`).join('\n')}
});
`,
  );
  const names = [];
  for (const c of spec.components) {
    names.push(c.name);
    const flags = c.variants.map((v) => v.name);
    const styles = [`  base: {\n${c.base.map((d) => `    ${decl(d)},`).join('\n')}\n  },`];
    for (const v of c.variants) styles.push(`  ${v.name}: {\n${v.style.map((d) => `    ${decl(d)},`).join('\n')}\n  },`);
    fs.writeFileSync(
      path.join(dir, 'components', `${c.name}.tsx`),
      `import type { ReactNode } from 'react';
import * as stylex from '@stylexjs/stylex';
import { color, fontSize, radius, space } from '../lib/tokens.stylex';

const s = stylex.create({
${styles.join('\n')}
});

export type ${c.name}Props = { ${flags.map((f) => `${f}?: boolean`).join('; ')}; children?: ReactNode };

export function ${c.name}Class(p: ${c.name}Props): string {
  return stylex.props(s.base${flags.map((f) => `, p.${f} && s.${f}`).join('')}).className ?? '';
}

export function ${c.name}(p: ${c.name}Props) {
  return <div {...stylex.props(s.base${flags.map((f) => `, p.${f} && s.${f}`).join('')})}>{p.children}</div>;
}
`,
    );
  }
  fs.writeFileSync(
    path.join(dir, 'classes.ts'),
    `${names.map((n) => `import { ${n}Class } from './components/${n}';`).join('\n')}\nexport { dark } from './lib/dark';\n\nexport const classes: Record<string, (p: Record<string, boolean>) => string> = { ${names.map((n) => `${n}: ${n}Class`).join(', ')} };\n`,
  );
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bench-stylex', private: true, type: 'module' }, null, 2));
}
