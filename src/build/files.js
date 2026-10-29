// Source file discovery (deterministic order).

import fs from 'node:fs';
import path from 'node:path';

export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cts', '.cjs'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage', '.turbo', '.open-next']);

/** Is `file` a source file purser scans? */
export function isSourceFile(file) {
  return SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext)) && !/\.d\.[cm]?ts$/.test(file);
}

/**
 * List source files under the given directories, sorted.
 * @param {string} projectDir
 * @param {string[]} srcDirs relative to projectDir (files are allowed too)
 * @returns {string[]} absolute paths
 */
export function findSourceFiles(projectDir, srcDirs) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (e.name.startsWith('.') && e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (e.isFile() && isSourceFile(p)) out.push(p);
    }
  };
  for (const src of srcDirs) {
    const abs = path.resolve(projectDir, src);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new Error(`purser: source path not found: ${abs}`);
    }
    if (stat.isDirectory()) walk(abs);
    else if (isSourceFile(abs)) out.push(abs);
  }
  return [...new Set(out)].sort();
}
