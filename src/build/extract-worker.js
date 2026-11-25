// Extraction on a worker thread: parse a share of the project's files and post back what their css.* calls evaluate
// to. The main thread keeps everything else (diagnostic positions are looked up there, on demand).

import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { hashText } from './cache.js';
import { extractFile } from './extract.js';
import { analyzeModule } from '../compiler/transform.js';
import { memoizedClassNames, normalizeNamedStyle } from './memo.js';
import { makeCreateCss } from '../runtime.js';
import { compilerOptions, loadTypeScript, real } from './host.js';

// identity: the naming class ids are computed with, when the build also wants what every module compiles to
const { projectDir, packageName, naming, identity, tokensReal, tokensExports, cssModuleReal, files } = workerData;

try {
  const ts = loadTypeScript(projectDir);
  const tsOptions = compilerOptions(ts, projectDir);
  const resolutionCache = ts.createModuleResolutionCache(projectDir, (x) => x, tsOptions);
  const resolved = new Map();
  const resolve = (spec, fromFile) => {
    const key = `${spec}\u0000${path.dirname(fromFile)}`;
    if (!resolved.has(key)) {
      const r = ts.resolveModuleName(spec, fromFile, tsOptions, ts.sys, resolutionCache).resolvedModule;
      resolved.set(key, r ? real(r.resolvedFileName) : null);
    }
    return resolved.get(key);
  };
  const ctx = {
    ts,
    packageName,
    naming,
    resolveStatic: (spec, fromFile) => (tokensReal && resolve(spec, fromFile) === tokensReal ? tokensExports : undefined),
    isCssModule: (spec, fromFile) => Boolean(cssModuleReal) && resolve(spec, fromFile) === cssModuleReal,
  };
  const moduleCtx = identity && { ...ctx, isPure: (spec, fromFile) => Boolean(tokensReal) && resolve(spec, fromFile) === tokensReal, naming: identity, css: makeCreateCss(memoizedClassNames(), normalizeNamedStyle)(identity) };
  const results = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const found = extractFile(file, text, moduleCtx ? { ...ctx, nodes: true } : ctx);
    const result = { file, hash: hashText(text), diagnostics: found.diagnostics, calls: found.calls.map(({ locate: _locate, node: _node, ...call }) => call) };
    if (moduleCtx) result.module = cssModuleReal !== null && real(file) === cssModuleReal ? null : analyzeModule(found, text, file, moduleCtx);
    results.push(result);
  }
  parentPort.postMessage({ ok: true, results });
} catch (err) {
  parentPort.postMessage({ ok: false, message: err?.stack ?? String(err) });
}
