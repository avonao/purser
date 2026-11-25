// Load the tokens module and rebuild its exports for static evaluation.

import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { defineTokens } from '../tokens.js';
import { extractStaticExports } from './extract.js';

/**
 * A tokens module is almost always literals and const bindings, so it is read from its source first: no worker thread
 * and no type stripping. Anything that only running the module can decide (a computed scale, a re-export) loads it in
 * a worker instead, which gives the same answer.
 * @param {string} file absolute path of the tokens module (.js/.mjs/.ts with erasable syntax)
 * @param {{ ts?: any, packageName?: string }} [host] the parser, when the caller has one
 * @returns {Promise<{ definition: { axes: object, tokens: object } | null, exports: Record<string, unknown>, exportName: string | null }>}
 */
export async function loadTokensModule(file, host = {}) {
  return finishTokens(await readTokensModule(file, host), file);
}

/**
 * The raw exports of the tokens module: `static` tells whether they were read from the source (and can be cached by
 * the file's content) or the module had to be run.
 * @param {string} file
 * @param {{ ts?: any, packageName?: string, text?: string }} [host]
 * @returns {Promise<{ ok: boolean, static: boolean, sets: { name: string, def: object }[], statics: Record<string, unknown>, message?: string }>}
 */
export async function readTokensModule(file, host = {}) {
  if (host.ts && process.env.PURSER_TOKENS !== 'run') {
    let text = host.text ?? null;
    if (text === null) {
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        // the worker reports a missing file
      }
    }
    if (text !== null) {
      const read = extractStaticExports(file, text, { ts: host.ts, packageName: host.packageName ?? '@avonao/purser' });
      if (read.ok) return { ...read, static: true };
    }
  }
  return { ...(await runTokensModule(file)), static: false };
}

/** Check what the tokens module exports and rebuild its defineTokens() result. */
export function finishTokens(result, file) {
  if (!result.ok) {
    throw new Error(
      `purser: could not load the tokens module ${file}\n${result.message}\n` +
        '(A TypeScript tokens module must use erasable syntax only — no enums, namespaces or parameter properties — and import with explicit file extensions.)',
    );
  }
  if (result.sets.length > 1) {
    throw new Error(`purser: ${file} exports ${result.sets.length} defineTokens() results (${result.sets.map((s) => s.name).join(', ')}); export exactly one`);
  }
  const exportsObj = { ...result.statics };
  const set = result.sets[0];
  if (set) exportsObj[set.name] = defineTokens(set.def);
  return { definition: set ? set.def : null, exports: exportsObj, exportName: set ? set.name : null };
}

/** Load the module in a fresh worker (so --watch always sees the current module graph). */
function runTokensModule(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./tokens-worker.js', import.meta.url), { workerData: { file } });
    worker.once('message', (m) => {
      resolve(m);
      worker.terminate();
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`purser: loading ${file} exited with code ${code}`));
    });
  });
}
