// Optional peer dependencies (typescript, postcss) are resolved from the HOST
// project, never bundled with purser.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** A require() that resolves from the project directory. */
export function hostRequire(projectDir) {
  return createRequire(path.join(path.resolve(projectDir), 'package.json'));
}

const ownRequire = createRequire(import.meta.url);

/** Does this `typescript` module have the parser API? TypeScript 7 (the native compiler) exports only its version. */
const hasParser = (ts) => Boolean(ts) && typeof ts.createSourceFile === 'function' && typeof ts.forEachChild === 'function';

/**
 * The TypeScript that parses source files: the project's own when it has the JavaScript parser API (TypeScript 5 and
 * 6), otherwise the copy Purser depends on. A project on TypeScript 7, or without TypeScript at all, builds with that copy.
 * @param {string} projectDir
 */
export function loadTypeScript(projectDir) {
  for (const load of [() => hostRequire(projectDir)('typescript'), () => ownRequire('typescript')]) {
    try {
      const ts = load();
      if (hasParser(ts)) return ts;
    } catch {
      // not installed there: try the next place
    }
  }
  throw new Error(
    `purser: no TypeScript with a parser API was found for ${projectDir} (the build parses your source files with it). ` +
      'Install typescript 5 or 6 next to @avonao/purser: npm install --save-dev "typescript@<7".',
  );
}

/** Load the project's `postcss`, or null when it is not installed. */
export function loadPostcss(projectDir) {
  try {
    return hostRequire(projectDir)('postcss');
  } catch {
    return null;
  }
}

/**
 * Read the project's compiler options (for module resolution of imports such
 * as "@/tokens"). Falls back to bundler-style resolution.
 */
export function compilerOptions(ts, projectDir) {
  const fallback = {
    moduleResolution: ts.ModuleResolutionKind.Bundler ?? ts.ModuleResolutionKind.NodeJs,
    module: ts.ModuleKind.ESNext,
    allowJs: true,
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
  };
  const configPath = ts.findConfigFile(projectDir, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath || !configPath.startsWith(path.resolve(projectDir))) return fallback;
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) return fallback;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
  return { ...fallback, ...parsed.options, allowJs: true };
}

/** Real path, or the resolved path when the file does not exist. */
export function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}
