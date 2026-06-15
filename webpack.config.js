'use strict';
const path = require('path');

module.exports = {
  target: 'web',
  mode: 'development', // production or 'development' for non-minified output
  entry: './src/workspacebrowser/webview-main.ts', // Workspace browser webview entry point
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'out'),
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
