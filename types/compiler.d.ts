// Type declarations for @avonao/purser/compiler.

import type { ModuleRecord, NameRegistry } from './build';

export interface CompilerOptions {
  /** Project root (default: the working directory). */
  projectDir?: string;
  /** Module exporting the defineTokens() result, relative to projectDir. */
  tokens?: string;
  /** Naming options; they must match the build that writes the stylesheet. */
  prefix?: string;
  salt?: string;
  names?: 'legacy' | 'short' | 'min';
  granularity?: 'property' | 'rule';
  /** Import specifier of the runtime (default "@avonao/purser"). */
  packageName?: string;
  /** Module exporting a custom `css = createCss({ … })`, relative to projectDir. */
  cssModule?: string;
  /** With names "min": the registry of the build that writes the stylesheet (it also holds which classes were fused). */
  registry?: NameRegistry;
  /**
   * What the stylesheet build already worked out for a module with this content: pass a builder's `record`, and the
   * compiler writes such a module without parsing it again.
   */
  records?: (file: string, hash: string) => ModuleRecord | null | undefined;
}

export interface CompileStats {
  /** css.create calls compiled. */
  create: number;
  /** css.props calls turned into a string expression. */
  folded: number;
  /** css.props calls left to the runtime merge. */
  dynamic: number;
  keyframes: number;
  globals: number;
  tokens: number;
}

/** A source map (version 3) with one segment per line: a compiled module keeps its line numbers. */
export interface CompileMap {
  version: 3;
  file: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

export interface CompileResult {
  code: string;
  map: CompileMap;
  stats: CompileStats;
}

export interface Compiler {
  /**
   * Compile one module. Null: nothing to compile (or an error the stylesheet build reports); keep the module as it is.
   * With fused classes it rejects for a module that applies a group of classes the build has not seen (a module outside
   * its source directories, or one that changed after the build).
   */
  transform(code: string, file: string): Promise<CompileResult | null>;
  /** A cheap test a bundler can run on every module before reading it as a Purser module. */
  accepts(code: string, file: string): boolean;
  projectDir: string;
  tokensFile: string | null;
  packageName: string;
  registry: NameRegistry | null;
}

export declare function createCompiler(options?: CompilerOptions): Compiler;
