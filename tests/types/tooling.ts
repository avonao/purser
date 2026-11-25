// Type-level checks of the build, compiler and plugin entries (compiled by tests/types.test.js, never run).
import { build, createBuilder, type BuildOptions } from '@avonao/purser/build';
import { props, styles } from '@avonao/purser/compiled';
import { createCompiler } from '@avonao/purser/compiler';
import { purserEsbuild } from '@avonao/purser/esbuild';
import { purser } from '@avonao/purser/vite';
import { PurserWebpackPlugin } from '@avonao/purser/webpack';

const options: BuildOptions = { projectDir: '.', src: ['src'], tokens: 'tokens.ts', out: 'purser.css', granularity: 'rule', names: 'min', namesFile: 'names.json', minify: true, cache: false, threads: 0 };
const builder = createBuilder(options);
const compiler = createCompiler({ projectDir: '.', tokens: 'tokens.ts', granularity: 'rule', names: 'min', registry: builder.registry ?? undefined });

export async function run(): Promise<string | null> {
  const result = await build(options);
  const names: Record<string, string> | null = result.names;
  const compiled = await compiler.transform('', '/x.ts');
  const folded: number = compiled ? compiled.stats.folded : 0;
  void [names, folded];
  return result.css;
}

const s = styles({ a: { color: 'x1' }, b: { color: null } });
const cls: string = props(s.a, false, [s.b]);
// @ts-expect-error a plain object is not a style
props({ color: 'x1' });
// @ts-expect-error unknown build option
build({ projectDir: '.', src: [], mangle: true });

export const plugins = [
  purser({ tokens: 'src/tokens.ts', src: ['src'], out: 'src/purser.css' }),
  purserEsbuild({ tokens: 'src/tokens.ts', names: 'short' }),
  new PurserWebpackPlugin({ tokens: 'lib/tokens.ts', src: ['app'], out: 'app/purser.css', compile: false }),
  cls,
];
