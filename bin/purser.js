#!/usr/bin/env node
import module from 'node:module';

// Keep V8's compiled code of the build's modules (TypeScript's parser above all) between runs: the second and later
// builds skip compiling several megabytes of JavaScript. NODE_DISABLE_COMPILE_CACHE=1 turns it off.
try {
  module.enableCompileCache?.();
} catch {
  // a read-only cache directory: build without it
}

const { main } = await import('../src/cli.js');
process.exitCode = await main(process.argv.slice(2));
