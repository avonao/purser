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
  /**
   * Class names: "legacy" (default: prefix + 7 characters), "short" (4 characters) or "min" (the shortest there are,
   * most used first; the modules must then be compiled). Must match createCss({ names }).
   */
  names?: 'legacy' | 'short' | 'min';
  /** One class per property of a style (default) or one per generated rule. Must match createCss({ granularity }). */
  granularity?: 'property' | 'rule';
  /** Write the stylesheet without whitespace and merge rules that write the same declaration. */
  minify?: boolean;
  /** With names "min": a JSON file that keeps the names between builds, relative to projectDir. */
  namesFile?: string;
  /** With names "min": a registry shared with a compiler (see `@avonao/purser/compiler`). */
  registry?: NameRegistry;
  /** `false`: no extraction cache on disk. A string: its directory (default `node_modules/.cache/purser`). */
  cache?: boolean | string;
  /** Worker threads for parsing (default: the processors minus one from four processors on, at most 8; 0: none). */
  threads?: number;
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
  /** With names "min": the minimal name of every class, by its legacy name. */
  names: Record<string, string> | null;
}

/** The names given with `names: 'min'`: append-only, the most used class first. */
export interface NameRegistry {
  readonly prefix: string;
  /** The name of a class, giving it the next free one when it has none. */
  get(id: string): string;
  has(id: string): boolean;
  /** Name every class without a name, the most used first. */
  assign(uses: Map<string, number>): void;
  readonly version: number | string;
  readonly size: number;
  toJSON(): Record<string, string>;
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
  /** With names "min": the registry the builder fills. */
  registry: NameRegistry | null;
};
