# Benchmarks

One design system, generated from a seed, written out for each tool in that tool's own idiom and built with it. The numbers answer three questions: how much is sent to a browser, what the browser has to do with it, and how long the build takes.

Everything here can be run again: the generator, the emitters and the runner are in [`benchmarks/`](../benchmarks/README.md), and this page is written from the result files by `benchmarks/scripts/report.mjs`. Sizes are in kB (1,000 bytes) after Brotli at quality 11; the best value of a column is in bold.

Measured on 2026-11-25 with Node v22.23.4 on 2 cores (Intel(R) Xeon(R) Processor, linux x64). Purser is this repository at the commit that carries the result files; the others are StyleX 0.19.2, Tailwind CSS 4.3.5 (with tailwind-merge 3.7.1 in its second row), UnoCSS 66.13.0 (preset-wind4), Panda CSS 2.6.0 and vanilla-extract 1.21.3.

## 500 components

The main run. 1,747 styles with 13,920 declarations (conditional values counted once per condition); the page has 2,000 elements; build times are the median of 5 runs.

### What is sent

| | Stylesheet | JavaScript | Markup | **Total** | Classes per element | Declarations struck |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Purser (compiled, fuse: exact) | 7.32 | 25.1 | 22.0 | 54.4 | 16.9 | **0** |
| Purser (compiled, fuse: max) | 25.5 | 11.7 | 10.9 | **48.1** | 3.8 | **0** |
| Purser (compiled, not fused) | 9.33 | 29.6 | 26.4 | 65.4 | 26.7 | **0** |
| Purser (runtime only) | 27.7 | 43.7 | 36.6 | 108.0 | 20.8 | **0** |
| StyleX | 7.08 | 49.6 | 31.7 | 88.3 | 17.1 | 1,161 |
| Tailwind CSS | 3.92 | 33.6 | 28.9 | 66.4 | 19.6 | 1,928 |
| Tailwind CSS + tailwind-merge | 3.92 | 43.0 | 32.0 | 78.9 | 17.6 | 1,545 |
| UnoCSS | 4.68 | 33.6 | 28.9 | 67.2 | 19.6 | 2,676 |
| Panda CSS | **3.68** | 39.0 | 32.2 | 74.8 | 17.1 | 469 |
| vanilla-extract | 41.7 | **10.9** | **9.14** | 61.8 | **1.9** | 1,801 |

### What it costs

| | Build from nothing | Nothing changed | One file changed | Module load | Class names per second |
| --- | ---: | ---: | ---: | ---: | ---: |
| Purser (compiled, fuse: exact) | 889 ms | **54 ms** | 415 ms | 2.21 ms | 7.2 million |
| Purser (compiled, fuse: max) | 966 ms | 61 ms | 455 ms | **2.11 ms** | 7.2 million |
| Purser (compiled, not fused) | 686 ms | 63 ms | 405 ms | 3.17 ms | 8.5 million |
| Purser (runtime only) | 765 ms | 64 ms | 389 ms | 117.30 ms | 183 thousand |
| StyleX | 22,043 ms | 22,148 ms | 22,497 ms | 3.51 ms | 2.6 million |
| Tailwind CSS | 220 ms | 223 ms | 214 ms | 4.73 ms | 9.0 million |
| Tailwind CSS + tailwind-merge | 225 ms | 221 ms | 230 ms | 7.70 ms | 118 thousand |
| UnoCSS | 678 ms | 658 ms | 704 ms | 4.06 ms | 9.6 million |
| Panda CSS | **164 ms** | 160 ms | **166 ms** | 28.90 ms | 38 thousand |
| vanilla-extract | 2,201 ms | 2,136 ms | 2,085 ms | 3.87 ms | **9.7 million** |

