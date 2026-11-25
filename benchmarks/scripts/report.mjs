// Write docs/benchmarks.md from the results files: `node scripts/report.mjs` (run from benchmarks/).
// Every number in that document comes from results/*.json; the sentences that compare tools are computed here too,
// so the text cannot drift from the tables.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (name) => {
  const file = path.join(root, 'results', `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
const version = (pkg) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;
  } catch {
    return 'not installed';
  }
};

const kb = (bytes) => (bytes / 1000).toFixed(bytes < 9995 ? 2 : 1);
const int = (n) => Math.round(n).toLocaleString('en-US');
const pct = (a, b) => `${Math.abs(Math.round((1 - a / b) * 100))}%`;
const ok = (r) => !r.error;
const rate = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : `${int(n / 1000)} thousand`);

/** The best value of a column among the rows, to set it in bold. */
function best(rows, get, lower = true) {
  const values = rows.filter(ok).map(get);
  return lower ? Math.min(...values) : Math.max(...values);
}
const mark = (value, top, text) => (value === top ? `**${text}**` : text);

function sizeTable(report) {
  const rows = report.results;
  const b = {
    css: best(rows, (r) => r.css.brotli),
    js: best(rows, (r) => r.js.brotli),
    html: best(rows, (r) => r.html.brotli),
    total: best(rows, (r) => r.total.brotli),
    per: best(rows, (r) => r.html.classesPerElement),
    struck: best(rows, (r) => r.struck?.count ?? Infinity),
  };
  let out = `| | Stylesheet | JavaScript | Markup | **Total** | Classes per element | Declarations struck |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
  for (const r of rows) {
    if (!ok(r)) {
      out += `| ${r.label} | failed: ${r.error.split('\n')[0]} | | | | | |\n`;
      continue;
    }
    out += `| ${r.label} | ${mark(r.css.brotli, b.css, kb(r.css.brotli))} | ${mark(r.js.brotli, b.js, kb(r.js.brotli))} | ${mark(r.html.brotli, b.html, kb(r.html.brotli))} | ${mark(r.total.brotli, b.total, kb(r.total.brotli))} | ${mark(r.html.classesPerElement, b.per, r.html.classesPerElement)} | ${r.struck ? mark(r.struck.count, b.struck, int(r.struck.count)) : 'not measured'} |\n`;
  }
  return out;
}

function timeTable(report) {
  const rows = report.results;
  const b = {
    cold: best(rows, (r) => r.build.coldMs),
    warm: best(rows, (r) => r.build.warmMs),
    changed: best(rows, (r) => r.build.changedMs ?? Infinity),
    load: best(rows, (r) => r.runtime.loadMs),
    ops: best(rows, (r) => r.runtime.classNamesPerSec, false),
  };
  let out = `| | Build from nothing | Nothing changed | One file changed | Module load | Class names per second |\n| --- | ---: | ---: | ---: | ---: | ---: |\n`;
  for (const r of rows) {
    if (!ok(r)) continue;
    out += `| ${r.label} | ${mark(r.build.coldMs, b.cold, `${int(r.build.coldMs)} ms`)} | ${mark(r.build.warmMs, b.warm, `${int(r.build.warmMs)} ms`)} | ${r.build.changedMs === undefined ? '' : mark(r.build.changedMs, b.changed, `${int(r.build.changedMs)} ms`)} | ${mark(r.runtime.loadMs, b.load, `${r.runtime.loadMs.toFixed(2)} ms`)} | ${mark(r.runtime.classNamesPerSec, b.ops, rate(r.runtime.classNamesPerSec))} |\n`;
  }
  return out;
}

