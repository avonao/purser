// Build API: extract styles from a project and write one stylesheet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { compileStylesheet, resolveLayers } from '../compile/stylesheet.js';
import { analyzeModule, moduleContexts } from '../compiler/transform.js';
import { resolveFuse } from '../fuse.js';
import { resolveNaming } from '../hash.js';
import { createNameRegistry, planFileFor, writeAtomic, writePlan } from '../names.js';
import { memoizedClassNames, normalizeNamedStyle } from './memo.js';
import { makeCreateCss } from '../runtime.js';
import { cacheDirectory, hashText, openCache } from './cache.js';
import { extractFile } from './extract.js';
import { findSourceFiles, isSourceFile } from './files.js';
import { compilerOptions, loadPostcss, loadTypeScript, real } from './host.js';
import { finishTokens, readTokensModule } from './load-tokens.js';
import { selfCheck } from './selfcheck.js';

/**
 * @typedef {object} BuildOptions
 * @property {string} projectDir          host project root (where typescript/postcss resolve from)
 * @property {string[]} src               source directories or files, relative to projectDir
 * @property {string} [tokens]            tokens module path, relative to projectDir
 * @property {string} [out]               output CSS file, relative to projectDir (omit to only validate)
 * @property {string} [prefix]            class name prefix (default "x"); must match createCss({ prefix })
 * @property {string} [salt]              hash salt (default: PURSER_SALT, else ""); must match createCss({ salt })
 * @property {"short"|"legacy"|"min"} [names]  class names: "legacy" (default, prefix + 7 characters), "short" (4 characters) or "min"
 *                                        (the shortest there are, given by the build: needs the compiler); must match createCss({ names })
 * @property {string} [namesFile]         with names "min": a JSON file that keeps the names between builds, relative to projectDir
 * @property {ReturnType<typeof createNameRegistry>} [registry]  with names "min": a registry shared with a compiler
 * @property {"property"|"rule"} [granularity]  one class per property (default) or one per rule; must match createCss({ granularity })
 * @property {boolean} [minify]           write the stylesheet without whitespace and merge rules that write the same declaration
 * @property {false | "exact" | "balanced" | "max"} [fuse]  with names "min": give classes that are applied together one class
 *                                        (see ../fuse.js). The modules must be compiled against this build's names.
 * @property {boolean} [modules]          also work out what every module compiles to, for a compiler that shares this builder
 * @property {boolean | string} [cache]   false: no cache on disk; a string: its directory (default node_modules/.cache/purser)
 * @property {number} [threads]           worker threads for parsing (default: the processors minus one, at most 8; 0: none)
 * @property {string} [packageName]       runtime import specifier (default "@avonao/purser")
 * @property {string} [cssModule]         module exporting a custom `css = createCss({ … })`, relative to projectDir
 * @property {{ tokens?: string, globals?: string, atoms?: string }} [layers]  cascade layer names (default purser.tokens, purser.globals, purser.atoms)
 */

/**
 * @typedef {object} BuildResult
 * @property {string | null} css
 * @property {import('../compile/stylesheet.js').Diagnostic[]} diagnostics
 * @property {{ files: number, atoms: number, rules: number, keyframes: number, tokens: number, fused?: { level: string, contexts: number, ids: number, classes: number, references: number, selectors: number } }} stats
 * @property {boolean} written   true when the output file changed on disk
 * @property {string | null} outFile
 * @property {Record<string, string> | null} names  with names "min": legacy name -> minimal name of every class
 */

/** Fewest files that still need parsing for worker threads to pay for their start-up. */
const POOL_MIN_FILES = 64;

/** Format of the record a one-shot build leaves behind (see `unchanged`). */
const MANIFEST = 1;
/** A file written this close to the end of a build is compared by content: clocks and file systems are coarse. */
const RACY_MS = 2000;

/**
 * Create a reusable builder (keeps a per-file extraction cache for watch mode).
 * @param {BuildOptions} options
 * @param {{ oneShot?: boolean }} [internal]  oneShot: nothing but this one run reads the builder, so a run whose
 *   inputs and outputs are exactly those of the last build may answer without doing it again
 */