- **Bytes sent.** Purser with `fuse: 'exact'` sends 54.4 kB in total, 12% less than the smallest of the other tools (vanilla-extract, 61.8 kB); with `fuse: 'max'` it is 48.1 kB, 22% less. StyleX: 88.3 kB, Tailwind CSS: 66.4 kB, Tailwind CSS + tailwind-merge: 78.9 kB, UnoCSS: 67.2 kB, Panda CSS: 74.8 kB, vanilla-extract: 61.8 kB.
- **The stylesheet alone** is smaller with StyleX (7.08 kB), Tailwind CSS (3.92 kB), Tailwind CSS + tailwind-merge (3.92 kB), UnoCSS (4.68 kB), Panda CSS (3.68 kB) than with Purser (7.32 kB). Purser's rules carry the conditions that keep them from overlapping (`:not(:hover)` on the rule for the state that is not hovered), and a rule for each distinct condition. What those tools save there, they spend, and more, on class names in the modules and the markup.
- **Overridden declarations.** On the generated page a browser strikes through none of Purser's declarations. For the others it is 1,161 (StyleX), 1,928 (Tailwind CSS), 1,545 (Tailwind CSS + tailwind-merge), 2,676 (UnoCSS), 469 (Panda CSS), 1,801 (vanilla-extract): each is a declaration that was sent, parsed and matched, and lost to another one.
- **Build from nothing.** Tailwind CSS (220 ms), Tailwind CSS + tailwind-merge (225 ms), UnoCSS (678 ms), Panda CSS (164 ms) are faster than Purser (889 ms): Purser parses every module with the TypeScript parser and evaluates its styles, which is what lets it prove its rules and compile the modules; StyleX (22,043 ms), vanilla-extract (2,201 ms) take longer.
- **Build again.** With nothing changed Purser answers in 54 ms (the next is Panda CSS with 160 ms); after one file changed it takes 415 ms (Panda CSS: 166 ms).
- **In the browser.** The compiled modules load in 2.21 ms (StyleX: 3.51 ms) and resolve 7.2 million class lists a second (StyleX: 2.6 million, Tailwind CSS: 9.0 million, Tailwind CSS + tailwind-merge: 118 thousand, UnoCSS: 9.6 million, Panda CSS: 38 thousand, vanilla-extract: 9.7 million).

## 100 components

A small project. 355 styles with 2,789 declarations (conditional values counted once per condition); the page has 2,000 elements; build times are the median of 5 runs.

### What is sent

| | Stylesheet | JavaScript | Markup | **Total** | Classes per element | Declarations struck |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Purser (compiled, fuse: exact) | 4.01 | 5.28 | 10.4 | 19.7 | 15.8 | **0** |
| Purser (compiled, fuse: max) | 7.30 | **2.52** | 7.18 | **17.0** | 3.8 | **0** |
| Purser (compiled, not fused) | 4.86 | 6.68 | 12.2 | 23.8 | 26.2 | **0** |
| Purser (runtime only) | 9.30 | 15.1 | 17.1 | 41.5 | 20.6 | **0** |
| StyleX | 4.17 | 11.4 | 15.3 | 30.9 | 16.6 | 1,098 |
| Tailwind CSS | 2.89 | 7.92 | 14.8 | 25.6 | 19.3 | 1,958 |
| Tailwind CSS + tailwind-merge | 2.89 | 15.9 | 15.7 | 34.5 | 17.1 | 1,516 |
| UnoCSS | 3.35 | 7.92 | 14.8 | 26.1 | 19.3 | 2,693 |
| Panda CSS | **2.60** | 11.2 | 17.0 | 30.8 | 16.7 | 416 |
| vanilla-extract | 9.58 | 2.57 | **6.32** | 18.5 | **1.9** | 1,824 |

### What it costs

