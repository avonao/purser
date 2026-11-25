// Run in its own process: load a bundle, time the load (module evaluation, which is where runtime style work happens)
// and time class-name resolution for the page.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const [bundle, pageFile, mode] = process.argv.slice(2);
const page = JSON.parse(fs.readFileSync(pageFile, 'utf8'));
const t0 = performance.now();
const mod = await import(pathToFileURL(bundle).href);
const load = performance.now() - t0;
const props = page.map((e) => Object.fromEntries(e.variants.map((v) => [v, true])));
const fns = page.map((e) => mod.classes[e.component]);
if (mode === 'html') {
  const out = [];
  for (let i = 0; i < page.length; i++) out.push(fns[i](props[i]));
  process.stdout.write(JSON.stringify({ load, classes: out }));
} else {
  let sink = 0;
  const warm = () => {
    for (let i = 0; i < page.length; i++) sink += fns[i](props[i]).length;
  };
  for (let i = 0; i < 20; i++) warm();
  const rounds = Math.max(1, Math.round(400000 / page.length));
  const t1 = performance.now();
  for (let r = 0; r < rounds; r++) warm();
  const ms = performance.now() - t1;
  process.stdout.write(JSON.stringify({ load, opsPerSec: Math.round((rounds * page.length) / (ms / 1000)), sink }));
}
