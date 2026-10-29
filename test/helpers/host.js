// Resolve optional host tools (typescript, postcss) the same way the build does.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostRequire } from '../../src/build/host.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function tryRequire(name) {
  try {
    return hostRequire(ROOT)(name);
  } catch {
    return null;
  }
}
