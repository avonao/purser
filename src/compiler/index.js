// The compiler API: one object per project that compiles modules as a bundler hands them over.
//
//   const compiler = createCompiler({ projectDir: '.', tokens: 'lib/tokens.ts' });
//   const result = await compiler.transform(code, '/abs/path/button.tsx');   // { code, map } or null
//
// The bundler plugins (./vite, ./esbuild, ./webpack-loader) are thin wrappers around it. Build-only module.

import fs from 'node:fs';
import path from 'node:path';
import { compilerOptions, loadTypeScript, real } from '../build/host.js';
import { isSourceFile } from '../build/files.js';
import { loadTokensModule } from '../build/load-tokens.js';
import { resolveNaming } from '../hash.js';
import { createNameRegistry } from '../names.js';
import { createAnyCss } from '../rule.js';
import { transformSource } from './transform.js';

/**
 * @typedef {object} CompilerOptions
 * @property {string} [projectDir]        project root (default: the working directory)
 * @property {string} [tokens]            tokens module, relative to projectDir
 * @property {string} [prefix]            must match the build and createCss({ prefix })
 * @property {string} [salt]
 * @property {"short"|"legacy"|"min"} [names]
 * @property {"property"|"rule"} [granularity]
 * @property {ReturnType<typeof createNameRegistry>} [registry]  with names "min": the registry of the build that writes the stylesheet
 * @property {string} [packageName]       runtime import specifier (default "@avonao/purser")
 * @property {string} [cssModule]         module exporting a custom `css = createCss({ … })`, relative to projectDir
 */

/**
 * @param {CompilerOptions} [options]
 */
export function createCompiler(options = {}) {
  const projectDir = path.resolve(options.projectDir ?? process.cwd());
  const packageName = options.packageName ?? '@avonao/purser';
  const tokensFile = options.tokens ? path.resolve(projectDir, options.tokens) : null;
  const tokensReal = tokensFile ? real(tokensFile) : null;
  const cssModuleReal = options.cssModule ? real(path.resolve(projectDir, options.cssModule)) : null;
  const base = resolveNaming({ prefix: options.prefix, salt: options.salt, names: options.names, granularity: options.granularity });
  // Minimal names come from the registry the stylesheet build fills (most used first). A class the build has not seen
  // (a module outside its source directories) still gets a name here, but no rule in the stylesheet.
  const registry = base.names === 'min' ? (options.registry ?? createNameRegistry({ prefix: base.minPrefix })) : null;
  const naming = registry ? { ...base, rename: (id) => registry.get(id) } : base;
  const css = createAnyCss(naming);
  const ts = loadTypeScript(projectDir);
  const tsOptions = compilerOptions(ts, projectDir);
  const resolutionCache = ts.createModuleResolutionCache(projectDir, (x) => x, tsOptions);
  const resolved = new Map(); // "spec\0dir" -> real path of the module, or null

  const resolve = (spec, fromFile) => {
    const key = `${spec}\u0000${path.dirname(fromFile)}`;
    if (!resolved.has(key)) {
      const r = ts.resolveModuleName(spec, fromFile, tsOptions, ts.sys, resolutionCache).resolvedModule;
      resolved.set(key, r ? real(r.resolvedFileName) : null);
    }
    return resolved.get(key);
  };

  let tokens = { exports: {} };
  let tokensStamp = null;
  let tokensError = null;
  async function ensureTokens() {
    if (!tokensFile) return;
    let stamp = 'missing';
    try {
      const st = fs.statSync(tokensFile);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      // loadTokensModule reports it
    }
    if (stamp === tokensStamp) return;
    tokensStamp = stamp;
    try {
      tokens = await loadTokensModule(tokensFile, { ts, packageName });
      tokensError = null;
    } catch (err) {
      tokens = { exports: {} };
      tokensError = err;
    }
  }

  const ctx = {
    ts,
    packageName,
    naming,
    css,
    resolveStatic: (spec, fromFile) => (tokensReal && resolve(spec, fromFile) === tokensReal ? tokens.exports : undefined),
    isCssModule: (spec, fromFile) => Boolean(cssModuleReal) && resolve(spec, fromFile) === cssModuleReal,
    isPure: (spec, fromFile) => Boolean(tokensReal) && resolve(spec, fromFile) === tokensReal,
  };

  /** Could this module have anything to compile? A cheap test for a bundler to run on every module. */
  function accepts(code, file) {
    const clean = file.split('?')[0];
    if (!isSourceFile(clean) || clean.includes('/node_modules/')) return false;
    return code.includes(packageName) || (cssModuleReal !== null && /\bcss\b/.test(code));
  }

  /**
   * Compile one module.
   * @param {string} code
   * @param {string} file absolute path (a query string is ignored)
   * @returns {Promise<null | { code: string, map: object, stats: object }>} null: nothing to compile, leave the module as it is
   */
  async function transform(code, file) {
    if (!accepts(code, file)) return null;
    await ensureTokens();
    if (tokensError) throw tokensError;
    const clean = file.split('?')[0];
    // The module that creates the custom `css` keeps the runtime: it is what the others are compiled against.
    if (cssModuleReal && real(clean) === cssModuleReal) return null;
    return transformSource(code, clean, ctx);
  }

  return { transform, accepts, projectDir, tokensFile, naming, packageName, registry };
}

export { transformSource } from './transform.js';