export function createBuilder(options, internal = {}) {
  const projectDir = path.resolve(options.projectDir);
  const packageName = options.packageName ?? '@avonao/purser';
  const tokensFile = options.tokens ? path.resolve(projectDir, options.tokens) : null;
  const outFile = options.out ? path.resolve(projectDir, options.out) : null;
  const cssModuleReal = options.cssModule ? real(path.resolve(projectDir, options.cssModule)) : null;
  const naming = resolveNaming({ prefix: options.prefix, salt: options.salt, names: options.names, granularity: options.granularity });
  const namesFile = naming.names === 'min' && options.namesFile ? path.resolve(projectDir, options.namesFile) : null;
  let registry = null;
  if (naming.names === 'min') {
    registry = options.registry ?? createNameRegistry({ prefix: naming.minPrefix, names: readNames(namesFile) });
  }
  const fuse = resolveFuse(options.fuse);
  if (fuse && naming.names !== 'min') throw new TypeError('purser: fuse needs names "min" (fused classes are named by the build)');
  // What a module compiles to is worked out with the build when something needs it: fusion (it plans from the classes
  // every module applies) or a compiler that shares this builder (it then parses nothing a second time).
  const wantModules = Boolean(fuse) || options.modules === true;
  // Class ids: the names before the registry renames them.
  const identity = { prefix: naming.prefix, salt: naming.salt, names: naming.names === 'min' ? 'legacy' : naming.names, granularity: naming.granularity };
  const classIds = makeCreateCss(memoizedClassNames(), normalizeNamedStyle)(identity);
  const layers = resolveLayers(options.layers);
  const cacheEnabled = options.cache !== false && process.env.PURSER_CACHE !== '0';
  // Worker threads each load the parser, so they pay off from four processors on (two only take turns).
  const cores = os.availableParallelism();
  const threads = Math.max(0, Math.min(options.threads ?? (cores >= 4 ? cores - 1 : 0), 8));
  const memory = new Map(); // file -> { mtimeMs, size, tokensKey, result }

  // The parser is loaded when the first file needs parsing: a build whose files are all cached never loads it.
  let host = null;
  const getHost = () => {
    if (!host) {
      const ts = loadTypeScript(projectDir);
      const tsOptions = compilerOptions(ts, projectDir);
      host = { ts, tsOptions, resolutionCache: ts.createModuleResolutionCache(projectDir, (x) => x, tsOptions) };
    }
    return host;
  };
  let postcss;
  const getPostcss = () => (postcss === undefined ? (postcss = loadPostcss(projectDir)) : postcss);

  // A one-shot build records what it read and what it wrote. The next one checks that record first: when no source
  // file, the tokens, tsconfig.json or an option changed and the stylesheet (with the names) is still what was
  // written, there is nothing to do, and nothing is parsed, compiled or even loaded to find that out.
  const manifestFile =
    internal.oneShot === true && cacheEnabled && outFile && !options.registry
      ? path.join(
          cacheDirectory(projectDir, options.cache),
          `build-${hashText(JSON.stringify([VERSION, projectDir, options.src, tokensFile, outFile, packageName, identity, naming.names, naming.minPrefix ?? null, cssModuleReal, layers, options.minify === true, fuse, namesFile])).slice(0, 12)}.json`,
        )
      : null;
  const tsconfigFile = path.join(projectDir, 'tsconfig.json');

  /** @returns {BuildResult | null} the last build's result when everything it depends on is as it left it */
  function unchanged() {
    let m;
    try {
      m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch {
      return null;
    }
    if (!m || m.v !== MANIFEST) return null;
    const same = (file, stamp) => {
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        return stamp === null;
      }
      if (stamp === null || st.size !== stamp[1]) return false;
      if (st.mtimeMs === stamp[0] && stamp[0] < m.builtAt - RACY_MS) return true;
      // touched, or written too close to that build to trust the clock: the content decides
      try {
        return hashText(fs.readFileSync(file, 'utf8')) === stamp[2];
      } catch {
        return false;
      }
    };
    if (!same(tsconfigFile, m.tsconfig) || (tokensFile && !same(tokensFile, m.tokens))) return null;
    let files;
    try {
      files = findSourceFiles(projectDir, options.src);
    } catch {
      return null;
    }
    if (files.length !== m.files.length) return null;
    for (let i = 0; i < files.length; i++) {
      const [rel, ...stamp] = m.files[i];
      if (path.relative(projectDir, files[i]) !== rel || !same(files[i], stamp)) return null;
    }
    const textIf = (file, hash) => {
      try {
        const text = fs.readFileSync(file, 'utf8');
        return hashText(text) === hash ? text : null;
      } catch {
        return null;
      }
    };
    const css = textIf(outFile, m.out);
    if (css === null) return null;
    // The names: from the names file when the build keeps one (it must still be what was written), else from the record.
    let names = m.given ?? null;
    if (namesFile) {
      const text = textIf(namesFile, m.names);
      if (text === null) return null;
      const planFile = planFileFor(namesFile, projectDir);
      if (m.plan === null ? fs.existsSync(planFile) : textIf(planFile, m.plan) === null) return null;
      names = JSON.parse(text);
    }
    return { css, diagnostics: m.warnings, stats: m.stats, written: false, outFile, names };
  }

  /** @returns {Promise<BuildResult>} */
  async function run() {
    if (manifestFile) {
      const result = unchanged();
      if (result) return result;
    }
    const diagnostics = [];
    const empty = () => ({ css: null, diagnostics, stats: { files: 0, atoms: 0, rules: 0, keyframes: 0, tokens: 0 }, written: false, outFile, names: null });

    // Tokens: by content from the disk cache, else read from the source, else run.
    let tokens = { definition: null, exports: {} };
    let tokensText = null;
    let tokensRaw = null;
    if (tokensFile) {
      try {
        tokensText = fs.readFileSync(tokensFile, 'utf8');
      } catch {
        // loadTokensModule reports a missing file
      }
    }
    const tokensHash = tokensText === null ? '' : hashText(tokensText);
    // Everything but file contents that an extraction result depends on.
    const disk = cacheEnabled
      ? openCache({
          dir: cacheDirectory(projectDir, options.cache),
          key: hashText(JSON.stringify([VERSION, packageName, identity, tokensHash, cssModuleReal, readIfExists(path.join(projectDir, 'tsconfig.json'))])),
        })
      : null;
    if (tokensFile) {
      try {
        tokensRaw = disk?.getTokens(tokensHash) ?? null;
        if (!tokensRaw) {
          tokensRaw = await readTokensModule(tokensFile, { ts: getHost().ts, packageName, text: tokensText ?? undefined });
          if (tokensRaw.ok && tokensRaw.static) disk?.setTokens(tokensHash, tokensRaw);
        }
        tokens = finishTokens(tokensRaw, tokensFile);
      } catch (err) {
        diagnostics.push({ severity: 'error', message: err.message, file: tokensFile });
        return empty();
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
        const { ts, tsOptions, resolutionCache } = getHost();
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
        const { ts, tsOptions, resolutionCache } = getHost();
        const r = ts.resolveModuleName(spec, fromFile, tsOptions, ts.sys, resolutionCache).resolvedModule;
        cssModuleCache.set(key, Boolean(r && real(r.resolvedFileName) === cssModuleReal));
      }
      return cssModuleCache.get(key);
    };
    const isPure = (spec, fromFile) => resolveStatic(spec, fromFile) !== undefined;
    const extract = (file, text) => {
      const ctx = { ts: getHost().ts, packageName, resolveStatic, naming, isCssModule };
      if (!wantModules) {
        const { calls, diagnostics } = extractFile(file, text, ctx);
        return { calls, diagnostics };
      }
      const found = extractFile(file, text, { ...ctx, nodes: true });
      // The module that creates the custom `css` keeps the runtime: it is what the others are compiled against.
      const own = cssModuleReal !== null && real(file) === cssModuleReal;
      const module = own ? null : analyzeModule(found, text, file, { ...ctx, isPure, naming: identity, css: classIds });
      return { calls: found.calls, diagnostics: found.diagnostics, module };
    };

    // A call from the disk cache or from a worker has no syntax tree behind it. Its values are all a clean build
    // needs; a diagnostic that must point into the file parses that one file again.
    const reparsed = new Map();
    const revive = (file, stored) =>
      stored.map((call) => ({
        ...call,
        locate(at) {
          if (!reparsed.has(file)) reparsed.set(file, extract(file, fs.readFileSync(file, 'utf8')).calls);
          const fresh = reparsed.get(file).find((c) => c.kind === call.kind && c.line === call.line && c.column === call.column);
          return fresh ? fresh.locate(at) : { line: call.line, column: call.column };
        },
      }));
    const strip = (calls) => calls.map(({ locate: _locate, node: _node, ...call }) => call);

    const files = findSourceFiles(projectDir, options.src);
    const results = new Map(); // file -> { calls, diagnostics, module? }
    const pending = []; // { file, rel, text, hash, stat }
    /** For the manifest: [rel, mtimeMs, size, content hash] of every source file (null once one was not read). */
    let stamps = manifestFile ? [] : null;
    for (const file of files) {
      const stat = fs.statSync(file);
      if (tokensReal && real(file) === tokensReal) {
        stamps?.push([path.relative(projectDir, file), stat.mtimeMs, stat.size, tokensHash]);
        continue;
      }
      const hit = memory.get(file);
      if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size && hit.tokensKey === tokensKey) {
        results.set(file, hit.result);
        // keep its entry in the disk cache alive
        if (disk && hit.hash) disk.get(hit.rel, hit.hash);
        stamps = null;
        continue;
      }
      const text = fs.readFileSync(file, 'utf8');
      const relevant = text.includes(packageName) || (cssModuleReal && /\bcss\b/.test(text));
      const rel = path.relative(projectDir, file);
      const remember = (result, hash) => {
        memory.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, tokensKey, result, rel, hash });
        results.set(file, result);
      };
      if (!relevant) {
        stamps?.push([rel, stat.mtimeMs, stat.size, hashText(text)]);
        remember({ calls: [], diagnostics: [] }, null);
        continue;
      }
      const hash = hashText(text);
      stamps?.push([rel, stat.mtimeMs, stat.size, hash]);
      const stored = disk?.get(rel, hash, wantModules);
      if (stored) remember(wantModules ? { calls: revive(file, stored.c), diagnostics: [], module: stored.m } : { calls: revive(file, stored.c), diagnostics: [] }, hash);
      else pending.push({ file, rel, text, hash, remember });
    }

    // Parse what is left: on worker threads when there is enough of it, else here.
    if (pending.length >= POOL_MIN_FILES && threads > 0 && options.threads !== 0) {
      const share = Math.min(threads + 1, Math.ceil(pending.length / 32));
      const buckets = Array.from({ length: share }, () => []);
      // largest files first, each to the lightest bucket, so the shares take about the same time
      const load = new Array(share).fill(0);
      for (const item of [...pending].sort((a, b) => b.text.length - a.text.length)) {
        const i = load.indexOf(Math.min(...load));
        buckets[i].push(item);
        load[i] += item.text.length;
      }
      const byFile = new Map(pending.map((item) => [item.file, item]));
      const remote = buckets.slice(1).filter((b) => b.length > 0).map(
        (bucket) =>
          new Promise((resolve, reject) => {
            const worker = new Worker(new URL('./extract-worker.js', import.meta.url), {
              workerData: { projectDir, packageName, naming, identity: wantModules ? identity : null, tokensReal, tokensExports: tokens.exports, cssModuleReal, files: bucket.map((b) => b.file) },
            });
            worker.once('message', (m) => {
              worker.terminate();
              if (m.ok) resolve(m.results);
              else reject(new Error(`purser: a worker thread failed\n${m.message}`));
            });
            worker.once('error', reject);
          }),
      );
      for (const item of buckets[0]) {
        const result = extract(item.file, item.text);
        if (disk && result.diagnostics.length === 0) disk.set(item.rel, item.hash, strip(result.calls), result.module);
        item.remember(result, item.hash);
      }
      for (const list of await Promise.all(remote)) {
        for (const r of list) {
          const item = byFile.get(r.file);
          if (disk && r.diagnostics.length === 0) disk.set(item.rel, r.hash, r.calls, r.module);
          const result = { calls: revive(r.file, r.calls), diagnostics: r.diagnostics };
          if (wantModules) result.module = r.module;
          item.remember(result, r.hash);
        }
      }
    } else {
      for (const item of pending) {
        const result = extract(item.file, item.text);
        if (disk && result.diagnostics.length === 0) disk.set(item.rel, item.hash, strip(result.calls), result.module);
        item.remember(result, item.hash);
      }
    }
    disk?.save();

    const calls = [];
    /** Every group of classes that is applied whole, for the fusion plan. */
    const contexts = fuse ? [] : undefined;
    for (const file of files) {
      const result = results.get(file);
      if (!result) continue;
      calls.push(...result.calls);
      diagnostics.push(...result.diagnostics);
      if (!contexts) continue;
      if (result.module) for (const ids of moduleContexts(result.module)) contexts.push({ ids });
      else {
        // A module that is not compiled merges its styles at run time, property by property.
        for (const call of result.calls) {
          if (call.kind !== 'create') continue;
          let maps;
          try {
            maps = classIds.create(call.value);
          } catch {
            continue; // the stylesheet compiler reports it
          }
          for (const name of Object.keys(maps)) for (const ids of Object.values(maps[name])) if (ids) contexts.push({ ids: ids.split(' ') });
        }
      }
    }

    const compiled = compileStylesheet({
      tokens: tokens.definition,
      tokensFile: tokensFile ?? undefined,
      calls,
      prefix: options.prefix,
      salt: options.salt,
      names: options.names,
      granularity: options.granularity,
      minify: options.minify,
      fuse,
      contexts,
      registry: registry ?? undefined,
      layers,
    });
    diagnostics.push(...compiled.diagnostics);
    const stats = { files: files.length, ...compiled.stats };
    let css = diagnostics.some((d) => d.severity === 'error') ? null : compiled.css;
    const current = css && outFile && fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null;
    // The self-check re-parses the output; a stylesheet identical to the one on disk passed it when it was written.
    if (css && css !== current && getPostcss()) {
      for (const problem of selfCheck(css, getPostcss())) diagnostics.push({ severity: 'error', message: `self-check: ${problem}` });
      if (diagnostics.some((d) => d.severity === 'error')) css = null;
    }
    let written = false;
    if (css && outFile && current !== css) {
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, css);
      written = true;
    }
    if (css && namesFile && registry) {
      const text = `${JSON.stringify(registry.toJSON(), null, 1)}\n`;
      const saved = fs.existsSync(namesFile) ? fs.readFileSync(namesFile, 'utf8') : null;
      // A compiler in another process reads these while it runs: each is replaced in one step.
      if (saved !== text) writeAtomic(namesFile, text);
      writePlan(namesFile, projectDir, registry.plan);
    }
    if (manifestFile) {
      if (css && stamps) writeManifest(css, diagnostics, stats, stamps);
      else fs.rmSync(manifestFile, { force: true }); // a failed build leaves nothing to answer from
    }
    return { css, diagnostics, stats, written, outFile, names: registry ? registry.toJSON() : null };
  }

  function writeManifest(css, diagnostics, stats, files) {
    const stamp = (file) => {
      try {
        const st = fs.statSync(file);
        return [st.mtimeMs, st.size, hashText(fs.readFileSync(file, 'utf8'))];
      } catch {
        return null;
      }
    };
    const hashOf = (file) => {
      try {
        return hashText(fs.readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    };
    const manifest = {
      v: MANIFEST,
      builtAt: Date.now(),
      tsconfig: stamp(tsconfigFile),
      tokens: tokensFile ? stamp(tokensFile) : null,
      files,
      out: hashText(css),
      names: namesFile ? hashOf(namesFile) : null,
      plan: namesFile ? hashOf(planFileFor(namesFile, projectDir)) : null,
      given: registry && !namesFile ? registry.toJSON() : undefined,
      stats,
      warnings: diagnostics.filter((d) => d.severity !== 'error'),
    };
    try {
      fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
      const tmp = `${manifestFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(manifest));
      fs.renameSync(tmp, manifestFile);
    } catch {
      // a read-only or full disk: the next build simply does the work
    }
  }

  /**
   * What a module compiles to, when the last build worked it out for exactly this content.
   * @param {string} file absolute path
   * @param {string} hash hashText of the module's source
   * @returns {import('../compiler/transform.js').ModuleRecord | null | undefined} null: nothing to compile; undefined: not known
   */
  function record(file, hash) {
    const hit = memory.get(file);
    return hit && hit.hash === hash && hit.result.module !== undefined ? hit.result.module : undefined;
  }

  return { run, record, projectDir, tokensFile, outFile, registry, naming, fuse };
}

const VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readNames(file) {
  if (!file || !fs.existsSync(file)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data) && Object.values(data).every((v) => typeof v === 'string')) return data;
  } catch {
    // fall through
  }
  throw new Error(`purser: ${file} is not a names file (a JSON object of class names); delete it to start over`);
}

/**
 * Build once.
 * @param {BuildOptions} options
 * @returns {Promise<BuildResult>}
 */
export async function build(options) {
  return createBuilder(options, { oneShot: true }).run();
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
  // Fused classes depend on every module, so one changed file would change the classes of modules that did not change
  // and are not compiled again: a watching build keeps one name per class.
  const builder = createBuilder({ ...options, fuse: false });
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
        onResult({ css: null, diagnostics: [{ severity: 'error', message: err.message }], stats: null, written: false, outFile: builder.outFile, names: null });
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
