import { SecurityCheckResult } from '../types';

// Cross-chain arbitrage routing and net fee estimator
export interface LiveQuoteData {
  ok: boolean;
  isLiveQuote: boolean;
  hasApiKey?: boolean;
  isDirectTokenRoute?: boolean;
  source: string;
  bridgeName: string;
  bridgeUrl: string;
  etaSeconds: number;
  gasUsd: number;
  bridgeFeeUsd: number;
  totalFeeUsd: number;
  ttlSeconds?: number;
  updatedAt?: number;
  expiresAt?: number;
  details?: {
    gasTokens?: string[];
    feeDetails?: string[];
    note?: string;
    apiKeyWarning?: string;
  };
}

export interface BridgeRouteInfo {
  bridgeName: string;
  badgeClass: string;
  etaMinutes: number;
  estGasUsd: number;
  estBridgeFeeRate: number; // e.g. 0.0006 = 0.06%
  minBridgeFeeUsd: number;
  securityRating: 'high' | 'medium' | 'standard';
  bridgeUrl: string;
}

export interface ArbNetCalculation {
  capitalUsd: number;
  tokensBought: number;
  grossRevenueUsd: number;
  grossProfitUsd: number;
  estGasUsd: number;
  estBridgeFeeUsd: number;
  estSlippageUsd: number;
  estTotalCostUsd: number;
  netProfitUsd: number;
  netRoiPct: number;
  isProfitable: boolean;
  priceDelta: number;
  slippagePct: number;
  poolImpactPct: number;          // 当前本金对池子造成的单边冲击率 (e.g. 2.5%)
  maxSafeCapacityUsd: number;     // 建议单笔最大安全容量 (按 pool TVL 2% 计算)
  liquidityHealth: 'safe' | 'moderate' | 'dangerous';
  token1kCost: number;            // 1,000 个代币的买入成本 (例如 $47.90)
  token1kRevenue: number;         // 1,000 个代币的卖出到手 (例如 $70.56)
  token1kProfit: number;          // 1,000 个代币的毛利润 (例如 $22.66)
  route: BridgeRouteInfo;
  isLiveQuote?: boolean;
  liveQuoteData?: LiveQuoteData;
  score: number; // 0~100 可行性综合评分
  scoreGrade: 'S' | 'A' | 'B' | 'C' | 'D';
  scoreBreakdown: ArbScoreBreakdown;
  scoreComment: string;
}

export interface ArbScoreBreakdown {
  profitScore: number;    // 0~40 净收益空间
  liquidityScore: number; // 0~30 真实流动性与现金储备
  bridgeScore: number;    // 0~20 跨链通道速度与稳定性
  volumeScore: number;    // 0~10 市场活跃度
  penalty: number;        // 扣分惩罚
}

const L2_CHAINS = new Set([
  'arbitrum', 'optimism', 'base', 'polygon', 'linea', 
  'blast', 'scroll', 'zksync', 'mode', 'ink'
]);

/**
 * Determine best bridge route based on source and target chains
 */
