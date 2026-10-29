// Build API: extract styles from a project and write one stylesheet.

import fs from 'node:fs';
import path from 'node:path';
import { compileStylesheet } from '../compile/stylesheet.js';
import { resolveNaming } from '../hash.js';
import { extractFile } from './extract.js';
import { findSourceFiles, isSourceFile } from './files.js';
import { compilerOptions, loadPostcss, loadTypeScript, real } from './host.js';
import { loadTokensModule } from './load-tokens.js';
import { selfCheck } from './selfcheck.js';

/**
 * @typedef {object} BuildOptions
 * @property {string} projectDir          host project root (where typescript/postcss resolve from)
 * @property {string[]} src               source directories or files, relative to projectDir
 * @property {string} [tokens]            tokens module path, relative to projectDir
 * @property {string} [out]               output CSS file, relative to projectDir (omit to only validate)
 * @property {string} [prefix]            class name prefix (default "x"); must match createCss({ prefix })
 * @property {string} [salt]              hash salt (default ""); must match createCss({ salt })
 * @property {string} [packageName]       runtime import specifier (default "@avonao/purser")
 * @property {string} [cssModule]         module exporting a custom `css = createCss({ … })`, relative to projectDir
 */

/**
 * @typedef {object} BuildResult
 * @property {string | null} css
 * @property {import('../compile/stylesheet.js').Diagnostic[]} diagnostics
 * @property {{ files: number, atoms: number, rules: number, keyframes: number, tokens: number }} stats
 * @property {boolean} written   true when the output file changed on disk
 * @property {string | null} outFile
 */

/**
 * Create a reusable builder (keeps a per-file extraction cache for watch mode).
 * @param {BuildOptions} options
 */
export function createBuilder(options) {
  const projectDir = path.resolve(options.projectDir);
  const packageName = options.packageName ?? '@avonao/purser';
  const tokensFile = options.tokens ? path.resolve(projectDir, options.tokens) : null;
  const outFile = options.out ? path.resolve(projectDir, options.out) : null;
  const cssModuleReal = options.cssModule ? real(path.resolve(projectDir, options.cssModule)) : null;
  const naming = resolveNaming({ prefix: options.prefix, salt: options.salt });
  const ts = loadTypeScript(projectDir);
  const postcss = loadPostcss(projectDir);
  const tsOptions = compilerOptions(ts, projectDir);
  const resolutionCache = ts.createModuleResolutionCache(projectDir, (x) => x, tsOptions);
  const cache = new Map(); // file -> { mtimeMs, size, tokensKey, result }

  /** @returns {Promise<BuildResult>} */
  async function run() {
    const diagnostics = [];
    let tokens = { definition: null, exports: {} };
    if (tokensFile) {
      try {
        tokens = await loadTokensModule(tokensFile);
      } catch (err) {
        diagnostics.push({ severity: 'error', message: err.message, file: tokensFile });
        return { css: null, diagnostics, stats: { files: 0, atoms: 0, rules: 0, keyframes: 0, tokens: 0 }, written: false, outFile };
      }
    }
    const tokensReal = tokensFile ? real(tokensFile) : null;
    // Extraction results depend on the static values of the tokens module.
    const tokensKey = JSON.stringify(tokens.exports);
    const staticCache = new Map();
    const resolveStatic = (spec, fromFile) => {
      const key = `${spec}\u0000${path.dirname(fromFile)}`;
      if (staticCache.has(key)) return staticCache.get(key);
      let found;
      if (tokensReal) {
        const r = ts.resolveModuleName(spec, fromFile, tsOptions, ts.sys, resolutionCache).resolvedModule;
        if (r && real(r.resolvedFileName) === tokensReal) found = tokens.exports;
      }
      staticCache.set(key, found);
      return found;
    };

    const cssModuleCache = new Map();
    const isCssModule = (spec, fromFile) => {
      if (!cssModuleReal) return false;
      const key = `${spec}\u0000${path.dirname(fromFile)}`;
      if (!cssModuleCache.has(key)) {
        const r = ts.resolveModuleName(spec, fromFile, tsOptions, ts.sys, resolutionCache).resolvedModule;
        cssModuleCache.set(key, Boolean(r && real(r.resolvedFileName) === cssModuleReal));
      }
      return cssModuleCache.get(key);
    };

    const files = findSourceFiles(projectDir, options.src);
    const calls = [];
    for (const file of files) {
      if (tokensReal && real(file) === tokensReal) continue;
      const stat = fs.statSync(file);
      const hit = cache.get(file);
      let result;
      if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size && hit.tokensKey === tokensKey) result = hit.result;
      else {
        const text = fs.readFileSync(file, 'utf8');
        const relevant = text.includes(packageName) || (cssModuleReal && /\bcss\b/.test(text));
        result = relevant ? extractFile(file, text, { ts, packageName, resolveStatic, naming, isCssModule }) : { calls: [], diagnostics: [] };
        cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, tokensKey, result });
      }
      calls.push(...result.calls);
      diagnostics.push(...result.diagnostics);
    }

    const compiled = compileStylesheet({
      tokens: tokens.definition,
      tokensFile: tokensFile ?? undefined,
      calls,
      prefix: options.prefix,
      salt: options.salt,
    });
    diagnostics.push(...compiled.diagnostics);
    const stats = { files: files.length, ...compiled.stats };
    let css = diagnostics.some((d) => d.severity === 'error') ? null : compiled.css;
    if (css && postcss) {
      for (const problem of selfCheck(css, postcss)) diagnostics.push({ severity: 'error', message: `self-check: ${problem}` });
      if (diagnostics.some((d) => d.severity === 'error')) css = null;
    }
    let written = false;
    if (css && outFile) {
      const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null;
      if (current !== css) {
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, css);
        written = true;
      }
    }
    return { css, diagnostics, stats, written, outFile };
  }

  return { run, projectDir, tokensFile, outFile };
}

/**
 * Build once.
 * @param {BuildOptions} options
 * @returns {Promise<BuildResult>}
 */
export async function build(options) {
  return createBuilder(options).run();
}

/**
 * Validate without writing (for CI).
 * @param {Omit<BuildOptions, 'out'>} options
 * @returns {Promise<BuildResult>}
 */
export async function check(options) {
  return createBuilder({ ...options, out: undefined }).run();
}

/**
 * Build, then rebuild whenever a source file or the tokens module changes.
 * @param {BuildOptions} options
 * @param {(result: BuildResult) => void} onResult
 * @returns {Promise<{ close: () => void }>}
 */
export async function watch(options, onResult) {
  const builder = createBuilder(options);
  let timer = null;
  let running = false;
  let again = false;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        onResult(await builder.run());
      } catch (err) {
        onResult({ css: null, diagnostics: [{ severity: 'error', message: err.message }], stats: null, written: false, outFile: builder.outFile });
      }
      running = false;
      if (again) {
        again = false;
        trigger();
      }
    }, 60);
  };
  onResult(await builder.run());
  const watchers = [];
  const dirs = new Set(options.src.map((s) => path.resolve(builder.projectDir, s)));
  if (builder.tokensFile) dirs.add(path.dirname(builder.tokensFile));
  for (const dir of dirs) {
    const target = fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : path.dirname(dir);
    watchers.push(
      fs.watch(target, { recursive: true }, (_event, name) => {
        if (!name) return trigger();
        const full = path.resolve(target, String(name));
        if (builder.outFile && full === builder.outFile) return;
        if (isSourceFile(full) || full === builder.tokensFile) trigger();
      }),
    );
  }
  return {
    close() {
      clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}
