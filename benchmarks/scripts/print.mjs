// Print a results file as a table (for the terminal).
import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify(r.corpus), r.machine.cores, 'cores');
const pad = (v, n) => String(v).padStart(n);
console.log('tool'.padEnd(30), 'cold', ' warm', ' css.min', ' css.br', '  js.min', ' js.br', ' load ms', '  names/s', ' cls/el', ' html.br', ' total.br', ' struck');
for (const x of r.results) {
  if (x.error) {
    console.log(x.label.padEnd(30), 'ERROR', x.error.split('\n')[0].slice(0, 120));
    continue;
  }
  console.log(x.label.padEnd(30), pad(x.build.coldMs, 4), pad(x.build.warmMs, 5), pad(x.css.bytes, 8), pad(x.css.brotli, 7), pad(x.js.bytes, 8), pad(x.js.brotli, 6), pad(x.runtime.loadMs, 8), pad(x.runtime.classNamesPerSec, 9), pad(x.html.perElement, 7), pad(x.html.brotli, 8), pad(x.total.brotli, 9), pad(x.struck?.count ?? '-', 7));
}