| | Build from nothing | Nothing changed | One file changed | Module load | Class names per second |
| --- | ---: | ---: | ---: | ---: | ---: |
| Purser (compiled, fuse: exact) | 387 ms | 47 ms | 211 ms | **0.73 ms** | 6.7 million |
| Purser (compiled, fuse: max) | 406 ms | 50 ms | 246 ms | 0.92 ms | 6.4 million |
| Purser (compiled, not fused) | 357 ms | 50 ms | 221 ms | 0.88 ms | 6.5 million |
| Purser (runtime only) | 321 ms | **44 ms** | 188 ms | 27.23 ms | 203 thousand |
| StyleX | 4,559 ms | 4,581 ms | 4,664 ms | 0.98 ms | 3.5 million |
| Tailwind CSS | 195 ms | 187 ms | 191 ms | 1.11 ms | **7.8 million** |
| Tailwind CSS + tailwind-merge | 184 ms | 192 ms | 198 ms | 3.00 ms | 777 thousand |
| UnoCSS | 440 ms | 430 ms | 427 ms | 1.07 ms | 6.2 million |
| Panda CSS | **124 ms** | 120 ms | **119 ms** | 7.16 ms | 95 thousand |
| vanilla-extract | 758 ms | 700 ms | 716 ms | 1.27 ms | 6.7 million |

- **Bytes sent.** Purser with `fuse: 'exact'` sends 19.7 kB in total, 7% more than the smallest of the other tools (vanilla-extract, 18.5 kB); with `fuse: 'max'` it is 17.0 kB, 8% less. StyleX: 30.9 kB, Tailwind CSS: 25.6 kB, Tailwind CSS + tailwind-merge: 34.5 kB, UnoCSS: 26.1 kB, Panda CSS: 30.8 kB, vanilla-extract: 18.5 kB.
- **The stylesheet alone** is smaller with Tailwind CSS (2.89 kB), Tailwind CSS + tailwind-merge (2.89 kB), UnoCSS (3.35 kB), Panda CSS (2.60 kB) than with Purser (4.01 kB). Purser's rules carry the conditions that keep them from overlapping (`:not(:hover)` on the rule for the state that is not hovered), and a rule for each distinct condition. What those tools save there, they spend, and more, on class names in the modules and the markup.
- **Overridden declarations.** On the generated page a browser strikes through none of Purser's declarations. For the others it is 1,098 (StyleX), 1,958 (Tailwind CSS), 1,516 (Tailwind CSS + tailwind-merge), 2,693 (UnoCSS), 416 (Panda CSS), 1,824 (vanilla-extract): each is a declaration that was sent, parsed and matched, and lost to another one.
- **Build from nothing.** Tailwind CSS (195 ms), Tailwind CSS + tailwind-merge (184 ms), Panda CSS (124 ms) are faster than Purser (387 ms): Purser parses every module with the TypeScript parser and evaluates its styles, which is what lets it prove its rules and compile the modules; StyleX (4,559 ms), UnoCSS (440 ms), vanilla-extract (758 ms) take longer.
- **Build again.** With nothing changed Purser answers in 47 ms (the next is Panda CSS with 120 ms); after one file changed it takes 211 ms (Panda CSS: 119 ms).
- **In the browser.** The compiled modules load in 0.73 ms (StyleX: 0.98 ms) and resolve 6.7 million class lists a second (StyleX: 3.5 million, Tailwind CSS: 7.8 million, Tailwind CSS + tailwind-merge: 777 thousand, UnoCSS: 6.2 million, Panda CSS: 95 thousand, vanilla-extract: 6.7 million).

## 2,000 components

A large project. StyleX and vanilla-extract are left out of this run: one build of theirs takes minutes at this size, and every tool is built ten times. 7,016 styles with 56,109 declarations (conditional values counted once per condition); the page has 2,000 elements; build times are the median of 3 runs.

### What is sent

| | Stylesheet | JavaScript | Markup | **Total** | Classes per element | Declarations struck |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Purser (compiled, fuse: exact) | 11.5 | 97.2 | 35.5 | **144.2** | 17 | **0** |
| Purser (compiled, fuse: max) | 91.0 | **49.3** | **15.4** | 155.7 | **3.8** | **0** |
| Purser (compiled, not fused) | 15.5 | 109.9 | 42.6 | 167.9 | 26.5 | **0** |
| Purser (runtime only) | 68.9 | 144.5 | 56.0 | 269.4 | 20.6 | **0** |
| Tailwind CSS | 4.86 | 124.5 | 48.0 | 177.4 | 19.6 | 1,930 |
| Tailwind CSS + tailwind-merge | 4.86 | 139.7 | 48.2 | 192.7 | 17.5 | 1,464 |
| UnoCSS | 5.70 | 124.5 | 48.0 | 178.3 | 19.6 | 2,645 |
| Panda CSS | **4.59** | 136.9 | 48.4 | 189.9 | 17.1 | 418 |