export function resolveBridgeRoute(buyChain: string, sellChain: string): BridgeRouteInfo {
  const c1 = (buyChain || '').toLowerCase();
  const c2 = (sellChain || '').toLowerCase();

  const isL2toL2 = L2_CHAINS.has(c1) && L2_CHAINS.has(c2);
  const hasEth = c1 === 'ethereum' || c2 === 'ethereum';
  const hasSol = c1 === 'solana' || c2 === 'solana';
  const hasBsc = c1 === 'bsc' || c2 === 'bsc';
  const hasAvax = c1 === 'avalanche' || c2 === 'avalanche';

  // 1. L2 to L2: Across is typically fastest and cheapest
  if (isL2toL2) {
    return {
      bridgeName: 'Across',
      badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      etaMinutes: 1.2,
      estGasUsd: 0.85,
      estBridgeFeeRate: 0.0004,
      minBridgeFeeUsd: 0.40,
      securityRating: 'high',
      bridgeUrl: 'https://across.to/',
    };
  }

  // 2. Solana involvement: Hyperlane / Wormhole
  if (hasSol) {
    return {
      bridgeName: 'Hyperlane',
      badgeClass: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
      etaMinutes: 2.5,
      estGasUsd: 0.95,
      estBridgeFeeRate: 0.0005,
      minBridgeFeeUsd: 0.50,
      securityRating: 'high',
      bridgeUrl: 'https://www.hyperlane.xyz/',
    };
  }

  // 3. Ethereum mainnet involved (higher gas)
  if (hasEth) {
    return {
      bridgeName: 'Stargate',
      badgeClass: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
      etaMinutes: 2.2,
      estGasUsd: 6.50, // Ethereum L1 gas
      estBridgeFeeRate: 0.0006,
      minBridgeFeeUsd: 1.50,
      securityRating: 'high',
      bridgeUrl: 'https://stargate.finance/',
    };
  }

  // 4. BSC / Avalanche / Polygon cross-chain
  if (hasBsc || hasAvax) {
    return {
      bridgeName: 'Stargate',
      badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      etaMinutes: 1.8,
      estGasUsd: 1.40,
      estBridgeFeeRate: 0.0006,
      minBridgeFeeUsd: 0.60,
      securityRating: 'high',
      bridgeUrl: 'https://stargate.finance/',
    };
  }

  // 5. General fallback
  return {
    bridgeName: 'Hyperlane',
    badgeClass: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    etaMinutes: 2.5,
    estGasUsd: 1.80,
    estBridgeFeeRate: 0.0006,
    minBridgeFeeUsd: 0.80,
    securityRating: 'medium',
    bridgeUrl: 'https://www.hyperlane.xyz/',
  };
}

/**
 * Calculate net arbitrage economics given position capital (USD) and opportunity quotes
 */
