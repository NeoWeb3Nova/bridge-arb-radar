'use strict';
const chains = require('./chains');

/**
 * 跨链套利检测与最佳路径评估器
 */
class ArbDetector {
  /**
   * 判断一个报价是否属于受信任/已验证来源
   * @param {Object} q
   * @returns {boolean}
   */
  static isTrustedQuote(q) {
    return (q.verdict === 'official' || q.verdict === 'confirmed')
      || (!q.heuristic && q.verdict !== 'suspicious' && q.verdict !== 'fake');
  }

  /**
   * 将单腿裁决结果统一归类为三态：confirmed / suspicious / fake
   * @param {Object} q
   * @returns {'confirmed' | 'suspicious' | 'fake'}
   */
  static legVerdict(q) {
    if (q.verdict === 'official' || q.verdict === 'confirmed') return 'confirmed';
    if (q.verdict === 'fake') return 'fake';
    return 'suspicious';
  }

  /**
   * 从多个链的报价列表中挑选最佳买卖套利腿并计算价差与假币裁决
   * @param {Object} params
   * @param {string} params.symbol 代币符号
   * @param {Array} params.quotes 全部报价
   * @param {string} [params.tokenKey]
   * @param {number} [params.maxHeuristicSpreadPct=25]
   * @returns {Object|null} best 套利机会对象
   */
  static evaluateBestOpportunity({ symbol, quotes, tokenKey, maxHeuristicSpreadPct = 25 }) {
    const all = quotes || [];
    const trusted = all.filter((q) => ArbDetector.isTrustedQuote(q));
    const heuristics = all.filter((q) => !ArbDetector.isTrustedQuote(q) && q.verdict !== 'fake');
    const pool = trusted.length >= 2 ? trusted : [...trusted, ...heuristics];

    if (pool.length < 2) return null;

    // 在跨链候选池中寻找价差最大的不同链买卖腿 (low, high)
    let bestPair = null;
    let maxSpread = -Infinity;

    for (const buy of pool) {
      if (!buy || !buy.priceUsd || buy.priceUsd <= 0) continue;
      for (const sell of pool) {
        if (!sell || !sell.priceUsd || buy.chain === sell.chain || sell.priceUsd <= buy.priceUsd) continue;
        const spread = ((sell.priceUsd - buy.priceUsd) / buy.priceUsd) * 100;
        if (spread > maxSpread) {
          maxSpread = spread;
          bestPair = { low: buy, high: sell, spreadPct: spread };
        }
      }
    }

    if (!bestPair) return null;
    const { low, high, spreadPct } = bestPair;
    const anyUnverified = !ArbDetector.isTrustedQuote(low) || !ArbDetector.isTrustedQuote(high);

    // 卖出池现金储备枯竭检测 (单边出水承兑不足)
    const sellCashDrain = (high.quoteReserveUsd !== undefined && high.quoteReserveUsd < 500) ||
                          (high.quoteRatio !== undefined && high.quoteRatio < 0.05);

    const suspicious = spreadPct > 100 || (anyUnverified && spreadPct > maxHeuristicSpreadPct) || sellCashDrain;

    const lowV = ArbDetector.legVerdict(low);
    const highV = ArbDetector.legVerdict(high);

    let verdict = (lowV === 'fake' || highV === 'fake')
      ? 'fake'
      : ((lowV === 'suspicious' || highV === 'suspicious') ? 'suspicious' : 'confirmed');

    // 若卖出池现金储备极度枯竭 (< $150)，无论代币如何真实，该池均无法真实兑付，标为 fake / suspicious
    if (high.quoteReserveUsd !== undefined && high.quoteReserveUsd < 150) {
      verdict = 'fake';
    } else if (sellCashDrain && verdict === 'confirmed') {
      verdict = 'suspicious';
    }

    return {
      suspicious,
      verdict,
      symbol,
      buyChain: low.chain,
      buyChainName: chains.label(low.chain),
      buyPrice: low.priceUsd,
      buyDex: low.dex,
      buyUrl: low.pairUrl,
      buyAddress: low.tokenAddress || null,
      buyExplorer: chains.tokenUrl(low.chain, low.tokenAddress),
      buyVerdict: lowV,
      sellChain: high.chain,
      sellChainName: chains.label(high.chain),
      sellPrice: high.priceUsd,
      sellDex: high.dex,
      sellUrl: high.pairUrl,
      sellAddress: high.tokenAddress || null,
      sellExplorer: chains.tokenUrl(high.chain, high.tokenAddress),
      sellVerdict: highV,
      spreadPct: Number(spreadPct.toFixed(3)),
      buyLiquidityUsd: Number((low.liquidityUsd || 0).toFixed(2)),
      sellLiquidityUsd: Number((high.liquidityUsd || 0).toFixed(2)),
      minLiquidityUsd: Number((Math.min(low.liquidityUsd || 0, high.liquidityUsd || 0)).toFixed(2)),
      
      // 双端资产池储备构成 (Base 代币存量 vs Quote 现金储备)
      buyBaseReserveUsd: low.baseReserveUsd !== undefined ? Number(low.baseReserveUsd.toFixed(2)) : undefined,
      buyQuoteReserveUsd: low.quoteReserveUsd !== undefined ? Number(low.quoteReserveUsd.toFixed(2)) : undefined,
      buyQuoteSymbol: low.quoteToken || null,
      buyQuoteRatio: low.quoteRatio !== undefined ? Number(low.quoteRatio.toFixed(4)) : undefined,

      sellBaseReserveUsd: high.baseReserveUsd !== undefined ? Number(high.baseReserveUsd.toFixed(2)) : undefined,
      sellQuoteReserveUsd: high.quoteReserveUsd !== undefined ? Number(high.quoteReserveUsd.toFixed(2)) : undefined,
      sellQuoteSymbol: high.quoteToken || null,
      sellQuoteRatio: high.quoteRatio !== undefined ? Number(high.quoteRatio.toFixed(4)) : undefined,

      poolSkewed: sellCashDrain,

      buyVolume24h: Number((low.volume24h || 0).toFixed(2)),
      sellVolume24h: Number((high.volume24h || 0).toFixed(2)),
      minVolume24h: Number((Math.min(low.volume24h || 0, high.volume24h || 0)).toFixed(2)),
      buyVolume6h: Number((low.volume6h || 0).toFixed(2)),
      sellVolume6h: Number((high.volume6h || 0).toFixed(2)),
      minVolume6h: Number((Math.min(low.volume6h || 0, high.volume6h || 0)).toFixed(2)),
      buyTxns24h: low.txns24h || 0,
      sellTxns24h: high.txns24h || 0,
      heuristic: anyUnverified,
      verified: !anyUnverified,
      tokenKey: tokenKey || null,
      ...ArbDetector.calculateOpportunityScore({
        spreadPct,
        minLiquidityUsd: Math.min(low.liquidityUsd || 0, high.liquidityUsd || 0),
        sellQuoteReserveUsd: high.quoteReserveUsd,
        poolSkewed: sellCashDrain,
        verdict,
        suspicious,
        buyChain: low.chain,
        sellChain: high.chain,
        minVolume24h: Math.min(low.volume24h || 0, high.volume24h || 0),
      })
    };
  }

