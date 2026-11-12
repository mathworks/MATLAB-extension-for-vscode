'use strict';
const path = require('path');

const commonConfig = {
  target: 'web',
  mode: 'development',
  devtool: 'source-map',
  output: {
    devtoolModuleFilenameTemplate: info => path.relative(path.resolve(__dirname, 'out'), info.absoluteResourcePath).replace(/\\/g, '/'),
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
};

module.exports = [
  {
    ...commonConfig,
    entry: './src/workspacebrowser/webview-main.ts',
    output: {
      ...commonConfig.output,
      filename: 'bundle.js',
      path: path.resolve(__dirname, 'out'),
    },
  },
  {
    ...commonConfig,
    entry: './src/variableviewer/webview-main.ts',
    output: {
      ...commonConfig.output,
      filename: 'vv-bundle.js',
      path: path.resolve(__dirname, 'out'),
    },
  },
];
