// Type declarations for @avonao/purser/build.

export interface BuildOptions {
  /** Host project root; `typescript` and `postcss` resolve from here. */
  projectDir: string;
  /** Source directories or files, relative to projectDir. */
  src: string[];
  /** Module exporting the defineTokens() result, relative to projectDir. */
  tokens?: string;
  /** Output stylesheet, relative to projectDir. Omit to only validate. */
  out?: string;
  /** Class name prefix (default "x"); must match createCss({ prefix }). */
  prefix?: string;
  /** Hash salt (default ""); must match createCss({ salt }). */
  salt?: string;
  /** Import specifier of the runtime (default "@avonao/purser"). */
  packageName?: string;
  /** Module exporting a custom `css = createCss({ prefix, salt })`, relative to projectDir. */
  cssModule?: string;
  /**
   * Names of the cascade layers (default `purser.tokens`, `purser.globals`, `purser.overrides`, `purser.atoms`). Name
   * them when Purser joins existing CSS, so that the host can order its own layers between them. The overrides layer
   * is written only when a `css.globals(rules, { layer: 'overrides' })` call exists.
   */
  layers?: { tokens?: string; globals?: string; overrides?: string; atoms?: string };
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface BuildStats {
  files: number;
  atoms: number;
  rules: number;
  keyframes: number;
  tokens: number;
}

export interface BuildResult {
  /** The stylesheet, or null when there were errors. */
  css: string | null;
  diagnostics: Diagnostic[];
  stats: BuildStats | null;
  /** True when the output file changed on disk. */
  written: boolean;
  outFile: string | null;
}

/** Build once and write `out` (only when its content changed). */
export declare function build(options: BuildOptions): Promise<BuildResult>;
/** Validate without writing. */
export declare function check(options: Omit<BuildOptions, 'out'>): Promise<BuildResult>;
/** Build, then rebuild on every change to sources or the tokens module. */
export declare function watch(options: BuildOptions, onResult: (result: BuildResult) => void): Promise<{ close(): void }>;
/** A reusable builder with a per-file extraction cache. */
export declare function createBuilder(options: BuildOptions): {
  run(): Promise<BuildResult>;
  projectDir: string;
  tokensFile: string | null;
  outFile: string | null;
};
