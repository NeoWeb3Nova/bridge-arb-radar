'use strict';
const wormhole = require('./wormhole');
const layerzero = require('./layerzero');
const axelar = require('./axelar');
const hyperlane = require('./hyperlane');
const range = require('./range');
const blockscan = require('./blockscan');

const ALL = [wormhole, layerzero, axelar, hyperlane, range, blockscan];

function enabled(settings) {
  const map = settings.sources || {};
  return ALL.filter((s) => (map[s.id] ? map[s.id].enabled !== false : true));
}

module.exports = { ALL, enabled, wormhole, layerzero, axelar, hyperlane, range, blockscan };
