// The extraction cache on disk: what each source file's css.* calls evaluated to, keyed by the file's content. A build
// of a project whose files have not changed parses nothing (and does not even load the parser).
//
// It is only ever a shortcut: an entry is used when the content hash and everything else the extraction depends on
// (Purser's version, the naming options, the tokens, tsconfig.json) are the same, and a file with a diagnostic is
// never stored. Deleting the directory is always safe.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FORMAT = 2;

export const hashText = (text) => crypto.createHash('sha1').update(text).digest('base64url').slice(0, 22);

/** Where a project's cache lives: next to its dependencies, or in the temporary directory when it has none installed. */
export function cacheDirectory(projectDir, configured) {
  if (typeof configured === 'string') return path.resolve(projectDir, configured);
  const modules = path.join(projectDir, 'node_modules');
  if (fs.existsSync(modules)) return path.join(modules, '.cache', 'purser');
  return path.join(os.tmpdir(), 'purser-cache', hashText(projectDir));
}

/**
 * @param {{ dir: string, key: string }} options key: everything but file contents that the extraction depends on
 */
export function openCache({ dir, key }) {
  const file = path.join(dir, 'extract.json');
  let data = { v: FORMAT, key, tokens: null, files: {} };
  let dirty = false;
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (stored && stored.v === FORMAT && stored.key === key && stored.files && typeof stored.files === 'object') data = stored;
  } catch {
    // no cache yet, or one this version cannot read: start empty
  }
  const seen = new Set();
  return {
    /**
     * @param {boolean} [needModule] only an entry that also has what the module compiles to counts
     * @returns {{ c: any[], m?: object | null } | null} the cached calls of a file (c) and, when the build that stored
     *   it compiled modules, what the module compiles to (m)
     */
    get(rel, hash, needModule = false) {
      const entry = data.files[rel];
      if (!entry || entry.h !== hash || (needModule && entry.m === undefined)) return null;
      seen.add(rel);
      return entry;
    },
    set(rel, hash, calls, module) {
      data.files[rel] = module === undefined ? { h: hash, c: calls } : { h: hash, c: calls, m: module };
      seen.add(rel);
      dirty = true;
    },
    getTokens: (hash) => (data.tokens && data.tokens.h === hash ? data.tokens.d : null),
    setTokens(hash, value) {
      data.tokens = { h: hash, d: value };
      dirty = true;
    },
    /** Write the cache if it changed, dropping files this build did not see. */
    save() {
      for (const rel of Object.keys(data.files)) {
        if (!seen.has(rel)) {
          delete data.files[rel];
          dirty = true;
        }
      }
      if (!dirty) return;
      try {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, file);
        dirty = false;
      } catch {
        // a read-only or full disk: the build is unaffected
      }
    },
  };
}
