'use strict';

// 主流币白名单：不在名单里的 symbol 视为「陌生代币」
const COMMON = new Set([
  'ETH', 'WETH', 'USDC', 'USDC.E', 'USDBC', 'USDT', 'DAI', 'WBTC', 'CBBTC', 'TBTC', 'WSTETH', 'STETH', 'RETH', 'CBETH',
  'WEETH', 'EZETH', 'RSETH', 'PXETH', 'FRXETH', 'SFRXETH', 'USDE', 'SUSDE', 'USDS', 'SDAI', 'SUSDS', 'BNB', 'WBNB',
  'SOL', 'WSOL', 'MSOL', 'JITOSOL', 'BSOL', 'JSOL', 'ARB', 'OP', 'MNT', 'POL', 'MATIC', 'AVAX', 'WAVAX', 'FTM', 'S',
  'BERA', 'UNI', 'LINK', 'AAVE', 'LDO', 'PENDLE', 'CRV', 'CVX', 'BAL', 'COMP', 'MKR', 'SKY', 'ENA', 'ONDO', 'PYUSD',
  'FDUSD', 'TUSD', 'USDP', 'GUSD', 'GHO', 'CRVUSD', 'FRAX', 'LUSD', 'DOLA', 'MIM', 'EURC', 'EURS', 'XAUT', 'PAXG',
  'RLUSD', 'USD0', 'USDF', 'XAUt', 'INJ', 'APT', 'SUI', 'TON', 'TRX', 'USDD', 'USDX', 'USDY', 'STKAAVE', 'RPL',
]);

// 套利闭环里的「回流腿」载体：卖掉代币后桥回去的通常是稳定币/主流 gas 资产
const MONEY_LEGS = new Set([
  'USDC', 'USDC.E', 'USDBC', 'USDT', 'DAI', 'USDE', 'SUSDE', 'USDS', 'SDAI', 'SUSDS',
  'PYUSD', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'GHO', 'CRVUSD', 'FRAX', 'LUSD', 'DOLA',
  'MIM', 'EURC', 'USD0', 'USDF', 'RLUSD', 'USDD', 'USDX', 'USDY',
  'ETH', 'WETH', 'WSTETH', 'STETH', 'WBNB', 'BNB', 'SOL', 'WSOL', 'POL', 'MATIC',
  'AVAX', 'WAVAX', 'FTM', 'S', 'BERA', 'MNT', 'WBTC', 'CBBTC',
]);

const CYCLE_WINDOW_MS = 7 * 86400000;

/**
 * 资金闭环检测（真实套利指纹）：
 * 非资金类代币 A→B 出去 + 资金类资产 B→A 回来
 * @param {Object} w 钱包数据对象
 * @returns {{cycles: number, details: Array}}
 */
function detectCapitalCycles(w) {
  const flows = (w.flows || []).filter((f) => f.from && f.to && f.ts);
  if (flows.length < 2) return { cycles: 0, details: [] };
  const sorted = [...flows].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const used = new Set();
  const details = [];
  for (const back of sorted) {
    if (used.has(back)) continue;
    if (!MONEY_LEGS.has(back.sym)) continue;
    const match = sorted.find((f) =>
      !used.has(f) && f !== back
      && f.sym && !MONEY_LEGS.has(f.sym)
      && f.from === back.to && f.to === back.from
      && new Date(f.ts) <= new Date(back.ts)
      && (new Date(back.ts) - new Date(f.ts)) <= CYCLE_WINDOW_MS
    );
    if (!match) continue;
    used.add(match);
    used.add(back);
    details.push({
      token: match.sym, outChain: match.from, inChain: match.to, moneyLeg: back.sym,
      outTs: match.ts, backTs: back.ts,
      hours: Number(((new Date(back.ts) - new Date(match.ts)) / 3600000).toFixed(1)),
      outUsd: Math.round(match.usd || 0), backUsd: Math.round(back.usd || 0),
    });
  }
  return { cycles: details.length, details: details.slice(-12) };
}

/**
 * 计算单个钱包的套利评分、等级与标签
 * @param {Object} w 钱包对象
 * @param {number} maxBridges 当前库中最大桥次数
 * @param {number} [now=Date.now()]
 */
function scoreSingleWallet(w, maxBridges = 0, now = Date.now()) {
  const tokenCount = Object.keys(w.tokens || {}).length;
  const chainCount = Object.keys(w.chains || {}).length;

  let roundtrips = 0;
  const dirs = w.dirs || {};
  const pairs = {};
  for (const dk of Object.keys(dirs)) {
    const [sym, route] = dk.split('|');
    const [from, to] = route.split('>');
    const key = `${sym}|${[from, to].sort().join('~')}`;
    pairs[key] = pairs[key] || new Set();
    pairs[key].add(route);
  }
  const exotic = Object.keys(w.tokens || {}).filter((s) => !COMMON.has(s));
  for (const set of Object.values(pairs)) if (set.size >= 2) roundtrips += 1;

  const cyc = detectCapitalCycles(w);
  w.capitalCycles = cyc.cycles;
  w.capitalCycleDetails = cyc.details;

  const recencyDays = w.lastSeen ? (now - new Date(w.lastSeen).getTime()) / 86400000 : 999;
  const share = maxBridges > 0 ? (w.bridgeCount || 0) / maxBridges : 0;
  const likelyContract = (w.bridgeCount || 0) >= 25 && share > 0.35;
  w.likelyContract = likelyContract;

  let score = 0;
  score += Math.min(30, (w.bridgeCount || 0) * 2);
  score += Math.min(20, tokenCount * 3);
  score += Math.min(15, chainCount * 4);
  score += Math.min(10, roundtrips * 3);
  score += Math.min(70, (w.capitalCycles || 0) * 25);
  score += recencyDays <= 1 ? 10 : recencyDays <= 3 ? 5 : 0;
  if ((w.maxUsd || 0) >= 100000) score += 8;
  if (likelyContract) score = Math.round(score * 0.25);

  w.roundtrips = roundtrips;
  w.tokenCount = tokenCount;
  w.chainCount = chainCount;
  w.exoticCount = exotic.length;
  w.score = Math.round(score);
  w.grade = w.score >= 70 ? 'A' : w.score >= 40 ? 'B' : w.score >= 20 ? 'C' : 'D';
  w.autoTags = [
    likelyContract ? '疑似桥合约' : null,
    (w.capitalCycles || 0) >= 2 ? '职业套利者' : null,
    (w.capitalCycles || 0) >= 1 ? '资金闭环' : null,
    roundtrips >= 2 ? '同币往返×2' : null,
    roundtrips >= 1 ? '同币往返' : null,
    (w.maxUsd || 0) >= 100000 ? '大额' : null,
    chainCount >= 3 ? '多链活跃' : null,
    exotic.length >= 3 ? '偏好冷门币' : null,
    (w.bridgeCount || 0) >= 20 ? '高频桥用户' : null,
    recencyDays <= 1 ? '24h 内活跃' : null,
  ].filter(Boolean);

  return w;
}

module.exports = {
  COMMON,
  MONEY_LEGS,
  CYCLE_WINDOW_MS,
  detectCapitalCycles,
  scoreSingleWallet,
};
