// The runtime with rule granularity: `import { css } from '@avonao/purser/rule'`.
//
// Same API as the main entry. It also carries the condition compiler (about 3 kB compressed), because the class of a
// rule is named after the rule and only compiling a property's conditions tells what its rules are. A module that the
// compiler compiles needs none of this: import from '@avonao/purser' there and set `granularity: 'rule'` on the plugin.

import { makeCreateCss } from './runtime.js';
import { atomClassNames } from './rules.js';

/** createCss that computes either granularity (what the build and the compiler use). */
export const createAnyCss = makeCreateCss(atomClassNames);

/**
 * Create a `css` API. Granularity is 'rule' unless set; the build needs `--granularity rule --package @avonao/purser/rule`.
 * @param {{ prefix?: string, salt?: string, names?: 'short' | 'legacy', granularity?: 'property' | 'rule' }} [options]
 */
export const createCss = (options) => createAnyCss({ granularity: 'rule', ...options });

/** The default `css` API with rule granularity (class prefix `x`, no salt). */
export const css = createCss();

export { defineTokens } from './tokens.js';
