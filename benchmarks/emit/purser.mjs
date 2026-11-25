// Purser sources for the spec: a tokens module and one .tsx file per component.
import fs from 'node:fs';
import path from 'node:path';
import { BREAKPOINTS, COLORS, FONT_SIZE, RADIUS, SPACE } from '../spec.mjs';

const COND = {
  hover: `':hover'`,
  focusVisible: `':focus-visible'`,
  disabled: `':disabled'`,
  selected: `'[aria-selected="true"]'`,
  md: '[bp.md]',
  lg: '[bp.lg]',
};

function lit(v) {
  switch (v.kind) {
    case 'keyword':
      return JSON.stringify(v.value);
    case 'number':
      return JSON.stringify(String(v.value));
    case 'px':
      return JSON.stringify(`${v.value}px`);
    case 'space':
      return `t.space[${v.value}]`;
    case 'color':
      return `t.color.${v.value}`;
    case 'radius':
      return `t.radius.${v.value}`;
    case 'fontSize':
      return `t.fontSize.${v.value}`;
    default:
      throw new Error(v.kind);
  }
}

function decl(d) {
  if (d.conditions.length === 0) return `${d.prop}: ${lit(d.value)}`;
  return `${d.prop}: { default: ${lit(d.value)}, ${d.conditions.map((c) => `${COND[c.when]}: ${lit(c.value)}`).join(', ')} }`;
}

export function emitPurser(spec, dir, { packageName = '@avonao/purser' } = {}) {
  fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  const colors = Object.entries(COLORS).map(([k, [light, dark]]) => `      ${k}: { default: '${light}', 'mode=dark': '${dark}' },`);
  fs.writeFileSync(
    path.join(dir, 'lib/tokens.ts'),
    `import { defineTokens } from '${packageName}';

export const bp = { md: '@media (width >= ${BREAKPOINTS.md}px)', lg: '@media (width >= ${BREAKPOINTS.lg}px)' } as const;

export const t = defineTokens({
  axes: { mode: { light: ':not(.dark)', dark: '.dark' } },
  tokens: {
    color: {
${colors.join('\n')}
    },
    space: { ${SPACE.map((n) => `${n}: '${n * 4}px'`).join(', ')} },
    radius: { ${Object.entries(RADIUS).map(([k, v]) => `${k}: '${v}px'`).join(', ')} },
    fontSize: { ${Object.entries(FONT_SIZE).map(([k, v]) => `${k}: '${v}px'`).join(', ')} },
  },
});
`,
  );
  const names = [];
  for (const c of spec.components) {
    names.push(c.name);
    const styles = [`  base: {\n${c.base.map((d) => `    ${decl(d)},`).join('\n')}\n  },`];
    for (const v of c.variants) styles.push(`  ${v.name}: {\n${v.style.map((d) => `    ${decl(d)},`).join('\n')}\n  },`);
    const flags = c.variants.map((v) => v.name);
    fs.writeFileSync(
      path.join(dir, 'components', `${c.name}.tsx`),
      `import type { ReactNode } from 'react';
import { css } from '${packageName}';
import { bp, t } from '../lib/tokens';

const s = css.create({
${styles.join('\n')}
});

export type ${c.name}Props = { ${flags.map((f) => `${f}?: boolean`).join('; ')}; children?: ReactNode };

export function ${c.name}Class(p: ${c.name}Props): string {
  return css.props(s.base${flags.map((f) => `, p.${f} && s.${f}`).join('')});
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
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true } }, null, 2));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bench-purser', private: true, type: 'module' }, null, 2));
}
