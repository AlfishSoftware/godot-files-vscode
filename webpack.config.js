/** @type import('webpack').Configuration */ module.exports = {
  mode: 'none', // leave source code as close as possible to the original (when packaging we set this to 'production')
  target: 'webworker', // extensions run in a webworker context
  entry: {
    extension: './src/extension.ts', // source of the web extension main file
  },
  output: {
    filename: '[name].web.js',
    path: __dirname + '/dist',
    libraryTarget: 'commonjs',
    devtoolModuleFilenameTemplate: '../[resource-path]',
  },
  resolve: {
    mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
    extensions: ['.ts', '.js'], // support ts-files and js-files
    alias: {
      // provides alternate implementation for node module and source files
    },
    fallback: { // Available polyfills: https://webpack.js.org/configuration/resolve/#resolvefallback
      fs: false,
      crypto: false,
      os: false,
      'dns/promises': false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
          },
        ],
      },
    ],
  },
  plugins: [
    //new webpack.ProvidePlugin({
    //  process: 'process/browser', // provide a shim for the global `process` variable
    //}),
  ],
  externals: {
    vscode: 'commonjs vscode', // ignored because it doesn't exist
  },
  performance: {
    hints: false,
  },
  devtool: 'nosources-source-map', // create a source map that points to the original source file
};