### What it costs

| | Build from nothing | Nothing changed | One file changed | Module load | Class names per second |
| --- | ---: | ---: | ---: | ---: | ---: |
| Purser (compiled, fuse: exact) | 2,134 ms | **65 ms** | 866 ms | **6.94 ms** | 6.3 million |
| Purser (compiled, fuse: max) | 2,265 ms | 75 ms | 1,005 ms | 9.04 ms | 5.2 million |
| Purser (compiled, not fused) | 1,523 ms | 90 ms | 707 ms | 7.19 ms | 6.7 million |
| Purser (runtime only) | 1,647 ms | 79 ms | 705 ms | 352.82 ms | 176 thousand |
| Tailwind CSS | **244 ms** | 238 ms | **250 ms** | 17.32 ms | **6.8 million** |
| Tailwind CSS + tailwind-merge | 264 ms | 264 ms | 262 ms | 27.38 ms | 88 thousand |
| UnoCSS | 1,312 ms | 1,337 ms | 1,346 ms | 18.01 ms | 5.7 million |
| Panda CSS | 289 ms | 303 ms | 297 ms | 108.42 ms | 29 thousand |

- **Bytes sent.** Purser with `fuse: 'exact'` sends 144.2 kB in total, 19% less than the smallest of the other tools (Tailwind CSS, 177.4 kB); with `fuse: 'max'` it is 155.7 kB, 12% less. Tailwind CSS: 177.4 kB, Tailwind CSS + tailwind-merge: 192.7 kB, UnoCSS: 178.3 kB, Panda CSS: 189.9 kB.
- **The stylesheet alone** is smaller with Tailwind CSS (4.86 kB), Tailwind CSS + tailwind-merge (4.86 kB), UnoCSS (5.70 kB), Panda CSS (4.59 kB) than with Purser (11.5 kB). Purser's rules carry the conditions that keep them from overlapping (`:not(:hover)` on the rule for the state that is not hovered), and a rule for each distinct condition. What those tools save there, they spend, and more, on class names in the modules and the markup.
- **Overridden declarations.** On the generated page a browser strikes through none of Purser's declarations. For the others it is 1,930 (Tailwind CSS), 1,464 (Tailwind CSS + tailwind-merge), 2,645 (UnoCSS), 418 (Panda CSS): each is a declaration that was sent, parsed and matched, and lost to another one.
- **Build from nothing.** Tailwind CSS (244 ms), Tailwind CSS + tailwind-merge (264 ms), UnoCSS (1,312 ms), Panda CSS (289 ms) are faster than Purser (2,134 ms): Purser parses every module with the TypeScript parser and evaluates its styles, which is what lets it prove its rules and compile the modules.
- **Build again.** With nothing changed Purser answers in 65 ms (the next is Tailwind CSS with 238 ms); after one file changed it takes 866 ms (Tailwind CSS: 250 ms).
- **In the browser.** The compiled modules load in 6.94 ms (Tailwind CSS: 17.32 ms) and resolve 6.3 million class lists a second (Tailwind CSS: 6.8 million, Tailwind CSS + tailwind-merge: 88 thousand, UnoCSS: 5.7 million, Panda CSS: 29 thousand).

## 500 components, the stress corpus

Every condition is as likely on every property, so far more distinct rules exist than an interface has. 1,750 styles with 13,558 declarations (conditional values counted once per condition); the page has 2,000 elements; build times are the median of 3 runs.

### What is sent

