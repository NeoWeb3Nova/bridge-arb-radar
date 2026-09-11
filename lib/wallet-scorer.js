'use strict';
const { addressKey } = require('./amounts');

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

// 已知公共跨链路由 / 协议适配器 / 资金池合约名单（严格拦截，禁止作为套利钱包计分）
const KNOWN_ROUTER_CONTRACTS = new Set([
  '0xce16f69375520ab01377ce7b88f5ba8c48f8d666', // Squid Multichain Router
  '0x4f49b53928a71e553bb1b0f66a5bcb54fd4e8932', // Immutable zkEVM Axelar Adaptor
  '0xb773bcc5b325ad9ac6b36e1a046ad4466833a16e', // Axelar Adaptor
  '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', // LiFi Diamond
  '0x5c7bcd6e7de5423a257d81b442095a1a6ced35c5', // Across SpokePool
  '0x4d9079bb4165aeb4084c526a32695dcfd2f77381', // Across HubPool
  '0x8731d54e9d02c286767d56ac03e8037c07e01e98', // Stargate V2 Router
  '0x296f55f8fb28e498b858d0adda062f5567215782', // Uniswap Universal Router
  '0x111111125421ca6dc452d289314280a0f8842a65', // 1inch v6 Router
  '0x1111111254fb6c44bac0bed2854e76f90643097d', // 1inch v5 Router
  '0x6a08344cda30c4015725832a2971524c74eab64b', // Relay Router
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
]);

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
    const isBackInitiated = !back.role || back.role === 'self' || back.role === 'sender';

    const match = sorted.find((f) => {
      if (used.has(f) || f === back) return false;
      if (!f.sym || MONEY_LEGS.has(f.sym)) return false;
      // 去程必须是由钱包主动发起的跨出（不能是被动接收）
      if (f.role === 'receiver') return false;
      // 路径反向对称：去程 A->B，回程 B->A
      if (f.from !== back.to || f.to !== back.from) return false;
      // 时间顺序与时间窗口
      const tOut = new Date(f.ts).getTime();
      const tBack = new Date(back.ts).getTime();
      if (tOut > tBack || (tBack - tOut) > CYCLE_WINDOW_MS) return false;

      // 对手方验证：如果回程不是本钱包发起的自跨链，而是被动接收，则必须确保资金来自去程的目标地址（真实对手方回流）
      if (!isBackInitiated) {
        if (!back.peer || !f.peer || addressKey(back.peer) !== addressKey(f.peer)) {
          return false;
        }
      }
      return true;
    });

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
    if (!sym || sym === 'null' || sym === 'undefined') continue;
    const [from, to] = route.split('>');
    if (!from || !to || from === to) continue;
    const key = `${sym}|${[from, to].sort().join('~')}`;
    pairs[key] = pairs[key] || new Set();
    pairs[key].add(route);
  }
  const exotic = Object.keys(w.tokens || {}).filter((s) => !COMMON.has(s));
  for (const set of Object.values(pairs)) if (set.size >= 2) roundtrips += 1;

  const cyc = detectCapitalCycles(w);
  w.capitalCycles = cyc.cycles;
  w.capitalCycleDetails = cyc.details;

  const sentCount = w.sentCount != null ? w.sentCount : (w.flows || []).filter((f) => f.role === 'sender' || f.role === 'self').length;
  const recvCount = w.receivedCount != null ? w.receivedCount : (w.flows || []).filter((f) => f.role === 'receiver').length;
  const totalBridges = w.bridgeCount || (sentCount + recvCount);

  // 被动代收账户 / 归集地址识别：
  // 从未主动发起过跨链，或绝大多数交互属于被动接收（接收>=5次且主动占比<15%）
  const isPureReceiver = sentCount === 0 && recvCount > 0;
  const isSinkOrDeposit = recvCount >= 5 && (sentCount / (sentCount + recvCount)) < 0.15;
  const passiveAccount = isPureReceiver || isSinkOrDeposit;

  const recencyDays = w.lastSeen ? (now - new Date(w.lastSeen).getTime()) / 86400000 : 999;
  const share = maxBridges > 0 ? totalBridges / maxBridges : 0;
  const isKnownContract = KNOWN_ROUTER_CONTRACTS.has(addressKey(w.address));
  // 识别疑似桥路由/协议合约：
  // 1. 在已知公共桥/路由合约名单中
  // 2. 超高频跨链(>=80)且跨度极广(>=8条链且>=10个代币)，无论随机配对出多少闭环，均为公共路由/中继特征
  // 3. 高频跨链且无资金闭环与往返
  const isHeavyVolume = totalBridges >= 100 || (maxBridges >= 60 && totalBridges >= 30 && share > 0.35);
  const isContractLikeSpread = totalBridges >= 80 && chainCount >= 8 && tokenCount >= 10;
  const likelyContract = isKnownContract || isContractLikeSpread || (isHeavyVolume && (w.capitalCycles || 0) === 0 && roundtrips === 0) || Boolean(w.likelyContract);
  w.likelyContract = likelyContract;
  w.passiveAccount = passiveAccount;
  w.sentCount = sentCount;
  w.receivedCount = recvCount;

  // 1. 资金闭环与同币往返 (Proof of Arb, 满分 40分)
  // 资金闭环是套利最硬核的数学证明：每个闭环 +15分，最高 30分 (2次打满)
  const cyclesScore = Math.min(30, (w.capitalCycles || 0) * 15);
  // 同币往返：每组 +5分，最高 10分 (2次打满)
  const roundtripsScore = Math.min(10, roundtrips * 5);
  const cycleTotalScore = cyclesScore + roundtripsScore; // 0 ~ 40

  // 2. 跨链经验与频次 (Activity & Breadth, 满分 25分)
  // 按照主动发起跨链次数阶梯评分 (最高 20分)
  let bridgeScore = 0;
  if (sentCount >= 30) bridgeScore = 20;
  else if (sentCount >= 10) bridgeScore = 14;
  else if (sentCount >= 3) bridgeScore = 8;
  else if (sentCount >= 1) bridgeScore = 3;
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

  // 异常惩罚：
  // 1. 公共桥路由/协议合约直接归零 (归入 D 级)，严禁污染聪明套利钱包榜单
  // 2. 被动接收/归集地址封顶在 15 分以内 (归入 D 级)
  let finalScore = rawScore;
  if (likelyContract) {
    finalScore = 0;
  } else if (passiveAccount) {
    finalScore = Math.min(15, Math.round(rawScore * 0.15));
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
    likelyContract ? (isKnownContract ? '协议路由合约' : '疑似桥合约') : null,
    passiveAccount ? (isPureReceiver ? '代收地址' : '归集/代收') : null,
    !likelyContract && !passiveAccount && (w.capitalCycles || 0) >= 2 ? '职业套利者' : null,
    !likelyContract && !passiveAccount && (w.capitalCycles || 0) >= 1 ? '资金闭环' : null,
    !likelyContract && !passiveAccount && roundtrips >= 2 ? '同币往返×2' : null,
    !likelyContract && !passiveAccount && roundtrips >= 1 ? '同币往返' : null,
    !likelyContract && (w.maxUsd || 0) >= 100000 ? '大额' : null,
    !likelyContract && chainCount >= 3 ? '多链活跃' : null,
    !likelyContract && exotic.length >= 3 ? '偏好冷门币' : null,
    !likelyContract && (sentCount >= 20 || totalBridges >= 30) ? '高频桥用户' : null,
    !likelyContract && recencyDays <= 1 ? '24h 内活跃' : null,
  ].filter(Boolean);

  return w;
}

module.exports = {
  COMMON,
  MONEY_LEGS,
  CYCLE_WINDOW_MS,
  KNOWN_ROUTER_CONTRACTS,
  detectCapitalCycles,
  scoreSingleWallet,
};
