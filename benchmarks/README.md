# Benchmarks

One generated design system, written out for each tool and built with it. The results, and what they mean, are in [`docs/benchmarks.md`](../docs/benchmarks.md); this directory is what produces them. It is not part of the published package.

## Run

```sh
cd benchmarks
npm install                       # the other tools, and Purser from the parent directory
node run.mjs --components 500 --json results/interface-500.json
node scripts/print.mjs results/interface-500.json    # a table in the terminal
node scripts/report.mjs                               # writes ../docs/benchmarks.md from results/*.json
```

| Option | Default | |
| --- | --- | --- |
| `--components <n>` | `500` | Components to generate |
| `--model interface\|uniform` | `interface` | Which properties get which conditions (see `spec.mjs`) |
| `--elements <n>` | `2000` | Elements on the page that is rendered |
| `--runs <n>` | `5` | Builds per timing; the median is reported |
| `--only <ids>` | every tool | Comma-separated tool ids from `tools.mjs` (also runs the entries marked `extra`) |
| `--no-browser` | | Skip the struck-declaration count (it needs Chrome: Playwright's, or the binary in `PURSER_CHROME`) |
| `--json <file>` | | Write the results; with `--merge`, keep the rows of tools that were not run this time |
| `--keep` | | Keep each tool's caches between tools |

The work directory is `.work/<model>-<components>/<tool>/`: the generated sources, the stylesheet, the bundle and the page of every tool, to look at.

## Files

| | |
| --- | --- |
| `spec.mjs` | The design system: tokens, properties, conditions, and the seeded generator of components and of the page |
| `emit/` | One emitter per idiom: Purser, StyleX, utility classes (Tailwind CSS and UnoCSS), Panda CSS, vanilla-extract |
| `tools.mjs` | One entry per tool: its emitter, the command that builds its stylesheet, the esbuild plugins its modules need |
| `run.mjs` | The runner: generate, emit, build, bundle, measure |
| `scripts/` | The StyleX and vanilla-extract builds (they have no CLI of their own), the run-time measurement, Chrome, the two reports |
| `results/` | The result files `docs/benchmarks.md` is written from |

## Adding a tool

Write an emitter that turns the spec into sources in the tool's idiom, with a `classes.ts` that exports one function per component (`(props) => className`), and add an entry to `tools.mjs`. The runner needs nothing else. A tool that cannot express something in the spec should fail loudly in its emitter instead of leaving it out.

## Fairness

- Every tool is given the same styles, the same page and the same seed.
- Every stylesheet goes through the same minifier with the same browser targets before it is measured.
- Every tool builds in a new process, with the command its documentation gives.
- A helper a tool needs in the browser to combine classes is part of its JavaScript; React is part of none.
- Each emitter follows the tool's documented way of writing a component with variants. If you maintain one of these tools and would write it differently, the emitter is the place: open an issue or a pull request.
