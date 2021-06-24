const path = require('path');
const webpackDevBase = require('./../../../.webpack/webpack.dev.js');
const SRC_DIR = path.join(__dirname, '../src');
const DIST_DIR = path.join(__dirname, '../dist');

module.exports = (env, argv) => {
  return webpackDevBase(env, argv, { SRC_DIR, DIST_DIR });
};