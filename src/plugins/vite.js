// Vite plugin (also a Rollup plugin): compile Purser styles, and write the stylesheet when given the source directories.
//
//   // vite.config.ts
//   import { purser } from '@avonao/purser/vite';
//   export default defineConfig({
//     plugins: [purser({ tokens: 'src/tokens.ts', src: ['src'], out: 'src/purser.css' })],
//   });
//
// With src and out the plugin replaces the `purser build` step: it writes the stylesheet before the first module is
// compiled and again whenever a source file changes, and a stylesheet that would break a rule fails the build. In a
// production build the stylesheet is minified unless `minify: false`.
//
// Build-only module.

import path from 'node:path';
import { isSourceFile } from '../build/files.js';
import { createPluginCore, formatDiagnostics } from './shared.js';

/**
 * @param {import('./shared.js').PluginOptions} [options]
 */
export function purser(options = {}) {
  let core = null;
  let root = options.projectDir;
  let production = false;
  // Fused classes need a build that compiles every module once: not a dev server, not a watching build.
  let oneShot = true;
  let timer = null;
  let warn = (message) => console.warn(message);
  const ready = () => (core ??= createPluginCore(options, { projectDir: root, minify: production, oneShot }));

  async function writeStylesheet(fail) {
    const result = await ready().buildStylesheet();
    if (!result) return;
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    const warnings = result.diagnostics.filter((d) => d.severity !== 'error');
    if (warnings.length) warn(`purser: ${formatDiagnostics(warnings, core.projectDir)}`);
    if (errors.length) fail(`purser: the stylesheet was not written\n${formatDiagnostics(errors, core.projectDir)}`);
  }

  const ownSource = (file) => {
    const c = ready();
    if (!c.builder) return false;
    const clean = file.split('?')[0];
    if (clean === c.outFile) return false;
    return isSourceFile(clean) && !clean.includes('/node_modules/') && (clean.startsWith(c.projectDir + path.sep) || clean === c.compiler?.tokensFile);
  };

  const schedule = (file) => {
    if (!ownSource(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      writeStylesheet(warn).catch((err) => warn(`purser: ${err.message}`));
    }, 40);
  };

  return {
    name: 'purser',
    enforce: 'pre',
    configResolved(config) {
      root ??= config.root;
      production = config.command === 'build' && config.mode !== 'development';
      oneShot = config.command === 'build' && !config.build?.watch;
      warn = (message) => config.logger.warn(message);
    },
    async buildStart() {
      if (this.meta?.watchMode) oneShot = false; // Rollup's watch mode
      await writeStylesheet((message) => this.error(message));
    },
    async transform(code, id) {
      const c = ready();
      if (!c.compiler || id.startsWith('\0')) return null;
      const result = await c.compiler.transform(code, id);
      return result ? { code: result.code, map: result.map } : null;
    },
    // Rollup watch mode and Vite's dev server: a changed source file means a new stylesheet. Errors are printed and
    // the last good stylesheet stays, the way `purser build --watch` behaves.
    watchChange(id) {
      schedule(id);
    },
    configureServer(server) {
      for (const event of ['change', 'add', 'unlink']) server.watcher.on(event, schedule);
    },
  };
}

export default purser;
