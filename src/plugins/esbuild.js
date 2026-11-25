// esbuild plugin: compile Purser styles while bundling, and write the stylesheet when given the source directories.
//
//   import { purserEsbuild } from '@avonao/purser/esbuild';
//   await esbuild.build({
//     …,
//     plugins: [purserEsbuild({ tokens: 'lib/tokens.ts', src: ['app', 'components', 'lib'], out: 'app/purser.css' })],
//   });
//
// Build-only module.

import fs from 'node:fs';
import path from 'node:path';
import { createPluginCore, formatDiagnostics, inlineMap } from './shared.js';

const LOADER = { '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx', '.jsx': 'jsx', '.js': 'js', '.mjs': 'js', '.cjs': 'js' };

/**
 * @param {import('./shared.js').PluginOptions} [options]
 * @returns {{ name: string, setup(build: any): void }}
 */
export function purserEsbuild(options = {}) {
  return {
    name: 'purser',
    setup(build) {
      const core = createPluginCore(options, { projectDir: build.initialOptions.absWorkingDir, minify: build.initialOptions.minify === true });
      if (core.builder) {
        build.onStart(async () => {
          const result = await core.buildStylesheet();
          const errors = result.diagnostics.filter((d) => d.severity === 'error');
          return {
            errors: errors.map((d) => ({ text: d.message, location: d.file ? { file: d.file, line: d.line, column: (d.column ?? 1) - 1 } : null })),
            warnings: result.diagnostics.filter((d) => d.severity !== 'error').map((d) => ({ text: formatDiagnostics([d], core.projectDir) })),
          };
        });
      }
      if (!core.compiler) return;
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        if (args.namespace !== 'file' || args.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
        const code = await fs.promises.readFile(args.path, 'utf8');
        const result = await core.compiler.transform(code, args.path);
        if (!result) return undefined;
        return { contents: result.code + inlineMap(result.map), loader: LOADER[path.extname(args.path)] ?? 'js' };
      });
    },
  };
}

export default purserEsbuild;
