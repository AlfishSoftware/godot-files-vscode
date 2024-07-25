let repo = '../';
/** @type import('webpack').Configuration */ const config = {
  mode: 'development', // leave source code close to the original (when packaging we set this to 'production')
  target: 'webworker', // extensions run in a webworker context
  entry: {
    extension: './src/ExtensionEntry.ts', // source of the web extension main file
  },
  output: {
    filename: 'extension.js',
    path: __dirname + '/dist@web/',
    libraryTarget: 'commonjs',
    devtoolModuleFilenameTemplate: info => {
      const resourcePath = `${info.resourcePath}`.replace(/^\.\//, '');
      if (/^ignored\|/i.test(resourcePath)) return `webpack://${info.namespace}/gen/ignored-${info.hash}.js`;
      const m = /^external (\w+) "(.*?)"$/i.exec(resourcePath);
      if (m) return `webpack://${info.namespace}/gen/external-${m[1]}-${m[2]}.js`;
      const root = /^webpack\//i.test(resourcePath) ? `webpack://${info.namespace}/` : repo;
      return root + (/\.[jt]s$/i.test(resourcePath) ? resourcePath : resourcePath + '.js');
    },
  },
  optimization: {
    minimize: false,
    moduleIds: 'named',
    chunkIds: 'named',
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
module.exports = (env, argv) => {
  if (argv.mode == 'production') {
    config.devtool = 'source-map'; // include full source files in the source maps
    // make source map links that point to files in the online repo
    const pkg = require('./package.json');
    repo = `${pkg.repository.url}/raw/v${pkg.version}/`;
  }
  return config;
};
