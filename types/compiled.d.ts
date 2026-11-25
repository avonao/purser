// Type declarations for @avonao/purser/compiled: what compiled modules import. Application code never needs it.

import type { CompiledStyle, StyleArg } from './index';

/** css.props: merge styles left to right (later wins per property) into a class string. */
export declare function props(...styles: StyleArg[]): string;

/** Mark precompiled class maps (style name → merge key → class names) as styles, the way css.create does. */
export declare function styles<K extends string>(maps: Record<K, Record<string, string | null>>): { readonly [P in K]: CompiledStyle };