| | Stylesheet | JavaScript | Markup | **Total** | Classes per element | Declarations struck |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Purser (compiled, fuse: exact) | 16.4 | 25.1 | 22.0 | 63.6 | 15.6 | **0** |
| Purser (compiled, fuse: max) | 33.8 | 11.2 | 10.7 | **55.7** | 3.7 | **0** |
| Purser (compiled, not fused) | 20.2 | 33.6 | 29.4 | 83.2 | 26.9 | **0** |
| Purser (runtime only) | 44.3 | 46.4 | 39.4 | 130.1 | 20.6 | **0** |
| StyleX | 10.8 | 51.7 | 33.7 | 96.2 | 16.6 | 571 |
| Tailwind CSS | 6.75 | 35.8 | 31.0 | 73.5 | 19.1 | 1,400 |
| Tailwind CSS + tailwind-merge | 6.75 | 45.3 | 34.3 | 86.3 | 17.2 | 969 |
| UnoCSS | 7.25 | 35.8 | 31.0 | 74.0 | 19.1 | 2,017 |
| Panda CSS | **6.05** | 41.5 | 34.3 | 81.8 | 16.7 | 251 |
| vanilla-extract | 42.3 | **10.8** | **9.11** | 62.3 | **1.9** | 1,244 |

### What it costs

| | Build from nothing | Nothing changed | One file changed | Module load | Class names per second |
| --- | ---: | ---: | ---: | ---: | ---: |
| Purser (compiled, fuse: exact) | 1,054 ms | 63 ms | 546 ms | 2.27 ms | 9.0 million |
| Purser (compiled, fuse: max) | 957 ms | **57 ms** | 466 ms | **1.78 ms** | 7.7 million |
| Purser (compiled, not fused) | 769 ms | 68 ms | 488 ms | 2.71 ms | 9.2 million |
| Purser (runtime only) | 734 ms | 59 ms | 396 ms | 105.60 ms | 193 thousand |
| StyleX | 9,821 ms | 9,611 ms | 9,885 ms | 3.09 ms | 3.0 million |
| Tailwind CSS | 222 ms | 223 ms | 219 ms | 4.10 ms | 10.2 million |
| Tailwind CSS + tailwind-merge | 230 ms | 222 ms | 241 ms | 7.09 ms | 116 thousand |
| UnoCSS | 705 ms | 735 ms | 721 ms | 4.72 ms | 10.3 million |
| Panda CSS | **184 ms** | 184 ms | **182 ms** | 33.35 ms | 35 thousand |
| vanilla-extract | 2,389 ms | 2,338 ms | 2,315 ms | 3.79 ms | **10.7 million** |

- **Bytes sent.** Purser with `fuse: 'exact'` sends 63.6 kB in total, 2% more than the smallest of the other tools (vanilla-extract, 62.3 kB); with `fuse: 'max'` it is 55.7 kB, 11% less. StyleX: 96.2 kB, Tailwind CSS: 73.5 kB, Tailwind CSS + tailwind-merge: 86.3 kB, UnoCSS: 74.0 kB, Panda CSS: 81.8 kB, vanilla-extract: 62.3 kB.
- **The stylesheet alone** is smaller with StyleX (10.8 kB), Tailwind CSS (6.75 kB), Tailwind CSS + tailwind-merge (6.75 kB), UnoCSS (7.25 kB), Panda CSS (6.05 kB) than with Purser (16.4 kB). Purser's rules carry the conditions that keep them from overlapping (`:not(:hover)` on the rule for the state that is not hovered), and a rule for each distinct condition. What those tools save there, they spend, and more, on class names in the modules and the markup.
- **Overridden declarations.** On the generated page a browser strikes through none of Purser's declarations. For the others it is 571 (StyleX), 1,400 (Tailwind CSS), 969 (Tailwind CSS + tailwind-merge), 2,017 (UnoCSS), 251 (Panda CSS), 1,244 (vanilla-extract): each is a declaration that was sent, parsed and matched, and lost to another one.
- **Build from nothing.** Tailwind CSS (222 ms), Tailwind CSS + tailwind-merge (230 ms), UnoCSS (705 ms), Panda CSS (184 ms) are faster than Purser (1,054 ms): Purser parses every module with the TypeScript parser and evaluates its styles, which is what lets it prove its rules and compile the modules; StyleX (9,821 ms), vanilla-extract (2,389 ms) take longer.
- **Build again.** With nothing changed Purser answers in 63 ms (the next is Panda CSS with 184 ms); after one file changed it takes 546 ms (Panda CSS: 182 ms).
- **In the browser.** The compiled modules load in 2.27 ms (StyleX: 3.09 ms) and resolve 9.0 million class lists a second (StyleX: 3.0 million, Tailwind CSS: 10.2 million, Tailwind CSS + tailwind-merge: 116 thousand, UnoCSS: 10.3 million, Panda CSS: 35 thousand, vanilla-extract: 10.7 million).

