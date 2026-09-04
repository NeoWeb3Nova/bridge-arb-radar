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
  // 识别疑似桥路由/协议合约：高频跨链且无资金闭环与往返（避免新库冷启动或对冲套利者被误杀）
  const isHeavyVolume = (w.bridgeCount || 0) >= 100 || (maxBridges >= 60 && (w.bridgeCount || 0) >= 30 && share > 0.35);
  const likelyContract = isHeavyVolume && (w.capitalCycles || 0) === 0 && roundtrips === 0;
  w.likelyContract = likelyContract;

  // 1. 资金闭环与同币往返 (Proof of Arb, 满分 40分)
  // 资金闭环是套利最硬核的数学证明：每个闭环 +15分，最高 30分 (2次打满)
  const cyclesScore = Math.min(30, (w.capitalCycles || 0) * 15);
  // 同币往返：每组 +5分，最高 10分 (2次打满)
  const roundtripsScore = Math.min(10, roundtrips * 5);
  const cycleTotalScore = cyclesScore + roundtripsScore; // 0 ~ 40

  // 2. 跨链经验与频次 (Activity & Breadth, 满分 25分)
  // 跨链次数阶梯评分 (最高 20分)
  const bCount = w.bridgeCount || 0;
  let bridgeScore = 0;
  if (bCount >= 30) bridgeScore = 20;
  else if (bCount >= 10) bridgeScore = 14;
  else if (bCount >= 3) bridgeScore = 8;
  else if (bCount >= 1) bridgeScore = 3;
  // 覆盖公链数 (最高 5分)
  const chainScore = chainCount >= 3 ? 5 : (chainCount === 2 ? 2 : 0);
  const activityTotalScore = bridgeScore + chainScore; // 0 ~ 25

  // 3. 代币多样性与长尾猎犬敏锐度 (Exotic Alpha, 满分 15分)
  // 参与非主流/非稳定币长尾代币数：每个 +3分，最高 15分 (5个币种打满)
  const exoticScore = Math.min(15, exotic.length * 3); // 0 ~ 15

  // 4. 资金实力与规模 (Capital Scale, 满分 10分)
  const maxUsd = w.maxUsd || 0;
  let scaleScore = 0;
  if (maxUsd >= 100000) scaleScore = 10;
  else if (maxUsd >= 10000) scaleScore = 7;
  else if (maxUsd >= 1000) scaleScore = 4;
  else if (maxUsd >= 100) scaleScore = 1;

  // 5. 时效新鲜度 (Recency, 满分 10分)
  let recencyScore = 0;
  if (recencyDays <= 1) recencyScore = 10;
  else if (recencyDays <= 3) recencyScore = 6;
  else if (recencyDays <= 7) recencyScore = 3;

  const rawScore = Math.min(100, Math.max(0, cycleTotalScore + activityTotalScore + exoticScore + scaleScore + recencyScore));

  // 异常惩罚：疑似桥路由/协议合约封顶在 20 分以内 (归入 D 级)
  let finalScore = rawScore;
  if (likelyContract) {
    finalScore = Math.min(20, Math.round(rawScore * 0.2));
  }

  w.roundtrips = roundtrips;
  w.tokenCount = tokenCount;
  w.chainCount = chainCount;
  w.exoticCount = exotic.length;
  w.score = Math.round(finalScore);
  w.scoreBreakdown = {
    cycle: cycleTotalScore,       // 0~40
    activity: activityTotalScore, // 0~25
    exotic: exoticScore,          // 0~15
    scale: scaleScore,            // 0~10
    recency: recencyScore,        // 0~10
  };

  // 标准百分制评级：S (90-100), A (75-89), B (50-74), C (25-49), D (0-24)
  w.grade = w.score >= 90 ? 'S' : (w.score >= 75 ? 'A' : (w.score >= 50 ? 'B' : (w.score >= 25 ? 'C' : 'D')));
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
