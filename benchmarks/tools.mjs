// One entry per tool: how its sources are written, how its stylesheet is built (a separate process, the way a project
// runs it) and how its component modules are bundled for the browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitPanda } from './emit/panda.mjs';
import { emitPurser } from './emit/purser.mjs';
import { emitStylex } from './emit/stylex.mjs';
import { emitTailwind, emitUno } from './emit/utility.mjs';
import { emitVanillaExtract } from './emit/vanilla-extract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = (name) => path.join(here, 'node_modules/.bin', name);
const purserBin = path.join(here, '..', 'bin', 'purser.js');
const script = (name) => path.join(here, 'scripts', name);

/** esbuild plugin: the benchmark measures styling code, so React's JSX runtime is replaced by an empty module. */
export const noReact = {
  name: 'no-react',
  setup(build) {
    build.onResolve({ filter: /^react(\/jsx-runtime)?$/ }, (args) => ({ path: args.path, namespace: 'no-react' }));
    build.onLoad({ filter: /.*/, namespace: 'no-react' }, () => ({ contents: 'export const jsx = () => null; export const jsxs = jsx; export const Fragment = null;', loader: 'js' }));
  },
};

/** Purser's extraction cache lives in the project's node_modules/.cache: removing it makes the next build a cold one. */
const coldPurser = (dir) => fs.rmSync(path.join(dir, 'node_modules/.cache'), { recursive: true, force: true });
const emitPurserProject = (spec, dir) => {
  emitPurser(spec, dir);
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
};
const purserArgs = (dir, ...more) => [purserBin, 'build', '--project', dir, '--src', 'components,lib', '--tokens', 'lib/tokens.ts', '--out', 'out.css', ...more];

export const TOOLS = [
  ...['exact', 'balanced', 'max'].map((level) => ({
    id: `purser-${level}`,
    label: `Purser (compiled, fuse: ${level})`,
    note: `rule granularity, minified stylesheet, names given by the build, classes fused (${level})`,
    emit: emitPurserProject,
    build: (dir) => ({ cmd: process.execPath, args: purserArgs(dir, '--granularity', 'rule', '--minify', '--names', 'min', '--fuse', level), css: 'out.css' }),
    clean: coldPurser,
    plugins: async (dir) => [
      (await import('@avonao/purser/esbuild')).purserEsbuild({ projectDir: dir, tokens: 'lib/tokens.ts', src: ['components', 'lib'], out: 'out.css', minify: true, granularity: 'rule', names: 'min', fuse: level }),
    ],
  })),
  {
    id: 'purser-min',
    label: 'Purser (compiled, minimal names)',
    note: 'the production setup: rule granularity, minified stylesheet, names given by the build',
    emit: emitPurserProject,
    // The plugin writes the stylesheet too; the CLI call with the same options is what is timed.
    build: (dir) => ({ cmd: process.execPath, args: purserArgs(dir, '--granularity', 'rule', '--minify', '--names', 'min'), css: 'out.css' }),
    clean: coldPurser,
    plugins: async (dir) => [
      (await import('@avonao/purser/esbuild')).purserEsbuild({ projectDir: dir, tokens: 'lib/tokens.ts', src: ['components', 'lib'], out: 'out.css', minify: true, granularity: 'rule', names: 'min' }),
    ],
  },
  {
    id: 'purser-compiled',
    label: 'Purser (compiled, hashed names)',
    note: 'rule granularity and a minified stylesheet, with names that need no registry',
    emit: emitPurserProject,
    build: (dir) => ({ cmd: process.execPath, args: purserArgs(dir, '--granularity', 'rule', '--minify'), css: 'out.css' }),
    clean: coldPurser,
    plugins: async (dir) => [(await import('@avonao/purser/esbuild')).purserEsbuild({ projectDir: dir, tokens: 'lib/tokens.ts', granularity: 'rule' })],
  },
  {
    id: 'purser',
    label: 'Purser (runtime, 0.1 defaults)',
    note: 'no compiler: css.create runs in the browser, one class per property',
    emit: emitPurserProject,
    build: (dir) => ({ cmd: process.execPath, args: purserArgs(dir), css: 'out.css' }),
    clean: coldPurser,
  },
  {
    id: 'stylex',
    label: 'StyleX',
    emit: emitStylex,
    build: (dir) => ({ cmd: process.execPath, args: [script('stylex-build.mjs'), dir], css: 'out.css' }),
    plugins: async (dir) => [(await import('./scripts/stylex-plugin.mjs')).stylexEsbuild(dir)],
  },
  {
    id: 'tailwind',
    label: 'Tailwind CSS',
    emit: (spec, dir) => emitTailwind(spec, dir),
    build: (dir) => ({ cmd: bin('tailwindcss'), args: ['-i', 'input.css', '-o', 'out.css'], css: 'out.css' }),
  },
  {
    id: 'tailwind-merge',
    label: 'Tailwind CSS + tailwind-merge',
    emit: (spec, dir) => emitTailwind(spec, dir, { merge: true }),
    build: (dir) => ({ cmd: bin('tailwindcss'), args: ['-i', 'input.css', '-o', 'out.css'], css: 'out.css' }),
  },
  {
    id: 'unocss',
    label: 'UnoCSS',
    emit: emitUno,
    build: (dir) => ({ cmd: bin('unocss'), args: ['components/**/*.tsx', '-o', 'out.css'], css: 'out.css' }),
  },
  {
    id: 'panda',
    label: 'Panda CSS',
    emit: emitPanda,
    prepare: (dir) => ({ cmd: bin('panda'), args: ['codegen', '--silent'] }),
    build: (dir) => ({ cmd: bin('panda'), args: ['cssgen', '--silent', '--outfile', 'out.css'], css: 'out.css' }),
  },
  {
    id: 'vanilla-extract',
    label: 'vanilla-extract',
    emit: emitVanillaExtract,
    build: (dir) => ({ cmd: process.execPath, args: [script('vanilla-extract-build.mjs'), dir], css: 'out.css' }),
    bundleFromBuild: 'out.js',
  },
];
