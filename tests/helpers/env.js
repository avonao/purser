// Loaded before every test file (`node --import`): what a build caches for a project without dependencies of its own
// goes to a directory of this test run, not to the cache directory of whoever runs the tests. The process that starts
// the run makes the directory and removes it; test files, the commands they start and worker threads inherit it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';

if (isMainThread && !process.env.PURSER_TEST_CACHE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purser-test-cache-'));
  process.env.PURSER_TEST_CACHE = dir;
  process.env.XDG_CACHE_HOME = dir;
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
}
