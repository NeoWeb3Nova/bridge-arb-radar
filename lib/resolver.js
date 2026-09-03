'use strict';
// 代币身份解析器（Token Resolver）。
//
// 核心问题：跨链比价时，按 symbol 模糊搜索 DexScreener 会混入同名假币。
// 因为 symbol 无法唯一标识资产——同一条链上可以有成百上千个 symbol 相同的合约，
// 只有「官方合约地址」才是可信锚点。
//
// 本模块建立 symbol → 各链官方合约地址 的映射，用三个来源交叉验证：
//   1. bridge   —— 桥数据/代币库里真实出现过「链上事实」地址（最强，真实发生过）
//   2. trustwallet —— Trust Wallet 官方多链 token 注册表（免费、无限速、覆盖 12 条主流链）
//   3. coingecko —— CoinGecko platforms 字段（一个请求给出某 token 在所有链的官方地址）
//
// 比价时只对官方地址做精确报价；symbol 搜索只做最后兜底，且必须与官方地址交叉比对。
const fs = require('fs');
const path = require('path');
const { request } = require('./net');
const store = require('./store');
const chains = require('./chains');

const DATA_DIR = path.join(__dirname, '..', 'data');
const REG_FILE = path.join(DATA_DIR, 'token-registry.json');

// Trust Wallet 官方注册表：目录名 → 内部 chainKey（已实测验证 12 条链可用）
const TW_CHAINS = [
  { dir: 'ethereum', chainKey: 'ethereum' },
  { dir: 'solana', chainKey: 'solana' },
  { dir: 'smartchain', chainKey: 'bsc' },
  { dir: 'polygon', chainKey: 'polygon' },
  { dir: 'avalanchec', chainKey: 'avalanche' },
  { dir: 'arbitrum', chainKey: 'arbitrum' },
  { dir: 'optimism', chainKey: 'optimism' },
  { dir: 'base', chainKey: 'base' },
  { dir: 'fantom', chainKey: 'fantom' },
  { dir: 'linea', chainKey: 'linea' },
  { dir: 'zksync', chainKey: 'zksync' },
  { dir: 'sonic', chainKey: 'sonic' },
];

// CoinGecko platform id → 内部 chainKey（用于按需补全 & 交叉验证）
const CG_PLATFORMS = {
  ethereum: 'ethereum',
  'binance-smart-chain': 'bsc',
  'polygon-pos': 'polygon',
  avalanche: 'avalanche',
  'arbitrum-one': 'arbitrum',
  'optimistic-ethereum': 'optimism',
  base: 'base',
  solana: 'solana',
  fantom: 'fantom',
  zksync: 'zksync',
  linea: 'linea',
  scroll: 'scroll',
  blast: 'blast',
  mantle: 'mantle',
  celo: 'celo',
  gnosis: 'gnosis',
  moonbeam: 'moonbeam',
  'metis-andromeda': 'metis',
  sonic: 'sonic',
  berachain: 'berachain',
  unichain: 'unichain',
  cronos: 'cronos',
  sui: 'sui',
  aptos: 'aptos',
  'near-protocol': 'near',
  'klay-token': 'klaytn',
  aurora: 'aurora',
  xdai: 'gnosis',
};

// 来源优先级：数字越小越可信。bridge 是链上真实发生过的地址，优先级最高。
const SOURCE_RANK = { bridge: 0, coingecko: 1, trustwallet: 2 };

let registry = null;

function emptyRegistry() {
  return { builtAt: null, bySymbol: {}, byAddress: {}, sources: { trustwallet: { chains: [] }, coingecko: { tokens: 0 } } };
}

function loadRegistry() {
  if (registry) return registry;
  try {
    if (fs.existsSync(REG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(REG_FILE, 'utf8'));
      registry = Object.assign(emptyRegistry(), raw);
      return registry;
    }
  } catch (err) {
    console.error('[resolver] 注册表读取失败：', err.message);
  }
  registry = emptyRegistry();
  return registry;
}

function writeRegistry(idx) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = REG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(idx), 'utf8');
    fs.renameSync(tmp, REG_FILE);
    registry = idx;
  } catch (err) {
    console.error('[resolver] 注册表写入失败：', err.message);
  }
}

function addEntry(idx, sym, chain, entry) {
  const addr = String(entry.address || '').toLowerCase();
  if (!sym || !chain || !addr) return;
  idx.bySymbol[sym] = idx.bySymbol[sym] || {};
  idx.bySymbol[sym][chain] = idx.bySymbol[sym][chain] || [];
  if (!idx.bySymbol[sym][chain].some((e) => e.address === addr)) {
    idx.bySymbol[sym][chain].push({ address: addr, name: entry.name || null, decimals: entry.decimals ?? null, source: entry.source });
  }
  idx.byAddress[chain] = idx.byAddress[chain] || {};
  idx.byAddress[chain][addr] = idx.byAddress[chain][addr] || { symbol: sym, name: entry.name || sym };
}

