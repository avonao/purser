# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Class names are part of the public contract: a change to the hash or to normalisation that renames classes is a breaking change.

## [0.1.0] - Unreleased

### Added

- Runtime: `css.create`, `css.props`, `css.keyframes`, `css.globals`, `createCss({ prefix, salt })` and `defineTokens`, with hand-written TypeScript declarations. Colour properties accept only colour tokens, and rejected shorthands show their advice in type errors.
- Exclusive conditions: every property's conditional branches compile into mutually exclusive rules, and the build proves this by brute force on every property.
- Theme axes for tokens, with per-token axis dependency analysis. Every custom property is declared exactly once in any root state.
- Exact `lab()` conversion (CSS Color 4) from hex, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `color()` and named colours.
- Shorthand policy: expanded, allowed whole, or rejected with advice. Logical and physical twins replace each other.
- Globals made exclusive with each other and with atom classes.
- Build: static extraction with the host's TypeScript; `purser build` (with `--watch`) and `purser check`; JS API in `@avonao/purser/build`; output self-check with the host's PostCSS.
- `scripts/strike-count.js`, an in-page counter of overridden declarations, and a headless Chrome integration test.
- Configurable cascade layer names (`layers` build option, `--layers`), so that a project adopting Purser next to existing CSS can place globals below its old rules and atoms above them.
