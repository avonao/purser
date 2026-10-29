// Load the tokens module and rebuild its exports for static evaluation.

import { Worker } from 'node:worker_threads';
import { defineTokens } from '../tokens.js';

/**
 * @param {string} file absolute path of the tokens module (.js/.mjs/.ts with erasable syntax)
 * @returns {Promise<{ definition: { axes: object, tokens: object } | null, exports: Record<string, unknown>, exportName: string | null }>}
 */
export async function loadTokensModule(file) {
  const result = await new Promise((resolve, reject) => {
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
