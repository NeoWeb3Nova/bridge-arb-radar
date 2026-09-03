'use strict';
// 链注册表：把各数据源各自的链标识统一映射到内部 chain key。
// key 内部主键；ds = DexScreener chainId；db = DeBank chain id；wh = Wormhole chain id；evm = EVM chain id。

const CHAINS = {
  ethereum:   { name: 'Ethereum',   ds: 'ethereum',   db: 'eth',    wh: 2,   evm: 1,      explorer: 'https://etherscan.io/tx/{tx}' },
  solana:     { name: 'Solana',     ds: 'solana',     db: 'sol',    wh: 1,   evm: null,   explorer: 'https://solscan.io/tx/{tx}' },
  bsc:        { name: 'BNB Chain',  ds: 'bsc',        db: 'bsc',    wh: 4,   evm: 56,     explorer: 'https://bscscan.com/tx/{tx}' },
  polygon:    { name: 'Polygon',    ds: 'polygon',    db: 'matic',  wh: 5,   evm: 137,    explorer: 'https://polygonscan.com/tx/{tx}' },
  avalanche:  { name: 'Avalanche',  ds: 'avalanche',  db: 'avax',   wh: 6,   evm: 43114,  explorer: 'https://snowtrace.io/tx/{tx}' },
  arbitrum:   { name: 'Arbitrum',   ds: 'arbitrum',   db: 'arb',    wh: 22,  evm: 42161,  explorer: 'https://arbiscan.io/tx/{tx}' },
  optimism:   { name: 'Optimism',   ds: 'optimism',   db: 'op',     wh: 23,  evm: 10,     explorer: 'https://optimistic.etherscan.io/tx/{tx}' },
  base:       { name: 'Base',       ds: 'base',       db: 'base',   wh: 30,  evm: 8453,   explorer: 'https://basescan.org/tx/{tx}' },
  scroll:     { name: 'Scroll',     ds: 'scroll',     db: 'scrl',   wh: 24,  evm: 534352, explorer: 'https://scrollscan.com/tx/{tx}' },
  linea:      { name: 'Linea',      ds: 'linea',      db: 'linea',  wh: 27,  evm: 59144,  explorer: 'https://lineascan.build/tx/{tx}' },
  blast:      { name: 'Blast',      ds: 'blast',      db: 'blast',  wh: 28,  evm: 81457,  explorer: 'https://blastscan.io/tx/{tx}' },
  mantle:     { name: 'Mantle',     ds: 'mantle',     db: 'mnt',    wh: 26,  evm: 5000,   explorer: 'https://mantlescan.xyz/tx/{tx}' },
  zksync:     { name: 'zkSync',     ds: 'zksync',     db: 'era',    wh: null, evm: 324,   explorer: 'https://explorer.zksync.io/tx/{tx}' },
  fantom:     { name: 'Fantom',     ds: 'fantom',     db: 'ftm',    wh: 10,  evm: 250,    explorer: 'https://ftmscan.com/tx/{tx}' },
  gnosis:     { name: 'Gnosis',     ds: 'gnosis',     db: 'xdai',   wh: null, evm: 100,   explorer: 'https://gnosisscan.io/tx/{tx}' },
  celo:       { name: 'Celo',       ds: 'celo',       db: 'celo',   wh: 14,  evm: 42220,  explorer: 'https://celoscan.io/tx/{tx}' },
  moonbeam:   { name: 'Moonbeam',   ds: 'moonbeam',   db: 'movr',   wh: 16,  evm: 1284,   explorer: 'https://moonscan.io/tx/{tx}' },
  metis:      { name: 'Metis',      ds: 'metis',      db: 'metis',  wh: null, evm: 1088,  explorer: 'https://explorer.metis.io/tx/{tx}' },
  sonic:      { name: 'Sonic',      ds: 'sonic',      db: 'sonic',  wh: 33,  evm: 146,    explorer: 'https://sonicscan.org/tx/{tx}' },
  berachain:  { name: 'Berachain',  ds: 'berachain',  db: 'bera',   wh: 34,  evm: 80094,  explorer: 'https://berascan.com/tx/{tx}' },
  unichain:   { name: 'Unichain',   ds: 'unichain',   db: 'uni',    wh: 31,  evm: 130,    explorer: 'https://uniscan.xyz/tx/{tx}' },
  cronos:     { name: 'Cronos',     ds: 'cronos',     db: 'cro',    wh: null, evm: 25,    explorer: 'https://cronoscan.com/tx/{tx}' },
  aptos:      { name: 'Aptos',      ds: 'aptos',      db: 'apt',    wh: 21,  evm: null,   explorer: 'https://explorer.aptoslabs.com/txn/{tx}' },
  sui:        { name: 'Sui',        ds: 'sui',        db: 'sui',    wh: 20,  evm: null,   explorer: 'https://suiscan.xyz/tx/{tx}' },
  injective:  { name: 'Injective',  ds: null,         db: null,     wh: 18,  evm: null,   explorer: 'https://explorer.injective.network/transaction/{tx}' },
  osmosis:    { name: 'Osmosis',    ds: null,         db: null,     wh: 19,  evm: null,   explorer: 'https://www.mintscan.io/osmosis/txs/{tx}' },
  near:       { name: 'Near',       ds: null,         db: null,     wh: 15,  evm: null,   explorer: 'https://explorer.near.org/transactions/{tx}' },
  klaytn:     { name: 'Klaytn',     ds: null,         db: 'klay',   wh: 13,  evm: 8217,   explorer: 'https://kaiascan.io/tx/{tx}' },
  aurora:     { name: 'Aurora',     ds: null,         db: null,     wh: 9,   evm: 1313161554, explorer: 'https://explorer.aurora.dev/tx/{tx}' },
  algorand:   { name: 'Algorand',   ds: null,         db: null,     wh: 8,   evm: null,   explorer: 'https://allo.info/tx/{tx}' },
  terra2:     { name: 'Terra 2',    ds: null,         db: null,     wh: 17,  evm: null,   explorer: 'https://finder.terra.money/mainnet/tx/{tx}' },
  oasis:      { name: 'Oasis',      ds: null,         db: null,     wh: 7,   evm: null,   explorer: 'https://explorer.oasis.io/mainnet/sapphire/tx/{tx}' },
  fantomLegacy: { name: 'Karura',   ds: null,         db: null,     wh: 11,  evm: null,   explorer: 'https://blockscout.karura.network/tx/{tx}' },
  acala:      { name: 'Acala',      ds: null,         db: null,     wh: 12,  evm: null,   explorer: 'https://acala.subscan.io/extrinsic/{tx}' },
  xlayer:     { name: 'X Layer',    ds: null,         db: null,     wh: null, evm: 196,   explorer: 'https://www.oklink.com/xlayer/tx/{tx}' },
  mode:       { name: 'Mode',       ds: null,         db: null,     wh: null, evm: 34443, explorer: 'https://explorer.mode.network/tx/{tx}' },
  ink:        { name: 'Ink',        ds: null,         db: null,     wh: null, evm: 57073, explorer: 'https://explorer.inkonchain.com/tx/{tx}' },
  worldchain: { name: 'World Chain', ds: null,        db: null,     wh: 32,  evm: 480,    explorer: 'https://worldscan.org/tx/{tx}' },
};

