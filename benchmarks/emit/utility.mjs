// Utility-class sources (Tailwind CSS 4 and UnoCSS preset-wind4 share the class names used here).
import fs from 'node:fs';
import path from 'node:path';
import { BREAKPOINTS, COLORS, FONT_SIZE, RADIUS } from '../spec.mjs';

const KEYWORDS = {
  display: { flex: 'flex', block: 'block', grid: 'grid', 'inline-flex': 'inline-flex', none: 'hidden' },
  flexDirection: { row: 'flex-row', column: 'flex-col' },
  alignItems: { center: 'items-center', 'flex-start': 'items-start', 'flex-end': 'items-end', stretch: 'items-stretch' },
  justifyContent: { 'space-between': 'justify-between', center: 'justify-center', 'flex-start': 'justify-start', 'flex-end': 'justify-end' },
  borderStyle: { solid: 'border-solid', dashed: 'border-dashed' },
  cursor: { pointer: 'cursor-pointer', 'not-allowed': 'cursor-not-allowed', default: 'cursor-default' },
  position: { relative: 'relative', absolute: 'absolute', sticky: 'sticky' },
  textAlign: { left: 'text-left', center: 'text-center', right: 'text-right' },
  fontWeight: { 400: 'font-normal', 500: 'font-medium', 600: 'font-semibold', 700: 'font-bold' },
  lineHeight: { 1.5: 'leading-normal', 1.25: 'leading-tight', 1: 'leading-none' },
  opacity: { 1: 'opacity-100', 0.75: 'opacity-75', 0.5: 'opacity-50' },
  zIndex: { 10: 'z-10', 20: 'z-20', 50: 'z-50' },
};
const SCALE = { gap: 'gap', paddingInline: 'px', paddingBlock: 'py', marginTop: 'mt', marginBottom: 'mb', width: 'w', height: 'h' };
const VARIANT = { hover: 'hover:', focusVisible: 'focus-visible:', disabled: 'disabled:', selected: 'aria-selected:', md: 'md:', lg: 'lg:' };

export function utility(prop, v) {
  if (KEYWORDS[prop] && v.kind !== 'px') {
    const cls = KEYWORDS[prop][v.value];
    if (cls) return cls;
  }
  switch (prop) {
    case 'color':
      return `text-${v.value}`;
    case 'backgroundColor':
      return `bg-${v.value}`;
    case 'borderColor':
      return `border-${v.value}`;
    case 'borderWidth':
      return v.value === 1 ? 'border' : `border-${v.value}`;
    case 'borderRadius':
      return `rounded-${v.value}`;
    case 'fontSize':
      return `text-${v.value}`;
    default:
      break;
  }
  if (SCALE[prop]) {
    if (v.kind === 'space') return `${SCALE[prop]}-${v.value}`;
    if (v.kind === 'px') return `${SCALE[prop]}-[${v.value}px]`;
    if (v.kind === 'keyword' && v.value === '100%') return `${SCALE[prop]}-full`;
  }
  throw new Error(`no utility for ${prop}: ${JSON.stringify(v)}`);
}

export function classList(style) {
  const out = [];
  for (const d of style) {
    out.push(utility(d.prop, d.value));
    for (const c of d.conditions) out.push(VARIANT[c.when] + utility(d.prop, c.value));
  }
  return out.join(' ');
}

/** Component files: static class strings joined with `join` (clsx, or tailwind-merge over clsx). */
function emitComponents(spec, dir, joinImport, joinCall) {
  fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
  const names = [];
  for (const c of spec.components) {
    names.push(c.name);
    const flags = c.variants.map((v) => v.name);
    fs.writeFileSync(
      path.join(dir, 'components', `${c.name}.tsx`),
      `import type { ReactNode } from 'react';
${joinImport}

const s = {
  base: '${classList(c.base)}',
${c.variants.map((v) => `  ${v.name}: '${classList(v.style)}',`).join('\n')}
};

export type ${c.name}Props = { ${flags.map((f) => `${f}?: boolean`).join('; ')}; children?: ReactNode };

export function ${c.name}Class(p: ${c.name}Props): string {
  return ${joinCall}(s.base${flags.map((f) => `, p.${f} && s.${f}`).join('')});
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
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'bench-utility', private: true, type: 'module' }, null, 2));
}

const themeVars = () => [
  ...Object.entries(COLORS).map(([k, [light]]) => `  --color-${k}: ${light};`),
  ...Object.entries(RADIUS).map(([k, v]) => `  --radius-${k}: ${v}px;`),
  ...Object.entries(FONT_SIZE).map(([k, v]) => `  --text-${k}: ${v}px;`),
];

export function emitTailwind(spec, dir, { merge = false } = {}) {
  emitComponents(
    spec,
    dir,
    merge ? `import { clsx } from 'clsx';\nimport { twMerge } from 'tailwind-merge';\nconst cn = (...a: unknown[]) => twMerge(clsx(a));` : `import { clsx } from 'clsx';`,
    merge ? 'cn' : 'clsx',
  );
  // The theme is replaced, so `text-sm` writes a font size only and every colour is a project token.
  fs.writeFileSync(
    path.join(dir, 'input.css'),
    `@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@source "./components";
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-*: initial;
  --radius-*: initial;
  --text-*: initial;
  --breakpoint-*: initial;
  --breakpoint-md: ${BREAKPOINTS.md}px;
  --breakpoint-lg: ${BREAKPOINTS.lg}px;
  --spacing: 4px;
${themeVars().join('\n')}
}

@layer base {
  .dark {
${Object.entries(COLORS).map(([k, [, dark]]) => `    --color-${k}: ${dark};`).join('\n')}
  }
}
`,
  );
}

export function emitUno(spec, dir) {
  emitComponents(spec, dir, `import { clsx } from 'clsx';`, 'clsx');
  fs.writeFileSync(
    path.join(dir, 'uno.config.ts'),
    `import { defineConfig } from 'unocss';
import presetWind4 from '@unocss/preset-wind4';

export default defineConfig({
  presets: [presetWind4({ preflights: { reset: false } })],
  theme: {
    colors: { ${Object.entries(COLORS).map(([k, [light]]) => `${k}: '${light}'`).join(', ')} },
    radius: { ${Object.entries(RADIUS).map(([k, v]) => `${k}: '${v}px'`).join(', ')} },
    text: { ${Object.entries(FONT_SIZE).map(([k, v]) => `${k}: { fontSize: '${v}px' }`).join(', ')} },
    breakpoint: { md: '${BREAKPOINTS.md}px', lg: '${BREAKPOINTS.lg}px' },
    spacing: { DEFAULT: '4px' },
  },
  preflights: [{ getCSS: () => '.dark{${Object.entries(COLORS).map(([k, [, dark]]) => `--colors-${k}:${dark}`).join(';')}}' }],
});
`,
  );
}
