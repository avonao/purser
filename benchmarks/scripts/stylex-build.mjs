// StyleX stylesheet for a project: every source file goes through the Babel plugin, then the collected rules are written.
import fs from 'node:fs';
import path from 'node:path';
import { transformAsync } from '@babel/core';
import stylexPlugin from '@stylexjs/babel-plugin';

const dir = path.resolve(process.argv[2]);

export function babelOptions(file, root) {
  return {
    filename: file,
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
    plugins: [
      '@babel/plugin-syntax-jsx',
      [stylexPlugin, { dev: false, runtimeInjection: false, treeshakeCompensation: true, unstable_moduleResolution: { type: 'commonJS', rootDir: root } }],
    ],
  };
}

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p);
    } else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
};
walk(path.join(dir, 'components'));
walk(path.join(dir, 'lib'));
const rules = [];
for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  if (!code.includes('@stylexjs/stylex')) continue;
  const result = await transformAsync(code, babelOptions(file, dir));
  if (result.metadata?.stylex) rules.push(...result.metadata.stylex);
}
fs.writeFileSync(path.join(dir, 'out.css'), stylexPlugin.processStylexRules(rules, { useLayers: true }));