## What is measured

- **Stylesheet.** The tool's stylesheet for all components, then minified with Lightning CSS for the browsers Purser targets (the same minifier and targets for every tool, so no tool is measured with a better minifier than another), then compressed.
- **JavaScript.** One entry that exports, for every component, the function that returns its class list from its variant props, bundled and minified with esbuild, then compressed. React itself is left out; a class-merging helper a tool needs at run time (clsx, tailwind-merge, the StyleX and Panda runtimes) is in.
- **Markup.** A page of elements, each a component with a random set of its variants switched on, rendered to `<div class="…">` and compressed. Only the class attributes differ between tools.
- **Total.** The three together: what a first visit to that page downloads for styling.
- **Classes per element.** The average number of classes in a class attribute of that page.
- **Declarations struck.** The page in headless Chrome with the tool's stylesheet: the number of declarations that match an element and lose to another declaration of the same property on it (what DevTools strikes through), counted by [`scripts/strike-count.js`](../scripts/strike-count.js) in the page's resting state.
- **Build from nothing.** The tool's command that writes the stylesheet, in a new process, with no cache from an earlier run.
- **Nothing changed.** The same command again.
- **One file changed.** The same command after a comment was added to one component file.
- **Module load.** Importing the JavaScript bundle in Node: the time the styling code takes before the first render.
- **Class names per second.** Calling the class-list functions for the page's elements in a loop.

## The corpus

[`benchmarks/spec.mjs`](../benchmarks/spec.mjs) generates components from a seed. A component is a base style of 8 to 14 declarations and two or three variants of 3 to 5. Declarations are drawn from 25 properties with the frequencies an interface has (display, padding and colour often; z-index rarely), with values from a token scale (colours, spacing, radii, font sizes); 8% of the spacing values and half of the widths and heights are arbitrary pixel values instead. In the *interface* model a declaration gets the conditions its property gets in practice (hover and focus on colours, breakpoints on layout); in the *uniform* model every condition is as likely on every property. A variant sets some properties its base sets too, so applying it has to replace them.

Each emitter writes that description the way the tool's documentation does: `css.create` and `css.props` for Purser, `stylex.create` and `stylex.props` for StyleX, utility classes joined with clsx for Tailwind CSS and UnoCSS (and through `twMerge` in the tailwind-merge row, which is what makes a variant's override win), `css()` for Panda CSS, `.css.ts` files for vanilla-extract.

## What to keep in mind

- The corpus is generated, by the authors of one of the tools. It is neutral by construction (one description, six emitters) but it is not your application. The runner takes `--components`, `--model`, `--elements` and a seed in `spec.mjs`; the conclusions above held for every size and both models we ran, and where they did not hold the text says so.
- Purser's fused rows need its compiler (a bundler plugin). The row *Purser (runtime only)* is Purser without it.
- `fuse: 'max'` moves bytes from the modules and the markup into the stylesheet: the smallest total, and the largest stylesheet of the Purser rows. A site with many pages downloads the stylesheet once and the markup with every page.
- Build times are from a 2-core machine. Purser parses on worker threads from four cores on, which this machine does not have, so its build from nothing is measured on one thread.
- A tool that strikes a declaration is not wrong: the cascade decides, and the page looks as intended. The count is there because every struck declaration was sent and matched for nothing, and because where a declaration loses depends on the order of rules in a file that someone has to keep in mind.
