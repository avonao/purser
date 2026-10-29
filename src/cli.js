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
  --salt <text>      hash salt (default ""); must match createCss({ salt })
  --package <name>   runtime import specifier (default "@avonao/purser")
  --css-module <f>   module exporting a custom css = createCss({ prefix, salt })
  --layers <t,g,a>   names of the tokens, globals and atoms cascade layers
                     (default purser.tokens,purser.globals,purser.atoms)
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
    if (names.length !== 3) {
      err('purser: --layers takes three comma-separated names: tokens,globals,atoms\n');
      return 2;
    }
    try {
      layers = resolveLayers({ tokens: names[0], globals: names[1], atoms: names[2] });
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
    const summary = `${s.files} files, ${s.atoms} classes, ${s.rules} rules, ${s.tokens} tokens, ${s.keyframes} keyframes`;
    if (command === 'check') out(`purser: ok (${summary})\n`);
    else out(`purser: ${result.written ? 'wrote' : 'unchanged'} ${path.relative(cwd, result.outFile)} (${summary})\n`);
    return 0;
  };

  try {
    if (command === 'build' && v.watch) {
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
