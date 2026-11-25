// webpack loader (also for Rspack, and for Turbopack through its loader support): compile Purser styles.
//
//   // webpack.config.js
//   module: { rules: [{ test: /\.[cm]?[jt]sx?$/, exclude: /node_modules/, enforce: 'pre', use: [{ loader: '@avonao/purser/webpack-loader', options: { tokens: 'lib/tokens.ts' } }] }] }
//
//   // next.config.ts (Turbopack)
//   turbopack: { rules: { '*.{ts,tsx,js,jsx}': { loaders: [{ loader: '@avonao/purser/webpack-loader', options: { tokens: 'lib/tokens.ts' } }] } } }
//
// The loader compiles modules; the stylesheet is written by `purser build`, by PurserWebpackPlugin
// (@avonao/purser/webpack) or by another plugin. With names "min" give it the same `namesFile` as that build.
//
// CommonJS on purpose: every loader runner can require it. The compiler itself is an ES module, loaded once.

const compilers = new Map();

function compilerFor(options, context) {
  const key = JSON.stringify([options, context]);
  if (!compilers.has(key)) {
    compilers.set(
      key,
      import('./shared.js').then(({ createPluginCore }) => createPluginCore({ ...options, src: undefined, out: undefined, waitForNames: undefined }, { projectDir: context }).compiler),
    );
  }
  return compilers.get(key);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Beside a watching stylesheet build (a dev server), a module with a new style can reach the loader before the build
 * has given the style's classes their names. The loader then waits for the names file instead of failing:
 * `waitForNames` milliseconds at most (default: 5000 under NODE_ENV=development, else 0, because a build that runs
 * after `purser build` has every name).
 */
async function transformWhenNamed(compiler, source, file, waitMs) {
  for (const deadline = Date.now() + waitMs; ; ) {
    try {
      return await compiler.transform(source, file);
    } catch (err) {
      if (!err || err.code !== 'PURSER_NAME_MISSING' || Date.now() >= deadline) throw err;
      await sleep(40);
    }
  }
}

module.exports = function purserLoader(source, inputMap) {
  const callback = this.async();
  const options = (typeof this.getOptions === 'function' ? this.getOptions() : this.query) || {};
  if (typeof source !== 'string' || !source.includes(options.packageName || '@avonao/purser') && !options.cssModule) {
    callback(null, source, inputMap);
    return;
  }
  const waitMs = typeof options.waitForNames === 'number' ? options.waitForNames : process.env.NODE_ENV === 'development' ? 5000 : 0;
  compilerFor(options, options.projectDir || this.rootContext || process.cwd())
    .then((compiler) => {
      // With names "min" the result depends on the names the build keeps (and, fused, on its plan): a bundler that
      // keeps compiled modules between builds must compile this one again when names are given anew or the plan
      // changes. A class that is added changes neither.
      if (compiler && compiler.registry && compiler.registry.files && typeof this.addDependency === 'function') {
        for (const file of compiler.registry.files) this.addDependency(file);
      }
      return compiler ? transformWhenNamed(compiler, source, this.resourcePath, waitMs) : null;
    })
    .then((result) => {
      // A map from an earlier loader would need composing; Purser runs first (enforce: 'pre'), so there is none to keep.
      if (result) callback(null, result.code, inputMap ? undefined : result.map);
      else callback(null, source, inputMap);
    })
    .catch((err) => callback(err));
};
