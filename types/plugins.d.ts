// Type declarations for the bundler integrations: @avonao/purser/vite, /rollup, /esbuild and /webpack.

import type { CompilerOptions } from './compiler';

export interface PluginOptions extends CompilerOptions {
  /** Source directories or files, relative to projectDir. With `out`, the plugin also writes the stylesheet. */
  src?: string[];
  /** The stylesheet to write, relative to projectDir. */
  out?: string;
  /** Minify the stylesheet (default: in a production build). */
  minify?: boolean;
  /**
   * With names "min": give classes that are applied together one class (see `BuildOptions.fuse`). Used in a build
   * that compiles every module once; a dev server or a watching build keeps one name per class.
   */
  fuse?: false | 'exact' | 'balanced' | 'max';
  /** With names "min": a JSON file that keeps the names between builds (and shares them with another process). */
  namesFile?: string;
  /** Names of the cascade layers. */
  layers?: { tokens?: string; globals?: string; overrides?: string; atoms?: string };
  /** `false`: do not compile modules, only write the stylesheet. */
  compile?: boolean;
}

/** Vite plugin (also a Rollup plugin). */
export declare function purser(options?: PluginOptions): {
  name: 'purser';
  enforce: 'pre';
  [hook: string]: unknown;
};

/** esbuild plugin. */
export declare function purserEsbuild(options?: PluginOptions): { name: 'purser'; setup(build: unknown): void };

/** webpack plugin: writes the stylesheet before every compilation and adds the loader that compiles modules. */
export declare class PurserWebpackPlugin {
  constructor(options?: PluginOptions);
  apply(compiler: unknown): void;
}

declare const plugin: typeof purser & typeof purserEsbuild & typeof PurserWebpackPlugin;
export default plugin;
