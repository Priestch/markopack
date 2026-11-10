// App-level rspack config (object form): merged into the browser config and,
// for the safe subset (`module`, `resolve`, `devtool`, `stats`), into the
// server config too — one rule serves SSR and hydration. Preprocessors live
// here instead of markopack's defaults: install the toolchain you use
// (here: sass + sass-loader) and add its rule. CSS rules are rewritten to
// asset/source on the server side, where CSS imports are strings.
/** @type {import("@rspack/core").Configuration} */
export default {
  module: {
    rules: [
      {
        // Marko <style.scss> blocks materialize as .scss virtual deps via
        // marko-loader's resolveVirtualDependency — compile them with the
        // app's sass, then the generated css pipeline extracts the output.
        test: /\.s[ac]ss$/,
        use: ["sass-loader"],
        type: "css",
      },
    ],
  },
};