/** 下载 Trust Wallet 12 条链的官方 token 注册表并构建倒排索引。返回 { ok, added, chains, error }。 */
async function buildRegistry(settings) {
  const idx = emptyRegistry();
  idx.builtAt = new Date().toISOString();
  const results = await Promise.all(TW_CHAINS.map(async (tw) => {
    const url = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${tw.dir}/tokenlist.json`;
    const res = await request(url, { settings, timeout: 40000 });
    if (!res.ok || !res.json || !Array.isArray(res.json.tokens)) {
      return { tw, ok: false, error: res.error || ('HTTP ' + res.status) };
    }
    return { tw, ok: true, tokens: res.json.tokens };
  }));

  let added = 0;
  const chains = [];
  const errors = [];
  for (const r of results) {
    if (!r.ok) { errors.push(`${r.tw.dir}: ${r.error}`); continue; }
    chains.push(r.tw.chainKey);
    for (const t of r.tokens) {
      const sym = String(t.symbol || '').toUpperCase().trim();
      const addr = String(t.address || '').trim();
      if (!sym || !addr) continue;
      addEntry(idx, sym, r.tw.chainKey, {
        address: addr, name: t.name || null, decimals: t.decimals ?? null, source: 'trustwallet',
      });
      added++;
    }
  }
  idx.sources.trustwallet.chains = chains;
  writeRegistry(idx);
  return { ok: chains.length > 0, added, chains, errors };
}

/** 按需查 CoinGecko 的官方多链合约（platforms 字段），做交叉验证 / 补全。
 *  结果写入注册表缓存；同一 symbol 24h 内只查一次，避免触发限速。 */
async function coingeckoLookup(symbol, settings) {
  const sym = String(symbol || '').trim();
  if (!sym) return null;
  const idx = loadRegistry();
  const key = sym.toUpperCase();
  // 已缓存过 → 直接返回缓存
  const cachedArr = idx.bySymbol[key] || {};
  const cgByChain = {};
  for (const [ck, arr] of Object.entries(cachedArr)) {
    const e = arr.find((x) => x.source === 'coingecko');
    if (e) cgByChain[ck] = e;
  }
  if (Object.keys(cgByChain).length) {
    return {
      cached: true, symbol: key,
      entries: Object.entries(cgByChain).map(([chain, e]) => ({ chain, address: e.address, name: e.name, decimals: e.decimals, source: 'coingecko' })),
    };
  }
  // 24h 内查过但没结果 → 跳过（避免每次扫描都空查）
  idx.cgChecked = idx.cgChecked || {};
  const last = idx.cgChecked[key];
  if (last && Date.now() - last < 86400000) return null;

  // 1. 搜索 id（精确匹配 symbol）
  const sRes = await request(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(sym)}`, { settings, timeout: 20000 });
  if (!sRes.ok || !sRes.json) return null;
  const coins = (sRes.json.coins || []).filter((c) => String(c.symbol || '').toLowerCase() === sym.toLowerCase());
  if (!coins.length) { idx.cgChecked[key] = Date.now(); writeRegistry(idx); return null; }
  const coin = coins[0];
  const cRes = await request(`https://api.coingecko.com/api/v3/coins/${coin.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`, { settings, timeout: 25000 });
  if (!cRes.ok || !cRes.json) return null;
  const platforms = cRes.json.platforms || {};
  const entries = [];
  for (const [pid, addr] of Object.entries(platforms)) {
    const ck = CG_PLATFORMS[pid];
    if (!ck || typeof addr !== 'string' || !addr) continue;
    const e = { chain: ck, address: addr.toLowerCase(), name: cRes.json.name || null, decimals: null, source: 'coingecko' };
    entries.push(e);
    addEntry(idx, key, ck, { address: addr, name: cRes.json.name || null, decimals: null, source: 'coingecko' });
  }
  idx.sources.coingecko.tokens = (idx.sources.coingecko.tokens || 0) + 1;
  idx.cgChecked[key] = Date.now();
  writeRegistry(idx);
  return { id: coin.id, name: cRes.json.name, symbol: cRes.json.symbol, entries };
}

/**
 * 解析某个 symbol 在各链上的官方合约地址。
 * 返回 { symbol, entries, byChain, ambiguous, names }。
 * opts.originChain/originAddress：若给出锚点，则反查 canonical name 并过滤掉同名不同资产。
 */
function resolveSymbol(symbol, opts = {}) {
  const idx = loadRegistry();
  const sym = String(symbol || '').toUpperCase().trim();
  const exclude = new Set(opts.excludeChains || []);
  const byChain = {};
  const seen = new Set();
  const push = (chain, entry) => {
    if (!chain || exclude.has(chain)) return;
    const k = `${chain}:${entry.address}`;
    if (seen.has(k)) return;
    seen.add(k);
    byChain[chain] = byChain[chain] || [];
    byChain[chain].push({
      chain, address: entry.address, name: entry.name, decimals: entry.decimals,
      source: entry.source,
      explorerUrl: chains.tokenUrl(chain, entry.address),
      // 只有官方注册表（trustwallet / coingecko）给出的地址才默认可信；
      // bridge 来源只是「链上出现过」，可能是假币被桥过，需交叉验证。
      verified: entry.source !== 'bridge',
    });
  };

  // 1. 官方注册表（trustwallet + 已缓存的 coingecko）——「真实合约」的直接答案
  const reg = idx.bySymbol[sym] || {};
  for (const [chain, arr] of Object.entries(reg)) {
    for (const e of arr) push(chain, e);
  }

  // 2. 桥数据链上事实（代币库里该 symbol 真实出现过的 chain+address）
  const d = store.raw();
  for (const tok of Object.values(d.tokens || {})) {
    if (String(tok.symbol || '').toUpperCase() !== sym) continue;
    push(tok.chain, { address: String(tok.address || '').toLowerCase(), name: null, decimals: null, source: 'bridge' });
  }

  // 3. 交叉验证：bridge 地址若与同链官方地址一致 → 升级为可信（这是真币被桥过的证据）；
  //    否则保持 unverified，交给上层当作「疑似假币」处理。
  for (const [chain, arr] of Object.entries(byChain)) {
    const official = new Set(arr.filter((e) => e.source !== 'bridge').map((e) => e.address));
    for (const e of arr) {
      if (e.source === 'bridge' && official.has(e.address)) e.verified = true;
    }
  }

  // 4. 锚点反查：若有 origin 地址，用官方注册表反查 canonical name，过滤同名不同资产
  let anchoredName = null;
  if (opts.originChain && opts.originAddress) {
    const hit = idx.byAddress[opts.originChain]?.[String(opts.originAddress).toLowerCase()];
    if (hit?.name) anchoredName = String(hit.name).toLowerCase();
  }

  const names = new Set();
  for (const arr of Object.values(byChain)) {
    for (const e of arr) if (e.name) names.add(String(e.name).toLowerCase());
  }

  // 歧义检测：同名 symbol 在不同链上指向了不同 name（不同资产）
  const ambiguous = names.size > 1;

  let entries = [];
  for (const arr of Object.values(byChain)) entries.push(...arr);
  entries.sort((a, b) => (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9));

  // 应用锚定过滤
  if (anchoredName) {
    const filtered = entries.filter((e) => !e.name || String(e.name).toLowerCase() === anchoredName);
    if (filtered.length) entries = filtered;
  }

  const verifiedCount = entries.filter((e) => e.verified).length;
  return { symbol: sym, entries, byChain, ambiguous, names: [...names], anchoredName, verifiedCount };
}

/** 某地址在官方注册表里的 canonical 身份（用于反查：给定地址 → 官方 name/symbol）。 */
function identityOf(chain, address) {
  if (!chain || !address) return null;
  const idx = loadRegistry();
  const hit = idx.byAddress[chain]?.[String(address).toLowerCase()];
  if (!hit) return null;
  return { symbol: hit.symbol, name: hit.name, chain, address: String(address).toLowerCase() };
}

function registryStatus() {
  const idx = loadRegistry();
  const symbols = Object.keys(idx.bySymbol || {}).length;
  return {
    builtAt: idx.builtAt,
    symbols,
    sources: idx.sources,
    file: REG_FILE,
  };
}

/** 把官方合约注册表拍平成 symbol → 各链合约 的对照行（用于导出 CSV/JSON 离线核对）。 */
function flattenRegistry() {
  const idx = loadRegistry();
  const rows = [];
  for (const [sym, byChain] of Object.entries(idx.bySymbol || {})) {
    for (const [chain, arr] of Object.entries(byChain)) {
      for (const e of arr) {
        rows.push({
          symbol: sym,
          chain,
          address: e.address,
          name: e.name || '',
          decimals: e.decimals ?? '',
          source: e.source,
          explorerUrl: chains.tokenUrl(chain, e.address),
        });
      }
    }
  }
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.chain.localeCompare(b.chain) || a.address.localeCompare(b.address));
  return rows;
}

module.exports = { buildRegistry, coingeckoLookup, resolveSymbol, identityOf, registryStatus, flattenRegistry, loadRegistry, TW_CHAINS, CG_PLATFORMS, SOURCE_RANK };