  /**
   * 计算套利机会的可行性百分制综合打分 (0~100)
   * 4 大核心维度：净收益空间(40) + 流动性与真实储备(30) + 跨链通道(20) + 市场交易活跃度(10)
   * @param {Object} opp
   * @returns {{ qualityScore: number, qualityGrade: 'S'|'A'|'B'|'C'|'D', scoreComment: string }}
   */
  static calculateOpportunityScore(opp) {
    if (!opp) return { qualityScore: 0, qualityGrade: 'D', scoreComment: '无有效数据' };
    let score = 0;
    let penalty = 0;

    // 1. 价差收益空间 (满分 40分)
    const spread = opp.spreadPct || 0;
    if (spread >= 15) score += 38;
    else if (spread >= 8) score += 32;
    else if (spread >= 4) score += 26;
    else if (spread >= 2) score += 18;
    else if (spread >= 1) score += 10;
    else if (spread > 0) score += 5;

    // 2. 流动性与现金储备安全度 (满分 30分)
    const minLiq = opp.minLiquidityUsd || 0;
    if (minLiq >= 100000) score += 15;
    else if (minLiq >= 30000) score += 12;
    else if (minLiq >= 10000) score += 9;
    else if (minLiq >= 3000) score += 5;
    else score += 2;

    const sellCash = opp.sellQuoteReserveUsd !== undefined ? opp.sellQuoteReserveUsd : (minLiq * 0.5);
    if (sellCash >= 30000) score += 15;
    else if (sellCash >= 10000) score += 12;
    else if (sellCash >= 3000) score += 8;
    else if (sellCash >= 1000) score += 4;

    // 卖出池现金枯竭严重惩罚 (假单币池)
    if (opp.poolSkewed || (opp.sellQuoteReserveUsd !== undefined && opp.sellQuoteReserveUsd < 500)) {
      penalty += 45;
    }
    // 貔貅假币与恶意智能合约严厉惩罚
    if (opp.security?.isHoneypot || opp.security?.riskLevel === 'danger') {
      penalty += 60;
    } else if (opp.security?.riskLevel === 'warning') {
      penalty += 20;
    }
    // 假币或可疑代币惩罚
    if (opp.verdict === 'fake') {
      penalty += 60;
    } else if (opp.verdict === 'suspicious' || opp.suspicious) {
      penalty += 25;
    }

    // 3. 跨链通道执行预估 (满分 20分)
    const isL2 = ['arbitrum', 'base', 'optimism', 'polygon'].includes(opp.buyChain) && ['arbitrum', 'base', 'optimism', 'polygon'].includes(opp.sellChain);
    const hasEth = opp.buyChain === 'ethereum' || opp.sellChain === 'ethereum';
    if (isL2) score += 18; // 极速低费通道
    else if (!hasEth) score += 14;
    else score += 8; // 以太坊高 Gas 摩擦

    // 4. 市场活跃度 (满分 10分)
    const minVol24h = opp.minVolume24h || 0;
    if (minVol24h >= 50000) score += 10;
    else if (minVol24h >= 10000) score += 7;
    else if (minVol24h >= 2000) score += 4;
    else if (minVol24h >= 500) score += 2;

    const finalScore = Math.max(0, Math.min(100, Math.round(score - penalty)));
    const qualityGrade = finalScore >= 85 ? 'S' : (finalScore >= 70 ? 'A' : (finalScore >= 50 ? 'B' : (finalScore >= 25 ? 'C' : 'D')));

    let scoreComment = '普通机会';
    if (opp.security?.isHoneypot || opp.security?.riskLevel === 'danger') {
      scoreComment = `高危 · ${opp.security.riskReason || '智能合约貔貅 (无法卖出或恶意税率)'}`;
    } else if (opp.poolSkewed || (opp.sellQuoteReserveUsd !== undefined && opp.sellQuoteReserveUsd < 500)) {
      scoreComment = '高危 · 卖出池真实现金枯竭';
    } else if (finalScore >= 85) {
      scoreComment = '极佳机会 · 深度与净利俱佳';
    } else if (finalScore >= 70) {
      scoreComment = '优质机会 · 流动性良好';
    } else if (finalScore >= 50) {
      scoreComment = '可行 · 容量有限需控单';
    } else if (opp.security?.riskLevel === 'warning') {
      scoreComment = `警惕 · ${opp.security.riskReason || '存在交易税/限制'}`;
    } else if (finalScore >= 25) {
      scoreComment = '次优 · 利润受摩擦损耗';
    } else {
      scoreComment = '高风险 · 疑假币或深度过浅';
    }

    return { qualityScore: finalScore, qualityGrade, scoreComment };
  }
}

module.exports = ArbDetector;
