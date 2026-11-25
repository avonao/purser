// vanilla-extract stylesheet for a project: its esbuild plugin evaluates every .css.ts file while bundling.
import path from 'node:path';
import { build } from 'esbuild';
import { vanillaExtractPlugin } from '@vanilla-extract/esbuild-plugin';
import { noReact } from '../tools.mjs';

const dir = path.resolve(process.argv[2]);
await build({
  absWorkingDir: dir,
  entryPoints: { out: 'classes.ts' },
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  outdir: dir,
  logLevel: 'error',
  plugins: [vanillaExtractPlugin({ identifiers: 'short' }), noReact],
});
