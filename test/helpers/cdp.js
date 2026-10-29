// Minimal Chrome DevTools Protocol driver (headless Chrome + Node's built-in WebSocket).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CHROME = process.env.PURSER_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const hasChrome = () => fs.existsSync(CHROME) && typeof WebSocket === 'function';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchChrome() {
  const port = 9300 + Math.floor(Math.random() * 600);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purser-chrome-'));
  const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files'];
  if (process.env.CI) args.push('--no-sandbox'); // CI containers often lack the user namespaces Chrome's sandbox needs
  const proc = spawn(CHROME, [...args, 'about:blank'], { stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try {
      await fetch(`http://localhost:${port}/json/version`);
      ready = true;
    } catch {
      await sleep(150);
    }
  }
  if (!ready) {
    proc.kill();
    throw new Error('Chrome did not start');
  }
  const tab = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (d) => (d.error ? reject(new Error(`${method}: ${JSON.stringify(d.error)}`)) : resolve(d.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page script failed: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
    return r.result.value;
  };
  await send('Page.enable');
  const close = () => {
    try {
      ws.close();
    } catch {}
    proc.kill();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  };
  return { send, evaluate, close };
}
