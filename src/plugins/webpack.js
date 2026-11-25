// webpack plugin: write the Purser stylesheet before every compilation and compile the modules.
//
//   import { PurserWebpackPlugin } from '@avonao/purser/webpack';
//   plugins: [new PurserWebpackPlugin({ tokens: 'lib/tokens.ts', src: ['app', 'components', 'lib'], out: 'app/purser.css' })]
//
// It adds the loader rule itself. With names "min" it keeps the names in `namesFile` (default
// node_modules/.cache/purser/names.json) so the loader, which may run in another process, reads the same ones.
//
// Build-only module.

import { createRequire } from 'node:module';
import path from 'node:path';
import { createPluginCore, formatDiagnostics } from './shared.js';

const require = createRequire(import.meta.url);

export class PurserWebpackPlugin {
  /** @param {import('./shared.js').PluginOptions} [options] */
  constructor(options = {}) {
    this.options = options;
  }

  apply(compiler) {
    const projectDir = path.resolve(this.options.projectDir ?? compiler.context ?? process.cwd());
    const production = compiler.options.mode === 'production';
    const options = { ...this.options, projectDir };
    if (options.names === 'min' && !options.namesFile) options.namesFile = 'node_modules/.cache/purser/names.json';
    // Fused classes need a build that compiles every module once: a production build that does not watch.
    const oneShot = production && !compiler.options.watch;
    const core = createPluginCore({ ...options, compile: false }, { projectDir, minify: production, oneShot });
    if (core.fuse) {
      compiler.hooks.watchRun.tap('purser', () => {
        throw new Error('purser: fuse cannot be used with a watching build (a fused class depends on every module); remove it or build once');
      });
    }
    const run = async (compilation) => {
      const result = await core.buildStylesheet();
      if (!result) return;
      for (const d of result.diagnostics) {
        const error = new Error(`purser: ${formatDiagnostics([d], projectDir)}`);
        (d.severity === 'error' ? compilation.errors : compilation.warnings).push(error);
      }
    };
    // The stylesheet (and with names "min" the names file the loader reads) must exist before modules are built.
    compiler.hooks.beforeCompile.tapPromise('purser', async () => {
      await core.buildStylesheet();
    });
    compiler.hooks.thisCompilation.tap('purser', (compilation) => {
      compilation.hooks.finishModules.tapPromise('purser', () => run(compilation));
    });
    if (options.compile === false) return;
    // The loader takes the names, fused or not, from the names file this plugin's build keeps.
    const { src: _src, out: _out, minify: _minify, layers: _layers, compile: _compile, fuse: _fuse, ...loaderOptions } = options;
    compiler.options.module.rules.unshift({
      test: /\.[cm]?[jt]sx?$/,
      exclude: /node_modules/,
      enforce: 'pre',
      use: [{ loader: require.resolve('./webpack-loader.cjs'), options: loaderOptions }],
    });
  }
}

export default PurserWebpackPlugin;
