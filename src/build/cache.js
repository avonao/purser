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

/**
 * Where a project's cache lives: next to its dependencies. In a workspace whose packages keep theirs in a directory
 * further up, in that one, under a name of the project's own; without any, in the user's cache directory.
 *
 * Never in the shared temporary directory: the cache holds what modules compile to, so it must be a place that only
 * the people who can already change the project's dependencies can write to.
 */
export function cacheDirectory(projectDir, configured) {
  if (typeof configured === 'string') return path.resolve(projectDir, configured);
  const own = path.join(projectDir, 'node_modules');
  if (isDirectory(own)) return path.join(own, '.cache', 'purser');
  for (let dir = path.dirname(projectDir); ; dir = path.dirname(dir)) {
    const modules = path.join(dir, 'node_modules');
    if (isDirectory(modules)) return path.join(modules, '.cache', 'purser', hashText(projectDir));
    if (path.dirname(dir) === dir) break;
  }
  return path.join(userCacheDirectory(), hashText(projectDir));
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** The directory an operating system gives a user's programs for what they can compute again. */
function userCacheDirectory() {
  if (process.env.XDG_CACHE_HOME) return path.join(process.env.XDG_CACHE_HOME, 'purser');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'purser');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'purser', 'Cache');
  return path.join(os.homedir(), '.cache', 'purser');
}

/**
 * Look at a file through one open: `use` gets its modification time and size and a function that reads its text. What
 * is read is what the stamp describes, whatever happens to the path in between.
 * @template T
 * @param {string} file
 * @param {(stat: { mtimeMs: number, size: number }, read: () => string) => T} use
 * @returns {T}
 */
export function withFile(file, use) {
  const fd = fs.openSync(file, 'r');
  try {
    return use(fs.fstatSync(fd), () => fs.readFileSync(fd, 'utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

/** Replace a file in one step: written beside it under a name nobody can have prepared, then renamed over it. */
export function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx', mode: 0o644 });
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
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
        writeAtomic(file, JSON.stringify(data));
        dirty = false;
      } catch {
        // a read-only or full disk: the build is unaffected
      }
    },
  };
}
