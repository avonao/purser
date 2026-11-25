// vanilla-extract sources: a theme contract, one .css.ts file and one .tsx file per component.
import fs from 'node:fs';
import path from 'node:path';
import { BREAKPOINTS, COLORS, FONT_SIZE, RADIUS, SPACE } from '../spec.mjs';

const SELECTOR = { hover: '&:hover', focusVisible: '&:focus-visible', disabled: '&:disabled', selected: '&[aria-selected="true"]' };
const MEDIA = { md: `(min-width: ${BREAKPOINTS.md}px)`, lg: `(min-width: ${BREAKPOINTS.lg}px)` };

function lit(v) {
  switch (v.kind) {
    case 'keyword':
      return JSON.stringify(v.value);
    case 'number':
      return String(v.value);
    case 'px':
      return JSON.stringify(`${v.value}px`);
    case 'space':
      return `vars.space[${v.value}]`;
    case 'color':
      return `vars.color.${v.value}`;
    case 'radius':
      return `vars.radius.${v.value}`;
    case 'fontSize':
      return `vars.fontSize.${v.value}`;
    default:
      throw new Error(v.kind);
  }
}

function block(style) {
  const lines = style.map((d) => `  ${d.prop}: ${lit(d.value)},`);
  const selectors = new Map();
  const media = new Map();
  for (const d of style) {
    for (const c of d.conditions) {
      const target = SELECTOR[c.when] ? selectors : media;
      const key = SELECTOR[c.when] ?? MEDIA[c.when];
      if (!target.has(key)) target.set(key, []);
      target.get(key).push(`${d.prop}: ${lit(c.value)}`);
    }
  }
  if (selectors.size) lines.push(`  selectors: { ${[...selectors].map(([k, v]) => `${JSON.stringify(k)}: { ${v.join(', ')} }`).join(', ')} },`);
  if (media.size) lines.push(`  '@media': { ${[...media].map(([k, v]) => `${JSON.stringify(k)}: { ${v.join(', ')} }`).join(', ')} },`);
  return `{\n${lines.join('\n')}\n}`;
}

export function emitVanillaExtract(spec, dir) {
  fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  const colors = (i) => `{ ${Object.entries(COLORS).map(([k, v]) => `${k}: '${v[i]}'`).join(', ')} }`;
  fs.writeFileSync(
    path.join(dir, 'lib/theme.css.ts'),
    `import { createGlobalTheme, createGlobalThemeContract } from '@vanilla-extract/css';

export const vars = createGlobalThemeContract(
  {
    color: { ${Object.keys(COLORS).map((k) => `${k}: 'color-${k}'`).join(', ')} },
    space: { ${SPACE.map((n) => `${n}: 'space-${n}'`).join(', ')} },
    radius: { ${Object.keys(RADIUS).map((k) => `${k}: 'radius-${k}'`).join(', ')} },
    fontSize: { ${Object.keys(FONT_SIZE).map((k) => `${k}: 'font-size-${k}'`).join(', ')} },
  },
  (value) => value,
);

const shared = {
  space: { ${SPACE.map((n) => `${n}: '${n * 4}px'`).join(', ')} },
  radius: { ${Object.entries(RADIUS).map(([k, v]) => `${k}: '${v}px'`).join(', ')} },
  fontSize: { ${Object.entries(FONT_SIZE).map(([k, v]) => `${k}: '${v}px'`).join(', ')} },
};
createGlobalTheme(':root', vars, { color: ${colors(0)}, ...shared });
createGlobalTheme('.dark', vars, { color: ${colors(1)}, ...shared });
`,
  );
  const names = [];
  for (const c of spec.components) {
    names.push(c.name);
    const flags = c.variants.map((v) => v.name);
    fs.writeFileSync(
      path.join(dir, 'components', `${c.name}.css.ts`),
      `import { style } from '@vanilla-extract/css';
import { vars } from '../lib/theme.css';

export const base = style(${block(c.base)});
${c.variants.map((v) => `export const ${v.name} = style(${block(v.style)});`).join('\n')}
`,
    );
    fs.writeFileSync(
      path.join(dir, 'components', `${c.name}.tsx`),
      `import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import * as s from './${c.name}.css';

export type ${c.name}Props = { ${flags.map((f) => `${f}?: boolean`).join('; ')}; children?: ReactNode };

export function ${c.name}Class(p: ${c.name}Props): string {
  return clsx(s.base${flags.map((f) => `, p.${f} && s.${f}`).join('')});
}

export function ${c.name}(p: ${c.name}Props) {
  return <div className={${c.name}Class(p)}>{p.children}</div>;
}
`,
    );
  }
  fs.writeFileSync(
    path.join(dir, 'classes.ts'),
    `${names.map((n) => `import { ${n}Class } from './components/${n}';`).join('\n')}\n\nexport const classes: Record<string, (p: Record<string, boolean>) => string> = { ${names.map((n) => `${n}: ${n}Class`).join(', ')} };\n`,
  );
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bench-vanilla-extract', private: true, type: 'module' }, null, 2));
}
