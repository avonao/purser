// What every bundler plugin does: compile modules, and, when it is given the source directories, also write the
// stylesheet (so one plugin replaces the `purser build` step). Build-only module.

import fs from 'node:fs';
import path from 'node:path';
import { createBuilder } from '../build/index.js';
import { createCompiler } from '../compiler/index.js';
import { resolveNaming } from '../hash.js';
import { createNameRegistry } from '../names.js';

/**
 * @typedef {import('../compiler/index.js').CompilerOptions & {
 *   src?: string[],
 *   out?: string,
 *   minify?: boolean,
 *   namesFile?: string,
 *   layers?: { tokens?: string, globals?: string, overrides?: string, atoms?: string },
 *   compile?: boolean,
 * }} PluginOptions
 *   src + out: also build the stylesheet; compile: false keeps the modules as they are (stylesheet only)
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
 * @param {{ projectDir?: string, minify?: boolean }} [defaults] what the bundler knows (its root, whether it builds for production)
 */
export function createPluginCore(options = {}, defaults = {}) {
  const projectDir = path.resolve(options.projectDir ?? defaults.projectDir ?? process.cwd());
  const naming = resolveNaming({ prefix: options.prefix, salt: options.salt, names: options.names, granularity: options.granularity });
  const min = naming.names === 'min';
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
  if (min) registry = builds ? createNameRegistry({ prefix: naming.minPrefix, names: readNames(namesFile) }) : fileRegistry(namesFile, naming.minPrefix);

  const shared = { ...options, projectDir, registry: registry ?? undefined };
  const compiler = options.compile === false ? null : createCompiler(shared);
  const builder = builds ? createBuilder({ ...shared, minify: options.minify ?? defaults.minify ?? false, namesFile: namesFile ?? undefined }) : null;

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

  return { projectDir, compiler, builder, registry, buildStylesheet, outFile: builder?.outFile ?? null };
}

function readNames(file) {
  if (!file || !fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * A registry that only reads the names another process keeps (the CLI, another bundler's plugin). A class the file
 * does not have yet is looked up once more (the other build may just have written it) and is an error after that:
 * making a name up here would not match the stylesheet.
 */
function fileRegistry(file, prefix) {
  let names = new Map();
  let stamp = '';
  const load = () => {
    let next = '';
    try {
      const st = fs.statSync(file);
      next = `${st.mtimeMs}:${st.size}`;
    } catch {
      next = 'missing';
    }
    if (next === stamp) return false;
    stamp = next;
    names = next === 'missing' ? new Map() : new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))));
    return true;
  };
  return {
    prefix,
    get(id) {
      if (!names.has(id)) load();
      const name = names.get(id);
      if (name === undefined) {
        throw new Error(`purser: ${file} has no name for class ${id}. Build the stylesheet first (purser build --names min --names-file …): it gives the names.`);
      }
      return name;
    },
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
