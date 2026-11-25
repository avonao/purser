// Benchmark runner: one generated design system, built with each tool.
//
//   node run.mjs [--components 500] [--model interface|uniform] [--elements 2000] [--runs 5] [--only purser,tailwind]
//                [--no-browser] [--json out.json] [--merge]
//
// It measures, per tool: the stylesheet build (a new process each time, median of --runs: with nothing to start from,
// again with nothing changed, and after one source file changed), the stylesheet (raw, minified with the same minifier
// for every tool, gzip, brotli), the JavaScript a browser needs for the components' styling (minified, gzip, brotli),
// the cost of loading that JavaScript and of resolving class names, the class attributes of a page, and the number of
// declarations a real browser strikes through (overridden) on that page.
//
// --merge keeps the rows of tools that are not run this time from the --json file (to measure one tool again).

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import { build as esbuild } from 'esbuild';
import { transform as lightning } from 'lightningcss';
import { generatePage, generateSpec } from './spec.mjs';
import { noReact, TOOLS } from './tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    components: { type: 'string', default: '500' },
    elements: { type: 'string', default: '2000' },
    runs: { type: 'string', default: '5' },
    model: { type: 'string', default: 'interface' },
    only: { type: 'string' },
    'no-browser': { type: 'boolean', default: false },
    json: { type: 'string' },
    merge: { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
  },
});
const components = Number(args.components);
const runs = Number(args.runs);
const only = args.only ? new Set(args.only.split(',')) : null;

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const gzip = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const brotli = (buf) => zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const sizes = (text) => {
  const buf = Buffer.from(text);
  return { bytes: buf.length, gzip: gzip(buf), brotli: brotli(buf) };
};

