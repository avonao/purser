// Command-line interface: `purser build` and `purser check`.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { build, check, watch } from './build/index.js';
import { resolveLayers } from './compile/stylesheet.js';

const HELP = `Usage:
  purser build --project <dir> --src <dirs> --tokens <file> --out <file> [--watch]
  purser check --project <dir> --src <dirs> --tokens <file>

Options:
  --project <dir>    project root; typescript/postcss resolve from here (default: .)
  --src <list>       comma-separated source directories or files (required)
  --tokens <file>    module exporting the defineTokens() result
  --out <file>       generated stylesheet (build only)
  --watch            rebuild on change (build only)
  --prefix <name>    class name prefix (default "x"); must match createCss({ prefix })
  --salt <text>      hash salt (default: $PURSER_SALT, else ""); must match createCss({ salt })
  --names <mode>     legacy (default: x + 7 characters), short (4 characters) or min (the shortest there are, most used
                     first; given by the build, so the modules must be compiled); must match createCss({ names })
  --names-file <f>   with --names min: JSON file that keeps the names between builds
  --granularity <g>  property (default: one class per property of a style) or rule (one class per rule, so styles share
                     the rules they have in common and the stylesheet is smaller); must match createCss({ granularity })
  --minify           write the stylesheet without whitespace and merge rules that write the same declaration
  --fuse <level>     with --names min: give classes that are applied together one class, so elements carry fewer.
                     exact: classes that never appear without each other (nothing is written twice); balanced: also
                     classes that often appear together; max: one class for every group a css.props call applies.
                     Not with --watch (a fused class depends on every module)
  --no-cache         parse every file again instead of using node_modules/.cache/purser (also PURSER_CACHE=0)
  --find-salt        build only: try salts until the class names have no collision, print the one to use (PURSER_SALT), write nothing
  --package <name>   runtime import specifier (default "@avonao/purser")
  --css-module <f>   module exporting a custom css = createCss({ prefix, salt })
  --layers <t,g,a>   names of the tokens, globals and atoms cascade layers
                     (default purser.tokens,purser.globals,purser.atoms);
                     four names t,g,o,a also name the overrides layer
  -h, --help         show this help
  -v, --version      show the version

Exit codes: 0 ok, 1 rule violations or errors, 2 usage error.
`;

/**
 * Run the CLI.
 * @param {string[]} argv arguments after the binary name
 * @param {{ stdout?: (s: string) => void, stderr?: (s: string) => void, cwd?: string }} [io]
 * @returns {Promise<number>} exit code (never resolves in --watch mode)
 */
export async function main(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(s));
  const err = io.stderr ?? ((s) => process.stderr.write(s));
  const cwd = io.cwd ?? process.cwd();
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        project: { type: 'string', default: '.' },
        src: { type: 'string' },
        tokens: { type: 'string' },
        out: { type: 'string' },
        watch: { type: 'boolean', default: false },
        prefix: { type: 'string' },
        salt: { type: 'string' },
        names: { type: 'string' },
        granularity: { type: 'string' },
        'names-file': { type: 'string' },
        minify: { type: 'boolean', default: false },
        fuse: { type: 'string' },
        'no-cache': { type: 'boolean', default: false },
        'find-salt': { type: 'boolean', default: false },
        package: { type: 'string' },
        'css-module': { type: 'string' },
        layers: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (e) {
    err(`purser: ${e.message}\n\n${HELP}`);
    return 2;
  }
  const { values: v, positionals } = parsed;
  if (v.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    out(`${pkg.version}\n`);
    return 0;
  }
  const command = positionals[0];
  if (v.help || !command) {
    out(HELP);
    return v.help ? 0 : 2;
  }
  if (command !== 'build' && command !== 'check') {
    err(`purser: unknown command "${command}"\n\n${HELP}`);
    return 2;
  }
  if (!v.src) {
    err('purser: --src is required\n');
    return 2;
  }
  if (command === 'build' && !v.out) {
    err('purser: build needs --out <file> (use "purser check" to only validate)\n');
    return 2;
  }
  let layers;
  if (v.layers !== undefined) {
    const names = v.layers.split(',').map((s) => s.trim());
    if (names.length !== 3 && names.length !== 4) {
      err('purser: --layers takes three or four comma-separated names: tokens,globals[,overrides],atoms\n');
      return 2;
    }
    try {
      const [tokens, globals, ...rest] = names;
      layers = resolveLayers({ tokens, globals, ...(rest.length === 2 ? { overrides: rest[0] } : {}), atoms: rest.at(-1) });
    } catch (e) {
      err(`purser: --layers: ${e.message}\n`);
      return 2;
    }
  }
  const options = {
    projectDir: path.resolve(cwd, v.project),
    src: v.src.split(',').map((s) => s.trim()).filter(Boolean),
    tokens: v.tokens,
    out: command === 'build' ? v.out : undefined,
    prefix: v.prefix,
    salt: v.salt,
    names: v.names,
    granularity: v.granularity,
    namesFile: v['names-file'],
    minify: v.minify,
    fuse: v.fuse,
    cache: v['no-cache'] ? false : undefined,
    packageName: v.package,
    cssModule: v['css-module'],
    layers,
  };

  const print = (result) => {
    for (const d of result.diagnostics) {
      const loc = d.file ? `${path.relative(cwd, d.file) || d.file}${d.line ? `:${d.line}:${d.column ?? 1}` : ''}: ` : '';
      err(`${loc}${d.severity}: ${d.message}\n`);
    }
    const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
    if (errors) {
      err(`purser: ${errors} error${errors === 1 ? '' : 's'}${command === 'build' ? '; stylesheet not written' : ''}\n`);
      return 1;
    }
    const s = result.stats;
    let summary = `${s.files} files, ${s.atoms} classes, ${s.rules} rules, ${s.tokens} tokens, ${s.keyframes} keyframes`;
    if (s.fused) summary += `; fused ${s.fused.level}: ${s.fused.ids} classes as ${s.fused.classes}`;
    if (command === 'check') out(`purser: ok (${summary})\n`);
    else out(`purser: ${result.written ? 'wrote' : 'unchanged'} ${path.relative(cwd, result.outFile)} (${summary})\n`);
    return 0;
  };

  try {
    if (v['find-salt']) {
      // Short names: find a salt under which no two atoms share a class name. Deterministic: "" first, then s1, s2, ...
      for (let i = 0; i < 400; i++) {
        const salt = i === 0 ? (options.salt ?? process.env.PURSER_SALT ?? '') : `s${i}`;
        const result = await check({ ...options, salt, out: undefined });
        const errors = result.diagnostics.filter((d) => d.severity === 'error');
        if (errors.some((d) => !/collision/.test(d.message))) return print(result);
        if (!errors.length) {
          out(`purser: salt ${JSON.stringify(salt)} has no class name collision (${result.stats.atoms} classes)\nPURSER_SALT=${salt}\n`);
          return 0;
        }
      }
      err('purser: no collision-free salt in 400 tries\n');
      return 1;
    }
    if (command === 'build' && v.watch) {
      if (options.fuse) err('purser: --fuse is not used with --watch: every class keeps its own name while watching\n');
      await watch(options, print);
      out('purser: watching for changes (Ctrl+C to stop)\n');
      return new Promise(() => {});
    }
    return print(command === 'build' ? await build(options) : await check(options));
  } catch (e) {
    err(`${e.message}\n`);
    return 1;
  }
}
