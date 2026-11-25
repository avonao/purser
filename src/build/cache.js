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

const FORMAT = 1;

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
    /** @returns {any[] | null} the cached calls of a file */
    get(rel, hash) {
      const entry = data.files[rel];
      if (!entry || entry.h !== hash) return null;
      seen.add(rel);
      return entry.c;
    },
    set(rel, hash, calls) {
      data.files[rel] = { h: hash, c: calls };
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
