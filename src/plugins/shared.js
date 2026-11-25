// What every bundler plugin does: compile modules, and, when it is given the source directories, also write the
// stylesheet (so one plugin replaces the `purser build` step). Build-only module.

import fs from 'node:fs';
import path from 'node:path';
import { createBuilder } from '../build/index.js';
import { createCompiler } from '../compiler/index.js';
import { contextKey, resolveFuse } from '../fuse.js';
import { resolveNaming } from '../hash.js';
import { createNameRegistry, generationFileFor, PlanError, planFileFor, readPlan } from '../names.js';

/**
 * @typedef {import('../compiler/index.js').CompilerOptions & {
 *   src?: string[],
 *   out?: string,
 *   minify?: boolean,
 *   fuse?: false | 'exact' | 'balanced' | 'max',
 *   namesFile?: string,
 *   layers?: { tokens?: string, globals?: string, overrides?: string, atoms?: string },
 *   compile?: boolean,
 * }} PluginOptions
 *   src + out: also build the stylesheet; compile: false keeps the modules as they are (stylesheet only);
 *   fuse: with names "min", give classes that are applied together one class (a one-shot build only: see `oneShot`)
 */

/** A source map as the comment bundlers read from a loaded file. */
export function inlineMap(map) {
  return `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`;
}

/** Format build diagnostics the way the CLI prints them. */
export function formatDiagnostics(diagnostics, cwd = process.cwd()) {
  return diagnostics
    .map((d) => {
      const loc = d.file ? `${path.relative(cwd, d.file) || d.file}${d.line ? `:${d.line}:${d.column ?? 1}` : ''}: ` : '';
      return `${loc}${d.severity}: ${d.message}`;
    })
    .join('\n');
}

/**
 * @param {PluginOptions} options
 * @param {{ projectDir?: string, minify?: boolean, oneShot?: boolean }} [defaults] what the bundler knows: its root,
 *   whether it builds for production, and whether it builds once (oneShot: false for a dev server or a watching
 *   build, where a changed file is compiled again and the others are not: classes are then never fused, because a
 *   fused class depends on every module)
 */
export function createPluginCore(options = {}, defaults = {}) {
  const projectDir = path.resolve(options.projectDir ?? defaults.projectDir ?? process.cwd());
  const naming = resolveNaming({ prefix: options.prefix, salt: options.salt, names: options.names, granularity: options.granularity });
  const min = naming.names === 'min';
  const fuse = defaults.oneShot === false ? false : resolveFuse(options.fuse);
  if (fuse && !min) throw new Error('purser: fuse needs names "min" (fused classes are named by the build)');
  const namesFile = min && options.namesFile ? path.resolve(projectDir, options.namesFile) : null;
  const builds = Array.isArray(options.src) && options.src.length > 0;
  if (builds && !options.out) throw new Error('purser: the plugin was given src, so it also needs out (the stylesheet to write)');
  if (min && !builds && !namesFile) {
    throw new Error(
      'purser: names "min" are given by the build that writes the stylesheet. Give the plugin src and out so it writes it, or namesFile (the file `purser build --names min --names-file …` keeps).',
    );
  }

  // One registry for the stylesheet and the modules. Without an own build the names come from the file alone.
  let registry = null;
  if (min) registry = builds ? createNameRegistry({ prefix: naming.minPrefix, names: readNames(namesFile) }) : fileRegistry(namesFile, naming.minPrefix, projectDir);

  const shared = { ...options, projectDir, registry: registry ?? undefined };
  const compiles = options.compile !== false;
  // The builder also works out what every module compiles to, so the compiler parses nothing a second time.
  const builder = builds
    ? createBuilder({ ...shared, fuse, modules: compiles, minify: options.minify ?? defaults.minify ?? false, namesFile: namesFile ?? undefined })
    : null;
  const compiler = compiles ? createCompiler({ ...shared, records: builder ? builder.record : undefined }) : null;

  let running = null;
  /**
   * Build the stylesheet (once at a time). Resolves with the result; a result with errors has `css: null`.
   * @returns {Promise<import('../build/index.js').BuildResult | null>} null when the plugin does not build it
   */
  function buildStylesheet() {
    if (!builder) return Promise.resolve(null);
    running ??= builder.run().finally(() => {
      running = null;
    });
    return running;
  }

  return { projectDir, compiler, builder, registry, fuse, buildStylesheet, outFile: builder?.outFile ?? null };
}

function readNames(file) {
  if (!file) return undefined;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return undefined; // no names kept yet
    throw err;
  }
  return JSON.parse(text);
}

/**
 * A registry that only reads the names another process keeps (the CLI, another bundler's plugin). A class the file
 * does not have yet is looked up once more (the other build may just have written it) and is an error after that:
 * making a name up here would not match the stylesheet.
 */
function fileRegistry(file, prefix, projectDir) {
  const planFile = planFileFor(file, projectDir);
  let names = new Map();
  /** @type {null | { level: string, covers: Map<string, string[]> }} */
  let plan = null;
  let stamp = '';
  const stampOf = (f) => {
    try {
      const st = fs.statSync(f);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return 'missing';
    }
  };
  /** Read both files again when either changed. @returns {boolean} whether anything was read */
  const load = () => {
    const next = `${stampOf(file)}|${stampOf(planFile)}`;
    if (next === stamp) return false;
    stamp = next;
    names = next.startsWith('missing|') ? new Map() : new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
    plan = readPlan(file, projectDir);
    return true;
  };
  const get = (id) => {
    if (!names.has(id)) load();
    const name = names.get(id);
    if (name === undefined) {
      const err = new Error(`purser: ${file} has no name for class ${id}. Build the stylesheet first (purser build --names min --names-file …): it gives the names.`);
      // a loader beside a watching build waits for the name (see waitForNames)
      Object.assign(err, { code: 'PURSER_NAME_MISSING' });
      throw err;
    }
    return name;
  };
  return {
    prefix,
    get,
    /**
     * What a compiled module's names depend on, for a bundler that keeps compiled modules: the generation of the names
     * (it changes when names are given anew, not when one is added) and the plan.
     */
    files: [generationFileFor(file, projectDir), planFile],
    /** Read the files again if a build has replaced them (asked once per module). */
    refresh: load,
    resolve(ids) {
      if (stamp === '') load();
      if (ids.length === 0) return [];
      if (!plan) {
        // One name per class, unless a build has fused since the files were read.
        if (ids.every((id) => names.has(id)) || !load() || !plan) return ids.map(get);
      }
      const key = contextKey(ids);
      let cover = plan.covers.get(key);
      if (!cover && load()) cover = plan?.covers.get(key);
      if (!cover) throw new PlanError();
      return cover;
    },
    get plan() {
      return plan;
    },
    setPlan() {},
    has: (id) => names.has(id) || (load() && names.has(id)),
    assign() {},
    get version() {
      return stamp;
    },
    get size() {
      return names.size;
    },
    toJSON: () => Object.fromEntries(names),
  };
}
