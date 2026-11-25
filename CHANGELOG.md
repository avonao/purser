# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Class names are part of the public contract: a change to the hash or to normalisation that renames classes is a breaking change.

## [0.2.0] - Unreleased

### Added

- **The compiler** (`@avonao/purser/compiler` and the bundler plugins `@avonao/purser/vite`, `/rollup`, `/esbuild`, `/webpack` and `/webpack-loader`). It rewrites a module at build time so the browser runs no style code: `css.create` becomes class names or disappears, a `css.props` call whose arguments are styles of the same file (with `&&`, `?:`, arrays) becomes one string expression that tests each guard once, `css.keyframes` becomes its name, `css.globals` is removed and `defineTokens` becomes its result. A `css.props` call the compiler cannot decide keeps only the merge (`@avonao/purser/compiled`). Line numbers are kept and a source map is written. With `src` and `out` a plugin also writes the stylesheet. [Guide](docs/compiler.md).
- **`granularity: 'rule'`** (`--granularity rule`, `PURSER_GRANULARITY`): one class per generated rule instead of one per property of a style, so styles share the rules they have in common. The runtime for it is `@avonao/purser/rule`.
- **`names: 'min'`** (`--names min`, `--names-file`): the shortest class names there are (`_a`, `_b`, …), given by the build to the most used classes first, append-only, kept between builds in a names file. Needs the compiler.
- **`minify`** (`--minify`): a stylesheet without whitespace in which rules that write the same declaration share one rule. Only selectors every target browser parses share a selector list.
- **`fuse: 'exact' | 'balanced' | 'max'`** (`--fuse`, with `names: 'min'`): classes that are applied together become one class. The build plans this from every group of classes the compiled modules apply. `exact` fuses classes that never appear without each other and writes no rule twice; `balanced` also gives frequent pairs a class; `max` gives every group one class. A style that no compiled module applies is not written. Dev servers and watching builds keep one name per class.
- **A build cache** (`node_modules/.cache/purser`; `cache`, `--no-cache`, `PURSER_CACHE=0`): what each file's `css.*` calls evaluate to, and what the module compiles to, by the file's content. A build of unchanged files does not load the parser, and `purser build` with no changed input and its output still in place answers from a record without doing the work.
- Worker threads for parsing and compiling from four processors on (`threads`).
- `benchmarks/`: one generated design system built with Purser, StyleX, Tailwind CSS, UnoCSS, Panda CSS and vanilla-extract, measured for build time, bytes of stylesheet, JavaScript and markup, load time, and declarations a browser strikes through. [Results](docs/benchmarks.md).

### Changed

- The build parses each file once, without the parser's parent links, and reads a tokens module of literals and `const` bindings from its source instead of running it.
- Projects on TypeScript 7, whose package no longer has the parser API, or without TypeScript: Purser now depends on `typescript` (`>=5 <7`) and uses its own copy when the project's has no parser. A project on TypeScript 5 or 6 is still parsed with its own.
- `package.json` adds the entries `./rule`, `./compiled`, `./compiler`, `./vite`, `./rollup`, `./esbuild`, `./webpack` and `./webpack-loader`.

### Unchanged

- The default output. Without the new options a project gets the stylesheet and the class names it got from 0.1.0, byte for byte (the golden files did not change).

## [0.1.0] - Unreleased

### Added

- Runtime: `css.create`, `css.props`, `css.keyframes`, `css.globals`, `createCss({ prefix, salt })` and `defineTokens`, with hand-written TypeScript declarations. Colour properties accept only colour tokens, and rejected shorthands show their advice in type errors.
- Exclusive conditions: every property's conditional branches compile into mutually exclusive rules, and the build proves this by brute force on every property.
- Theme axes for tokens, with per-token axis dependency analysis. Every custom property is declared exactly once in any root state.
- Exact `lab()` conversion (CSS Color 4) from hex, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()` and named colours.
- Shorthand policy: expanded, allowed whole, or rejected with advice. Logical and physical twins replace each other.
- Globals made exclusive with each other and with atom classes, without the exclusions that tag names already rule out (`h1` never needs `:not(.card button)`).
- Build: static extraction with the host's TypeScript; `purser build` (with `--watch`) and `purser check`; JS API in `@avonao/purser/build`; output self-check with the host's PostCSS.
- `scripts/strike-count.js`, an in-page counter of overridden declarations, and a headless Chrome integration test.
- Configurable cascade layer names (`layers` build option, `--layers`), so that a project adopting Purser next to existing CSS can place globals below its old rules and atoms above them.
