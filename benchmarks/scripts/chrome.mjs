// Headless Chrome over the DevTools protocol (no dependency): load a page, evaluate a script, return its value.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(chrome, htmlFile, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purser-bench-chrome-'));
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--window-size=1280,900', 'about:blank'], {
    stdio: 'ignore',
  });
  try {
    let port = null;
    for (let i = 0; i < 100 && !port; i++) {
      try {
        port = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      } catch {
        await sleep(100);
      }
    }
    if (!port) throw new Error('Chrome did not start');
    const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
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
    // The counter walks every rule for every element, so the page is cut to its first 300 elements first.
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page script failed: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
      return r.result.value;
    };
    await evaluate('for (const el of [...document.body.children].slice(300)) el.remove(); document.body.children.length');
    await evaluate(`${script}\n;0`); // installs purserStrikeCount()
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
