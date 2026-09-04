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
    };
  }
}

module.exports = ArbDetector;
