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
      import('./shared.js').then(({ createPluginCore }) => createPluginCore({ ...options, src: undefined, out: undefined }, { projectDir: context }).compiler),
    );
  }
  return compilers.get(key);
}

module.exports = function purserLoader(source, inputMap) {
  const callback = this.async();
  const options = (typeof this.getOptions === 'function' ? this.getOptions() : this.query) || {};
  if (typeof source !== 'string' || !source.includes(options.packageName || '@avonao/purser') && !options.cssModule) {
    callback(null, source, inputMap);
    return;
  }
  compilerFor(options, options.projectDir || this.rootContext || process.cwd())
    .then((compiler) => {
      // With names "min" the result depends on the names the build keeps (and, fused, on its plan): a bundler that
      // caches compiled modules between builds must compile this one again when they change.
      if (compiler && compiler.registry && compiler.registry.files && typeof this.addDependency === 'function') {
        for (const file of compiler.registry.files) this.addDependency(file);
      }
      return compiler ? compiler.transform(source, this.resourcePath) : null;
    })
    .then((result) => {
      // A map from an earlier loader would need composing; Purser runs first (enforce: 'pre'), so there is none to keep.
      if (result) callback(null, result.code, inputMap ? undefined : result.map);
      else callback(null, source, inputMap);
    })
    .catch((err) => callback(err));
};
