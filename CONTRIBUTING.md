# Contributing to Purser

Thanks for helping. Purser exists to make a small set of CSS rules impossible to break, so every change is judged first by whether those guarantees still hold.

## Setup

Purser has no runtime dependencies and no build step. The build and the tests use `typescript` and `postcss` from the environment:

```sh
npm install        # installs the development tools (typescript, postcss)
npm test           # node --test
```

If Google Chrome is installed (macOS default path, or set `PURSER_CHROME` to the binary), the integration test runs it headless; otherwise that test is skipped.

## Ground rules

- **Keep the guarantees.** Any change to condition compilation, globals or tokens must keep the exclusivity self-checks passing, and should add a case to `tests/conditions.test.js`, `tests/globals.test.js` or `tests/tokens.test.js`.
- **Keep the runtime small.** `src/index.js` must not import build-only modules (`color.js`, `conditions.js`, `compile/`, `build/`).
- **Treat class names as public.** A change to `hash.js` or to normalisation that renames classes is a breaking change and needs a changelog entry under "Changed".
- **Golden files.** If a change intentionally alters output, regenerate with `npm run test:update` and review the diff of `tests/fixtures/app/expected.css`.
- **Style.** Plain ESM JavaScript, small focused modules, JSDoc on exported functions, and clear error messages that tell the author what to write instead.
- **Types.** Update `types/*.d.ts` with any API change. `tests/types/usage.ts` holds the type-level tests. If `REJECTED` in `src/shorthands.js` changes, run `node scripts/gen-properties.js` (it needs `csstype`).

## Pull requests

Describe the behaviour change, link an issue if there is one, and fill in the checklist in the PR template. Keep each PR to one concern.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
