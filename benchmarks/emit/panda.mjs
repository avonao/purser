// Panda CSS sources: a config with the tokens and one .tsx file per component that calls css().
import fs from 'node:fs';
import path from 'node:path';
import { BREAKPOINTS, COLORS, FONT_SIZE, RADIUS, SPACE } from '../spec.mjs';

const COND = { hover: '_hover', focusVisible: '_focusVisible', disabled: '_disabled', selected: '_selected', md: 'md', lg: 'lg' };

function lit(v) {
  switch (v.kind) {
    case 'keyword':
      return JSON.stringify(v.value);
    case 'number':
      return JSON.stringify(String(v.value));
    case 'px':
      return JSON.stringify(`${v.value}px`);
    case 'space':
      return JSON.stringify(`s${v.value}`);
    case 'color':
    case 'radius':
    case 'fontSize':
      return JSON.stringify(v.value);
    default:
      throw new Error(v.kind);
  }
}

function decl(d) {
  if (d.conditions.length === 0) return `${d.prop}: ${lit(d.value)}`;
  return `${d.prop}: { base: ${lit(d.value)}, ${d.conditions.map((c) => `${COND[c.when]}: ${lit(c.value)}`).join(', ')} }`;
}

export function emitPanda(spec, dir) {
  fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'panda.config.ts'),
    `import { defineConfig } from '@pandacss/dev';

export default defineConfig({
  preflight: false,
  presets: [],
  include: ['./components/**/*.tsx'],
  outdir: 'styled-system',
  conditions: { extend: { dark: '.dark &', selected: '&[aria-selected="true"]', hover: '&:hover', focusVisible: '&:focus-visible', disabled: '&:disabled' } },
  theme: {
    breakpoints: { md: '${BREAKPOINTS.md}px', lg: '${BREAKPOINTS.lg}px' },
    tokens: {
      spacing: { ${SPACE.map((n) => `s${n}: { value: '${n * 4}px' }`).join(', ')} },
      radii: { ${Object.entries(RADIUS).map(([k, v]) => `${k}: { value: '${v}px' }`).join(', ')} },
      fontSizes: { ${Object.entries(FONT_SIZE).map(([k, v]) => `${k}: { value: '${v}px' }`).join(', ')} },
    },
    semanticTokens: {
      colors: { ${Object.entries(COLORS).map(([k, [l, d]]) => `${k}: { value: { base: '${l}', _dark: '${d}' } }`).join(', ')} },
    },
  },
});
`,
  );
  const names = [];
  for (const c of spec.components) {
    names.push(c.name);
    const flags = c.variants.map((v) => v.name);
    fs.writeFileSync(
      path.join(dir, 'components', `${c.name}.tsx`),
      `import type { ReactNode } from 'react';
import { css } from '../styled-system/css';

const s = {
  base: css.raw({ ${c.base.map(decl).join(', ')} }),
${c.variants.map((v) => `  ${v.name}: css.raw({ ${v.style.map(decl).join(', ')} }),`).join('\n')}
};

export type ${c.name}Props = { ${flags.map((f) => `${f}?: boolean`).join('; ')}; children?: ReactNode };

export function ${c.name}Class(p: ${c.name}Props): string {
  return css(s.base${flags.map((f) => `, p.${f} && s.${f}`).join('')});
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
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bench-panda', private: true, type: 'module' }, null, 2));
}
