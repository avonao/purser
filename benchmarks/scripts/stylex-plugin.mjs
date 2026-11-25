// esbuild plugin that compiles StyleX the way its bundler plugins do: Babel on every module that imports StyleX.
import fs from 'node:fs';
import { transformAsync } from '@babel/core';
import stylexPlugin from '@stylexjs/babel-plugin';

export function stylexEsbuild(root) {
  return {
    name: 'stylex',
    setup(build) {
      build.onLoad({ filter: /\.tsx?$/ }, async (args) => {
        if (args.path.includes('node_modules')) return undefined;
        const code = fs.readFileSync(args.path, 'utf8');
        if (!code.includes('@stylexjs/stylex')) return undefined;
        const out = await transformAsync(code, {
          filename: args.path,
          babelrc: false,
          configFile: false,
          presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
          plugins: [
            '@babel/plugin-syntax-jsx',
            [stylexPlugin, { dev: false, runtimeInjection: false, treeshakeCompensation: true, unstable_moduleResolution: { type: 'commonJS', rootDir: root } }],
          ],
        });
        return { contents: out.code, loader: 'jsx' };
      });
    },
  };
}
