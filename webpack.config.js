/** @type import('webpack').Configuration */ module.exports = {
  mode: 'none', // leave source code as close as possible to the original (when packaging we set this to 'production')
  target: 'webworker', // extensions run in a webworker context
  entry: {
    extension: './src/ExtensionEntry.ts', // source of the web extension main file
  },
  output: {
    filename: 'extension.js',
    path: __dirname + '/dist@web/',
    libraryTarget: 'commonjs',
    devtoolModuleFilenameTemplate: '../[resource-path]',
  },
  resolve: {
    mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
    extensions: ['.ts', '.js'], // support ts-files and js-files
    alias: {
      // provides alternate implementation for node module and source files
      [__dirname + '/src/+cross']: __dirname + '/src/@web/+cross/',
      [__dirname + '/src/@pc']: false,
    },
    fallback: { // Available polyfills: https://webpack.js.org/configuration/resolve/#resolvefallback
      // Should give error if trying to use any of these
      //fs: false,
      //crypto: false,
      //os: false,
      //'dns/promises': false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /\bnode_modules\b/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: __dirname + '/src/@web/tsconfig.json'
            }
          },
        ],
      },
    ],
  },
  plugins: [
  ],
  externals: {
    vscode: 'commonjs vscode', // leave it as require vscode
  },
  performance: {
    hints: false,
  },
  devtool: 'nosources-source-map', // create a source map that points to the original source file
};
