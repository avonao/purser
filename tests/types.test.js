import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT, tryRequire } from './helpers/host.js';

const ts = tryRequire('typescript');
const skip = ts ? false : 'typescript is not installed in the host project';

test('type declarations accept valid styles and reject raw colours, shorthands and typos', { skip }, () => {
  const program = ts.createProgram([path.join(ROOT, 'tests/types/usage.ts')], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
    paths: { '@avonao/purser': [path.join(ROOT, 'types/index.d.ts')], '@avonao/purser/build': [path.join(ROOT, 'types/build.d.ts')] },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => {
    const line = d.file ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
    return `${d.file ? path.basename(d.file.fileName) : ''}:${line} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  });
  // Unused @ts-expect-error directives would show up here as errors too.
  assert.deepEqual(diagnostics, []);
});
