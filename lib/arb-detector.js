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

    const sorted = [...pool].sort((a, b) => a.priceUsd - b.priceUsd);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];

    if (!low || !high || low.priceUsd <= 0 || high.chain === low.chain) {
      return null;
    }

    const spreadPct = ((high.priceUsd - low.priceUsd) / low.priceUsd) * 100;
    const anyUnverified = !ArbDetector.isTrustedQuote(low) || !ArbDetector.isTrustedQuote(high);
    const suspicious = spreadPct > 100 || (anyUnverified && spreadPct > maxHeuristicSpreadPct);

    const lowV = ArbDetector.legVerdict(low);
    const highV = ArbDetector.legVerdict(high);

    const verdict = (lowV === 'fake' || highV === 'fake')
      ? 'fake'
      : ((lowV === 'suspicious' || highV === 'suspicious') ? 'suspicious' : 'confirmed');

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
      minLiquidityUsd: Math.min(low.liquidityUsd, high.liquidityUsd),
      heuristic: anyUnverified,
      verified: !anyUnverified,
      tokenKey: tokenKey || null,
    };
  }
}

module.exports = ArbDetector;