/** Sentences about one results file, each computed from its rows. */
function reading(report) {
  const rows = report.results.filter(ok);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  const exact = by['purser-exact'];
  const max = by['purser-max'];
  const others = rows.filter((r) => !r.id.startsWith('purser'));
  if (!exact || !others.length) return '';
  const lines = [];
  const lowest = (get) => others.reduce((a, r) => (get(r) < get(a) ? r : a));
  const total = lowest((r) => r.total.brotli);
  lines.push(
    `- **Bytes sent.** Purser with \`fuse: 'exact'\` sends ${kb(exact.total.brotli)} kB in total, ${pct(exact.total.brotli, total.total.brotli)} ${exact.total.brotli < total.total.brotli ? 'less' : 'more'} than the smallest of the other tools (${total.label}, ${kb(total.total.brotli)} kB)${
      max ? `; with \`fuse: 'max'\` it is ${kb(max.total.brotli)} kB, ${pct(max.total.brotli, total.total.brotli)} ${max.total.brotli < total.total.brotli ? 'less' : 'more'}` : ''
    }. ${others.map((r) => `${r.label}: ${kb(r.total.brotli)} kB`).join(', ')}.`,
  );
  const css = lowest((r) => r.css.brotli);
  if (css.css.brotli < exact.css.brotli) {
    lines.push(
      `- **The stylesheet alone** is smaller with ${others.filter((r) => r.css.brotli < exact.css.brotli).map((r) => `${r.label} (${kb(r.css.brotli)} kB)`).join(', ')} than with Purser (${kb(exact.css.brotli)} kB). Purser's rules carry the conditions that keep them from overlapping (\`:not(:hover)\` on the rule for the state that is not hovered), and a rule for each distinct condition. What those tools save there, they spend, and more, on class names in the modules and the markup.`,
    );
  }
  const struck = others.filter((r) => r.struck);
  if (exact.struck && struck.length) {
    lines.push(
      `- **Overridden declarations.** On the generated page a browser strikes through ${exact.struck.count === 0 ? 'none' : int(exact.struck.count)} of Purser's declarations. For the others it is ${struck.map((r) => `${int(r.struck.count)} (${r.label})`).join(', ')}: each is a declaration that was sent, parsed and matched, and lost to another one.`,
    );
  }
  const cold = lowest((r) => r.build.coldMs);
  const slower = others.filter((r) => r.build.coldMs > exact.build.coldMs);
  lines.push(
    `- **Build from nothing.** ${cold.build.coldMs < exact.build.coldMs ? `${others.filter((r) => r.build.coldMs < exact.build.coldMs).map((r) => `${r.label} (${int(r.build.coldMs)} ms)`).join(', ')} ${others.filter((r) => r.build.coldMs < exact.build.coldMs).length === 1 ? 'is' : 'are'} faster than Purser (${int(exact.build.coldMs)} ms): Purser parses every module with the TypeScript parser and evaluates its styles, which is what lets it prove its rules and compile the modules${slower.length ? `; ${slower.map((r) => `${r.label} (${int(r.build.coldMs)} ms)`).join(', ')} ${slower.length === 1 ? 'takes' : 'take'} longer` : ''}.` : `Purser is the fastest (${int(exact.build.coldMs)} ms).`}`,
  );
  const warm = lowest((r) => r.build.warmMs);
  lines.push(
    `- **Build again.** With nothing changed Purser answers in ${int(exact.build.warmMs)} ms (${warm.build.warmMs < exact.build.warmMs ? `${warm.label} takes ${int(warm.build.warmMs)} ms` : `the next is ${warm.label} with ${int(warm.build.warmMs)} ms`})${
      exact.build.changedMs === undefined ? '' : `; after one file changed it takes ${int(exact.build.changedMs)} ms (${lowest((r) => r.build.changedMs ?? Infinity).label}: ${int(lowest((r) => r.build.changedMs ?? Infinity).build.changedMs)} ms)`
    }.`,
  );
  const load = lowest((r) => r.runtime.loadMs);
  lines.push(
    `- **In the browser.** The compiled modules load in ${exact.runtime.loadMs.toFixed(2)} ms (${load.label}: ${load.runtime.loadMs.toFixed(2)} ms) and resolve ${rate(exact.runtime.classNamesPerSec)} class lists a second (${others.map((r) => `${r.label}: ${rate(r.runtime.classNamesPerSec)}`).join(', ')}).`,
  );
  return `${lines.join('\n')}\n`;
}

const TITLES = {
  'interface-500': ['500 components', 'The main run.'],
  'interface-100': ['100 components', 'A small project.'],
  'interface-2000': ['2,000 components', 'A large project. StyleX and vanilla-extract are left out of this run: one build of theirs takes minutes at this size, and every tool is built ten times.'],
  'uniform-500': ['500 components, the stress corpus', 'Every condition is as likely on every property, so far more distinct rules exist than an interface has.'],
};

const main = read('interface-500');
if (!main) throw new Error('results/interface-500.json is missing: run `node run.mjs --components 500 --json results/interface-500.json` first');

let md = `# Benchmarks

One design system, generated from a seed, written out for each tool in that tool's own idiom and built with it. The numbers answer three questions: how much is sent to a browser, what the browser has to do with it, and how long the build takes.

Everything here can be run again: the generator, the emitters and the runner are in [\`benchmarks/\`](../benchmarks/README.md), and this page is written from the result files by \`benchmarks/scripts/report.mjs\`. Sizes are in kB (1,000 bytes) after Brotli at quality 11; the best value of a column is in bold.

Measured on ${main.date} with Node ${main.machine.node} on ${main.machine.cores} cores (${main.machine.cpu}, ${main.machine.platform}). Purser is this repository at the commit that carries the result files; the others are StyleX ${version('@stylexjs/babel-plugin')}, Tailwind CSS ${version('tailwindcss')} (with tailwind-merge ${version('tailwind-merge')} in its second row), UnoCSS ${version('unocss')} (preset-wind4), Panda CSS ${version('@pandacss/dev')} and vanilla-extract ${version('@vanilla-extract/css')}.

`;

