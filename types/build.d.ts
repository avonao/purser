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
  /**
   * With names "min": give classes that are applied together one class, so every element carries fewer.
   * - `'exact'`: classes that never appear without each other. Every rule is still written once.
   * - `'balanced'`: also a class for two classes that often appear together, where they do.
   * - `'max'`: one class for every group of classes a `css.props` call applies.
   *
   * The build plans the classes from every compiled module, so the modules must be compiled against this build's
   * names (a bundler plugin does that; a compiler in another process reads them through `namesFile`). `watch` never
   * fuses: one changed file would change the classes of modules that are not compiled again.
   */
  fuse?: false | 'exact' | 'balanced' | 'max';
  /** With names "min": a JSON file that keeps the names between builds, relative to projectDir. */
  namesFile?: string;
  /** Also work out what every module compiles to, for a compiler that is given this builder's `record`. */
  modules?: boolean;
  /** With names "min": a registry shared with a compiler (see `@avonao/purser/compiler`). */
  registry?: NameRegistry;
  /**
   * `false`: no extraction cache on disk. A string: its directory. Default: `node_modules/.cache/purser`; for a project
   * without a `node_modules` of its own, a directory named after its path in the nearest one further up, else in the
   * user's cache directory.
   */
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
  /** Classes written to the stylesheet. */
  atoms: number;
  rules: number;
  keyframes: number;
  tokens: number;
  /** With `fuse`: what the plan did. */
  fused?: {
    level: 'exact' | 'balanced' | 'max';
    /** Groups of classes that are applied whole. */
    contexts: number;
    /** Classes before fusion. */
    ids: number;
    /** Classes after fusion. */
    classes: number;
    /** Class names the compiled modules carry, over all groups. */
    references: number;
    /** Selectors the classes need in the stylesheet (equal to `ids` when no rule is written under two names). */
    selectors: number;
  };
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

/** Which names every group of classes is written as, when the build fused classes. */
export interface FusionPlan {
  level: 'exact' | 'balanced' | 'max';
  covers: Map<string, string[]>;
}

/** The names given with `names: 'min'`: append-only, the most used class first. */
export interface NameRegistry {
  readonly prefix: string;
  /** The name of a class, giving it the next free one when it has none. */
  get(id: string): string;
  /** The names a group of classes that is applied whole is written as (with a plan: a group the build has seen). */
  resolve(ids: string[]): string[];
  /** The fusion plan of the last build, or null. */
  readonly plan: FusionPlan | null;
  setPlan(plan: FusionPlan | null): void;
  has(id: string): boolean;
  /** Name every class without a name, the most used first. */
  assign(uses: Map<string, number>): void;
  readonly version: number | string;
  readonly size: number;
  toJSON(): Record<string, string>;
}

/**
 * What a module compiles to before its classes have their final names: plain data (it can be stored and sent to
 * another thread). See `createBuilder().record` and `CompilerOptions.records`.
 */
export interface ModuleRecord {
  edits: { start: number; end: number; text: string }[];
  sites: { start: number; end: number; guards: { text: string; simple: boolean; top: boolean }[]; always: string[]; groups: [string, string[]][] }[];
  maps: { start: number; end: number; styles: Record<string, Record<string, string | null>> }[];
  stats: { create: number; folded: number; dynamic: number; keyframes: number; globals: number; tokens: number };
}

/**
 * Build once and write `out` (only when its content changed). A build whose source files, tokens, options and outputs
 * are exactly those of the last one answers from the record that build left in the cache directory, without parsing
 * or compiling anything (`cache: false` turns that off).
 */
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
  /** The level classes are fused at, or false. */
  fuse: false | 'exact' | 'balanced' | 'max';
  /**
   * What a module compiles to, when the last run worked it out for exactly this content (`modules: true` or `fuse`).
   * Null: nothing to compile. Undefined: not known; the compiler parses the module itself.
   * @param file absolute path
   * @param hash the content hash the builder uses (SHA-1, base64url, 22 characters)
   */
  record(file: string, hash: string): ModuleRecord | null | undefined;
};