export function calculateNetArb(
  buyPrice: number,
  sellPrice: number,
  spreadPct: number,
  minLiquidityUsd: number,
  buyChain: string,
  sellChain: string,
  capitalUsd = 1000,
  liveQuote?: LiveQuoteData | null,
  sellQuoteReserveUsd?: number,
  buyBaseReserveUsd?: number,
  security?: SecurityCheckResult | null
): ArbNetCalculation {
  const defaultRoute = resolveBridgeRoute(buyChain, sellChain);
  const route: BridgeRouteInfo = (liveQuote && liveQuote.bridgeName) ? {
    bridgeName: liveQuote.bridgeName,
    badgeClass: liveQuote.isLiveQuote 
      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' 
      : defaultRoute.badgeClass,
    etaMinutes: liveQuote.etaSeconds ? Number((liveQuote.etaSeconds / 60).toFixed(1)) : defaultRoute.etaMinutes,
    estGasUsd: typeof liveQuote.gasUsd === 'number' ? liveQuote.gasUsd : defaultRoute.estGasUsd,
    estBridgeFeeRate: defaultRoute.estBridgeFeeRate,
    minBridgeFeeUsd: typeof liveQuote.bridgeFeeUsd === 'number' ? liveQuote.bridgeFeeUsd : defaultRoute.minBridgeFeeUsd,
    securityRating: 'high',
    bridgeUrl: liveQuote.bridgeUrl || defaultRoute.bridgeUrl,
  } : defaultRoute;

  const priceDelta = sellPrice - buyPrice;

  // 1. 代币数量与名义毛利
  const tokensBought = buyPrice > 0 ? capitalUsd / buyPrice : 0;
  const grossRevenueUsd = tokensBought * sellPrice;
  const grossProfitUsd = grossRevenueUsd - capitalUsd;

  // 对照组：如果只搬 1,000 个代币的收益情况
  const token1kCost = buyPrice * 1000;
  const token1kRevenue = sellPrice * 1000;
  const token1kProfit = token1kRevenue - token1kCost;

  // 2. Gas & Bridge Protocol Fees (若有实时询价，直接使用链上真实 Gas 与桥费)
  const estGasUsd = typeof liveQuote?.gasUsd === 'number' ? liveQuote.gasUsd : route.estGasUsd;
  const estBridgeFeeUsd = typeof liveQuote?.bridgeFeeUsd === 'number'
    ? liveQuote.bridgeFeeUsd
    : Math.max(route.minBridgeFeeUsd, capitalUsd * route.estBridgeFeeRate);

  // 3. Pool Slippage impact & Max Capacity
  // 必须看 Pair 真实储备构成！卖出腿必须有足够 Quote 现金 (USDC/USDT/WETH/SOL) 才能兑付，
  // 若卖出池现金储备极低（如 CAP 卖出池仅 $88.85 USDC），必须以单边真实储备限制冲击与容量
  const effectiveLiq = Math.max(minLiquidityUsd || 10000, 1000);
  const effectiveSellCash = (typeof sellQuoteReserveUsd === 'number' && sellQuoteReserveUsd > 0)
    ? sellQuoteReserveUsd
    : (effectiveLiq / 2);
  const effectiveBuyTokens = (typeof buyBaseReserveUsd === 'number' && buyBaseReserveUsd > 0)
    ? buyBaseReserveUsd
    : (effectiveLiq / 2);
  const singleSideReserve = Math.min(effectiveSellCash, effectiveBuyTokens);

  // 冲击率 = 投入本金 / 单边可承兑储备
  const isDrained = capitalUsd > singleSideReserve;
  const poolImpactPct = isDrained 
    ? 99.9 
    : Math.min(99.9, (capitalUsd / singleSideReserve) * 100);

  // 滑点 = 冲击率 / 2 + 基础磨损 0.05% (若池子已被击穿/单边抽干，滑点达 90%+)
  const slippagePct = isDrained
    ? Math.min(95, Math.max(80, (1 - (singleSideReserve / capitalUsd)) * 100))
    : Math.min(25, Math.max(0.05, (poolImpactPct / 2) + 0.05));
  const estSlippageUsd = capitalUsd * (slippagePct / 100);

  // 建议单笔最大安全容量：单边储备的 4%，且绝不超过卖出端现金储备的 10%
  const maxSafeCapacityUsd = Math.max(0, Math.floor(Math.min(effectiveLiq * 0.02, effectiveSellCash * 0.1)));

  // 动态评级：对比当前本金与池子冲击率
  let liquidityHealth: 'safe' | 'moderate' | 'dangerous' = 'safe';
  if (poolImpactPct > 5 || isDrained || effectiveSellCash < 500) {
    liquidityHealth = 'dangerous';
  } else if (poolImpactPct > 2) {
    liquidityHealth = 'moderate';
  }

  // 4. Net Profit & ROI
  const estTotalCostUsd = estGasUsd + estBridgeFeeUsd + estSlippageUsd;
  const netProfitUsd = grossProfitUsd - estTotalCostUsd;
  const netRoiPct = (netProfitUsd / capitalUsd) * 100;

  // 5. Arbitrage Viability 100-point Composite Score (0~100)
  // 维度1: 净收益空间 (0~40分)
  let profitScore = 0;
  if (netRoiPct >= 5) profitScore += 30;
  else if (netRoiPct >= 3) profitScore += 25;
  else if (netRoiPct >= 1.5) profitScore += 18;
  else if (netRoiPct >= 0.5) profitScore += 10;
  else if (netRoiPct > 0) profitScore += 5;

  if (netProfitUsd >= 50) profitScore += 10;
  else if (netProfitUsd >= 20) profitScore += 7;
  else if (netProfitUsd >= 5) profitScore += 4;
  else if (netProfitUsd > 0) profitScore += 2;

  // 维度2: 真实流动性与现金储备 (0~30分)
  let liquidityScore = 0;
  if (effectiveLiq >= 100000) liquidityScore += 15;
  else if (effectiveLiq >= 30000) liquidityScore += 12;
  else if (effectiveLiq >= 10000) liquidityScore += 9;
  else if (effectiveLiq >= 3000) liquidityScore += 5;
  else liquidityScore += 2;

  if (effectiveSellCash >= 30000) liquidityScore += 15;
  else if (effectiveSellCash >= 10000) liquidityScore += 12;
  else if (effectiveSellCash >= 3000) liquidityScore += 8;
  else if (effectiveSellCash >= 1000) liquidityScore += 4;

  // 维度3: 跨链通道速度与稳定性 (0~20分)
  let bridgeScore = 0;
  bridgeScore += (liveQuote && liveQuote.isLiveQuote) ? 12 : 6;
  const etaSec = liveQuote?.etaSeconds || (route.etaMinutes * 60);
  if (etaSec <= 60) bridgeScore += 8;
  else if (etaSec <= 180) bridgeScore += 5;
  else bridgeScore += 2;

  // 维度4: 市场活跃度底分 (10分)
  const volumeScore = 10;

  // 扣分惩罚项：智能合约貔貅、卖出池现金枯竭、极端滑点冲击、净亏损
  let penalty = 0;
  if (security?.isHoneypot || security?.riskLevel === 'danger') {
    penalty += 60;
  } else if (security?.riskLevel === 'warning') {
    penalty += 20;
  }

  if (isDrained || effectiveSellCash < 500) penalty += 50; // 现金枯竭
  else if (liquidityHealth === 'dangerous') penalty += 25;
  else if (liquidityHealth === 'moderate') penalty += 10;

  if (netProfitUsd <= 0) penalty += 30; // 净亏损惩罚

  const rawScore = profitScore + liquidityScore + bridgeScore + volumeScore - penalty;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const scoreGrade: 'S' | 'A' | 'B' | 'C' | 'D' = score >= 85 ? 'S' : (score >= 70 ? 'A' : (score >= 50 ? 'B' : (score >= 25 ? 'C' : 'D')));

  let scoreComment = '普通机会';
  if (security?.isHoneypot || security?.riskLevel === 'danger') {
    scoreComment = `高危 · ${security.riskReason || '智能合约貔貅 (无法卖出或恶意税率)'}`;
  } else if (isDrained || effectiveSellCash < 500) {
    scoreComment = '高危 · 卖出池现金枯竭';
  } else if (score >= 85) {
    scoreComment = '极佳机会 · 净利与池深兼备';
  } else if (score >= 70) {
    scoreComment = '优质机会 · 深度良好';
  } else if (score >= 50) {
    scoreComment = '可行 · 容量有限需控单';
  } else if (security?.riskLevel === 'warning') {
    scoreComment = `警惕 · ${security.riskReason || '存在代币税/限制'}`;
  } else if (netProfitUsd <= 0) {
    scoreComment = '亏损 · 摩擦成本大于利差';
  } else {
    scoreComment = '高风险 · 冲击过大深度过浅';
  }

  const scoreBreakdown: ArbScoreBreakdown = {
    profitScore,
    liquidityScore,
    bridgeScore,
    volumeScore,
    penalty,
  };

  return {
    capitalUsd,
    tokensBought,
    grossRevenueUsd,
    grossProfitUsd,
    estGasUsd,
    estBridgeFeeUsd,
    estSlippageUsd,
    estTotalCostUsd,
    netProfitUsd,
    netRoiPct,
    isProfitable: netProfitUsd > 0,
    priceDelta,
    slippagePct,
    poolImpactPct,
    maxSafeCapacityUsd,
    liquidityHealth,
    token1kCost,
    token1kRevenue,
    token1kProfit,
    route,
    isLiveQuote: !!liveQuote?.isLiveQuote,
    liveQuoteData: liveQuote || undefined,
    score,
    scoreGrade,
    scoreBreakdown,
    scoreComment,
  };
}