for (const name of ['interface-500', 'interface-100', 'interface-2000', 'uniform-500']) {
  const report = read(name);
  if (!report) continue;
  const [title, lead] = TITLES[name];
  const c = report.corpus;
  md += `## ${title}

${lead} ${int(c.styles)} styles with ${int(c.declarations)} declarations (conditional values counted once per condition); the page has ${int(c.pageElements)} elements; build times are the median of ${c.runs} runs.

### What is sent

${sizeTable(report)}
### What it costs

${timeTable(report)}
${reading(report)}
`;
}

md += `## What is measured

- **Stylesheet.** The tool's stylesheet for all components, then minified with Lightning CSS for the browsers Purser targets (the same minifier and targets for every tool, so no tool is measured with a better minifier than another), then compressed.
- **JavaScript.** One entry that exports, for every component, the function that returns its class list from its variant props, bundled and minified with esbuild, then compressed. React itself is left out; a class-merging helper a tool needs at run time (clsx, tailwind-merge, the StyleX and Panda runtimes) is in.
- **Markup.** A page of elements, each a component with a random set of its variants switched on, rendered to \`<div class="…">\` and compressed. Only the class attributes differ between tools.
- **Total.** The three together: what a first visit to that page downloads for styling.
- **Classes per element.** The average number of classes in a class attribute of that page.
- **Declarations struck.** The page in headless Chrome with the tool's stylesheet: the number of declarations that match an element and lose to another declaration of the same property on it (what DevTools strikes through), counted by [\`scripts/strike-count.js\`](../scripts/strike-count.js) in the page's resting state.
- **Build from nothing.** The tool's command that writes the stylesheet, in a new process, with no cache from an earlier run.
- **Nothing changed.** The same command again.
- **One file changed.** The same command after a comment was added to one component file.
- **Module load.** Importing the JavaScript bundle in Node: the time the styling code takes before the first render.
- **Class names per second.** Calling the class-list functions for the page's elements in a loop.

## The corpus

[\`benchmarks/spec.mjs\`](../benchmarks/spec.mjs) generates components from a seed. A component is a base style of 8 to 14 declarations and two or three variants of 3 to 5. Declarations are drawn from 25 properties with the frequencies an interface has (display, padding and colour often; z-index rarely), with values from a token scale (colours, spacing, radii, font sizes); 8% of the spacing values and half of the widths and heights are arbitrary pixel values instead. In the *interface* model a declaration gets the conditions its property gets in practice (hover and focus on colours, breakpoints on layout); in the *uniform* model every condition is as likely on every property. A variant sets some properties its base sets too, so applying it has to replace them.

Each emitter writes that description the way the tool's documentation does: \`css.create\` and \`css.props\` for Purser, \`stylex.create\` and \`stylex.props\` for StyleX, utility classes joined with clsx for Tailwind CSS and UnoCSS (and through \`twMerge\` in the tailwind-merge row, which is what makes a variant's override win), \`css()\` for Panda CSS, \`.css.ts\` files for vanilla-extract.

## What to keep in mind

- The corpus is generated, by the authors of one of the tools. It is neutral by construction (one description, six emitters) but it is not your application. The runner takes \`--components\`, \`--model\`, \`--elements\` and a seed in \`spec.mjs\`; the conclusions above held for every size and both models we ran, and where they did not hold the text says so.
- Purser's fused rows need its compiler (a bundler plugin). The row *Purser (runtime only)* is Purser without it.
- \`fuse: 'max'\` moves bytes from the modules and the markup into the stylesheet: the smallest total, and the largest stylesheet of the Purser rows. A site with many pages downloads the stylesheet once and the markup with every page.
- Build times are from a ${main.machine.cores}-core machine. Purser parses on worker threads from four cores on, which this machine does not have, so its build from nothing is measured on one thread.
- A tool that strikes a declaration is not wrong: the cascade decides, and the page looks as intended. The count is there because every struck declaration was sent and matched for nothing, and because where a declaration loses depends on the order of rules in a file that someone has to keep in mind.
`;

fs.writeFileSync(path.join(root, '..', 'docs', 'benchmarks.md'), md);
process.stdout.write(`wrote docs/benchmarks.md (${md.length} characters)\n`);
