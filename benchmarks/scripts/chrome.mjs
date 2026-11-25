// Headless Chrome over the DevTools protocol (no dependency): load a page, evaluate a script, return its value.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A port nobody listens on right now: asked of the system, so Chrome is told its port instead of being asked for it. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

/**
 * @param {string} chrome  the browser's executable
 * @param {string} htmlFile  the page
 * @param {string} scriptFile  a script the page loads before it is measured (it installs purserStrikeCount())
 */
export async function launch(chrome, htmlFile, scriptFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purser-bench-chrome-'));
  const port = await freePort();
  const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--window-size=1280,900', 'about:blank'], {
    stdio: 'ignore',
  });
  try {
    let tab = null;
    for (let i = 0; i < 100 && !tab; i++) {
      try {
        tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
      } catch {
        await sleep(100);
      }
    }
    if (!tab) throw new Error('Chrome did not start');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)(d);
        pending.delete(d.id);
      } else if (d.method) events.push(d.method);
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const i = ++id;
        pending.set(i, (d) => (d.error ? reject(new Error(`${method}: ${JSON.stringify(d.error)}`)) : resolve(d.result)));
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    await send('Page.enable');
    await send('Page.navigate', { url: pathToFileURL(htmlFile).href });
    for (let i = 0; i < 200 && !events.includes('Page.loadEventFired'); i++) await sleep(50);
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page script failed: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
      return r.result.value;
    };
    // Call a function in the page with values as its arguments: nothing is pasted into code.
    const call = async (fn, ...args) => {
      const { result: page } = await send('Runtime.evaluate', { expression: 'globalThis' });
      const r = await send('Runtime.callFunctionOn', { functionDeclaration: fn.toString(), objectId: page.objectId, arguments: args.map((value) => ({ value })), awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page function failed: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
      return r.result.value;
    };
    // The counter walks every rule for every element, so the page is cut to its first 300 elements first.
    await evaluate('for (const el of [...document.body.children].slice(300)) el.remove(); document.body.children.length');
    // The page loads the counter itself, from its file.
    await call(
      (src) =>
        new Promise((resolve, reject) => {
          const el = document.createElement('script');
          el.src = src;
          el.onload = () => resolve(true);
          el.onerror = () => reject(new Error(`could not load ${src}`));
          document.head.append(el);
        }),
      pathToFileURL(scriptFile).href,
    );
    const value = await evaluate(
      `(() => { const report = purserStrikeCount(); return { count: report.count, rules: report.rules, skipped: report.skipped.length, elements: document.body.children.length, sample: report.struck.slice(0, 3).map((s) => s.property + ' <- ' + s.sources.join(' | ')) }; })()`,
    );
    ws.close();
    return value;
  } finally {
    proc.kill();
    await sleep(100);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
