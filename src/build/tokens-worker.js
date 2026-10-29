// Loads the tokens module in a fresh worker (so --watch always sees the
// current module graph) and posts back token definitions and static exports.

import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

const TOKENS = Symbol.for('purser.tokens');

function isPlainData(v, depth = 0) {
  if (depth > 32) return false;
  if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) return true;
  if (Array.isArray(v)) return v.every((x) => isPlainData(x, depth + 1));
  if (typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
    return Object.values(v).every((x) => isPlainData(x, depth + 1));
  }
  return false;
}

try {
  const mod = await import(pathToFileURL(workerData.file).href);
  const sets = [];
  const statics = {};
  for (const [name, value] of Object.entries(mod)) {
    if (value && typeof value === 'object' && value[TOKENS]) sets.push({ name, def: value[TOKENS] });
    else if (isPlainData(value)) statics[name] = value;
  }
  parentPort.postMessage({ ok: true, sets, statics });
} catch (err) {
  parentPort.postMessage({ ok: false, message: err?.stack ?? String(err) });
}
