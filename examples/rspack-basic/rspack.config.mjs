// App-level rspack config — merged into markopack's generated browser
// config (module.rules concatenate with the generated ones). Preprocessors
// live here instead of markopack's defaults: install the toolchain you use
// (here: sass + sass-loader) and add its rule.
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