function run(step, dir) {
  const started = process.hrtime.bigint();
  const r = spawnSync(step.cmd, step.args, { cwd: dir, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', FORCE_COLOR: '0' } });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (r.status !== 0) throw new Error(`${path.basename(step.cmd)} ${step.args.join(' ')} failed in ${dir}\n${r.stdout}\n${r.stderr}`);
  return ms;
}

/** Browsers Purser targets (cascade layers and lab()): the minifier must not write fallbacks for older ones. */
const TARGETS = { chrome: 111 << 16, firefox: 113 << 16, safari: (15 << 16) | (4 << 8) };
const minify = (css) => lightning({ filename: 'out.css', code: Buffer.from(css), minify: true, targets: TARGETS }).code.toString();

function chromePath() {
  const req = createRequire(import.meta.url);
  for (const from of [here, '/']) {
    try {
      return createRequire(path.join(from, 'x.js'))('playwright').chromium.executablePath();
    } catch {
      // try the next location
    }
  }
  void req;
  for (const p of [process.env.PURSER_CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

async function struck(html, chrome) {
  const { launch } = await import('./scripts/chrome.mjs');
  return launch(chrome, html, fs.readFileSync(path.join(here, '..', 'scripts', 'strike-count.js'), 'utf8'));
}

const spec = generateSpec({ components, model: args.model });
const page = generatePage(spec, Number(args.elements));
const work = path.join(here, '.work', `${args.model}-${components}`);
fs.mkdirSync(work, { recursive: true });
const pageFile = path.join(work, 'page.json');
fs.writeFileSync(pageFile, JSON.stringify(page));
const chrome = args['no-browser'] ? null : chromePath();

const results = [];
for (const tool of TOOLS) {
  if (only ? !only.has(tool.id) : tool.extra) continue;
  const dir = path.join(work, tool.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  tool.emit(spec, dir);
  process.stderr.write(`${tool.label}: `);
  const result = { id: tool.id, label: tool.label, note: tool.note };
  try {
    if (tool.prepare) run(tool.prepare(dir), dir);
    const step = tool.build(dir);
    const cold = [];
    const warm = [];
    for (let i = 0; i < runs; i++) {
      tool.clean?.(dir);
      fs.rmSync(path.join(dir, step.css), { force: true });
      cold.push(run(step, dir));
      warm.push(run(step, dir));
    }
    // One source file changes (a comment, so every tool's output stays what it was) and the build runs again.
    const source = path.join(dir, 'components', fs.readdirSync(path.join(dir, 'components')).sort()[0]);
    const original = fs.readFileSync(source, 'utf8');
    const changed = [];
    for (let i = 0; i < runs; i++) {
      fs.writeFileSync(source, `${original}\n// changed ${i}\n`);
      changed.push(run(step, dir));
    }
    fs.writeFileSync(source, original);
    run(step, dir);
    const css = fs.readFileSync(path.join(dir, step.css), 'utf8');
    const min = minify(css);
    result.build = { coldMs: Math.round(median(cold)), warmMs: Math.round(median(warm)), changedMs: Math.round(median(changed)) };
    result.css = { raw: Buffer.byteLength(css), ...sizes(min), rules: (min.match(/\{[^{}]*\}/g) ?? []).length };

    // The JavaScript a browser loads for the styling of these components.
    let bundle = path.join(dir, 'bundle.js');
    if (tool.bundleFromBuild) bundle = path.join(dir, tool.bundleFromBuild);
    else {
      await esbuild({
        absWorkingDir: dir,
        entryPoints: ['classes.ts'],
        outfile: bundle,
        bundle: true,
        minify: true,
        format: 'esm',
        platform: 'browser',
        jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"' },
        logLevel: 'error',
        plugins: [...((await tool.plugins?.(dir)) ?? []), noReact],
      });
    }
    result.js = sizes(fs.readFileSync(bundle, 'utf8'));

    const measure = (mode) => JSON.parse(execFileSync(process.execPath, [path.join(here, 'scripts/measure-runtime.mjs'), bundle, pageFile, mode], { encoding: 'utf8', maxBuffer: 1 << 28 }));
    const loads = [];
    const ops = [];
    for (let i = 0; i < runs; i++) {
      const m = measure('ops');
      loads.push(m.load);
      ops.push(m.opsPerSec);
    }
    result.runtime = { loadMs: Number(median(loads).toFixed(2)), classNamesPerSec: median(ops) };

    const { classes } = measure('html');
    const body = classes.map((c, i) => `<div class="${c}"${i % 7 === 0 ? ' aria-selected="true"' : ''}>x</div>`).join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${min}</style></head><body>\n${body}\n</body></html>`;
    const attr = classes.reduce((n, c) => n + c.length, 0);
    const count = classes.reduce((n, c) => n + c.split(' ').filter(Boolean).length, 0);
    result.html = { classBytes: attr, perElement: Number((attr / classes.length).toFixed(1)), classesPerElement: Number((count / classes.length).toFixed(1)), ...sizes(body) };
    result.total = { gzip: result.css.gzip + result.js.gzip + result.html.gzip, brotli: result.css.brotli + result.js.brotli + result.html.brotli };
    if (chrome) {
      fs.writeFileSync(path.join(dir, 'page.html'), html);
      result.struck = await struck(path.join(dir, 'page.html'), chrome);
    }
    process.stderr.write(`build ${result.build.coldMs} ms, css ${result.css.brotli} B br, js ${result.js.brotli} B br${result.struck ? `, struck ${result.struck.count}` : ''}\n`);
  } catch (err) {
    result.error = String(err.message).split('\n').slice(0, 12).join('\n');
    process.stderr.write(`FAILED\n${result.error}\n`);
  }
  results.push(result);
  if (!args.keep) fs.rmSync(path.join(dir, 'node_modules/.cache'), { recursive: true, force: true });
}

const report = {
  date: new Date().toISOString().slice(0, 10),
  machine: { cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, node: process.version, platform: `${os.platform()} ${os.arch()}` },
  corpus: {
    model: args.model,
    components,
    styles: spec.components.reduce((n, c) => n + 1 + c.variants.length, 0),
    declarations: spec.components.reduce((n, c) => n + [c.base, ...c.variants.map((v) => v.style)].reduce((m, s) => m + s.reduce((k, d) => k + 1 + d.conditions.length, 0), 0), 0),
    pageElements: page.length,
    runs,
  },
  results,
};
if (args.merge && args.json && fs.existsSync(path.resolve(args.json))) {
  // keep the other tools' rows, in the order of the tool list
  const before = JSON.parse(fs.readFileSync(path.resolve(args.json), 'utf8'));
  const fresh = new Map(results.map((r) => [r.id, r]));
  const kept = new Map(before.results.map((r) => [r.id, r]));
  report.results = TOOLS.map((t) => fresh.get(t.id) ?? kept.get(t.id)).filter(Boolean);
  report.date = before.date === report.date ? report.date : `${before.date} and ${report.date}`;
}
if (args.json) fs.writeFileSync(path.resolve(args.json), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
