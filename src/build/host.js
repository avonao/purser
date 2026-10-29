// Optional peer dependencies (typescript, postcss) are resolved from the HOST
// project, never bundled with purser.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** A require() that resolves from the project directory. */
export function hostRequire(projectDir) {
  return createRequire(path.join(path.resolve(projectDir), 'package.json'));
}

/** Load the project's `typescript`, or throw a clear error. */
export function loadTypeScript(projectDir) {
  try {
    return hostRequire(projectDir)('typescript');
  } catch {
    throw new Error(`purser: the build needs the "typescript" package installed in ${projectDir} (it parses your source files)`);
  }
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