const INDEX = {};
for (const [key, c] of Object.entries(CHAINS)) {
  INDEX[`ds:${c.ds}`] = key;
  if (c.db) INDEX[`db:${c.db}`] = key;
  if (c.wh != null) INDEX[`wh:${c.wh}`] = key;
  if (c.evm != null) INDEX[`evm:${c.evm}`] = key;
}

function keyOf(kind, id) {
  if (id == null) return null;
  return INDEX[`${kind}:${id}`] || null;
}

function get(key) {
  return CHAINS[key] ? Object.assign({ key }, CHAINS[key]) : null;
}

function label(key) {
  return get(key)?.name || (key ? String(key) : '未知链');
}

function txUrl(key, tx) {
  const c = get(key);
  if (!c || !tx) return null;
  return c.explorer.replace('{tx}', tx);
}

// 官方 explorer 的「代币合约页」URL（用于二次确认合约真伪，人工点开即可核验）。
// 大多数 EVM Etherscan 系 explorer 的 tx 页是 /tx/{tx}，代币页是 /token/{addr}。
function tokenUrl(key, address) {
  const c = get(key);
  if (!c || !address) return null;
  if (key === 'solana') return `https://solscan.io/token/${address}`;
  if (key === 'sui') return `https://suiscan.xyz/coin/${address}`;
  if (key === 'aptos') return `https://explorer.aptoslabs.com/object/${address}`;
  if (!c.explorer) return null;
  const p = c.explorer.replace(/\/tx\/\{tx\}$/, '/token/{addr}');
  if (p === c.explorer) return null; // 非 /tx/{tx} 格式（如 Near/Aptos），无法推导代币页
  return p.replace('{addr}', address);
}

function debankProfileUrl(address) {
  return `https://debank.com/profile/${address}`;
}

// 所有支持 EVM V2 API（Etherscan/Blockscan 多链）的链 key，按注册顺序。
// 用于把钱包流水追踪覆盖到全部 EVM 链，而不是写死几条。
function evmChainKeys() {
  return Object.keys(CHAINS).filter((k) => CHAINS[k].evm != null);
}

module.exports = { CHAINS, keyOf, get, label, txUrl, tokenUrl, debankProfileUrl, evmChainKeys };
