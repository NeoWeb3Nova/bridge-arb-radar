'use strict';
// Compatibility API: an actual token quote only. A stablecoin channel cannot prove this token is bridgeable.
const provider = require('./lifi-readonly');
const { toUnits } = require('./amounts');
const chains = require('./chains');
const store = require('./store');
async function getLiveQuote(params) {
  const { buyChain, sellChain, buyAddress, sellAddress } = params;
  const c1 = chains.get(buyChain)?.evm, c2 = chains.get(sellChain)?.evm;
  try {
    if (!c1 || !c2 || !buyAddress || !sellAddress) throw new Error('需要两端 EVM 合约与可询价链');
    const settings = store.settings();
    const [from, to] = await Promise.all([provider.token(c1, buyAddress, settings), provider.token(c2, sellAddress, settings)]);
    const amount = Number(params.tokenAmount) > 0 ? Number(params.tokenAmount) : Number(params.amountUsd) / Number(params.tokenPrice);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('缺少真实代币数量或价格');
    const q = await provider.quote({ from, to, amount: toUnits(amount.toFixed(Math.min(from.decimals, 18)), from.decimals) }, settings);
    return { ok: true, executable: false, isLiveQuote: true, isDirectTokenRoute: true,
      source: 'lifi_direct', bridgeName: q.tool, bridgeUrl: 'https://jumper.exchange/',
      etaSeconds: q.etaSeconds, gasUsd: q.gasUsd, bridgeFeeUsd: q.includedFeeUsd + q.externalFeeUsd,
      totalFeeUsd: q.gasUsd + q.includedFeeUsd + q.externalFeeUsd,
      toAmount: q.toAmount, toAmountMin: q.toAmountMin, decimals: to.decimals,
      ttlSeconds: 15, updatedAt: q.receivedAt, expiresAt: q.requestedAt + 15000,
      details: { note: '仅验证代币段可报价；不含买入、卖出和资金回流，不代表套利净利润。' } };
  } catch (e) {
    return { ok: false, executable: false, isLiveQuote: false, isDirectTokenRoute: false, source: 'unavailable',
      bridgeName: '未验证通道', bridgeUrl: 'https://jumper.exchange/', gasUsd: null, bridgeFeeUsd: null,
      totalFeeUsd: null, etaSeconds: null, error: e.message,
      details: { note: '目标代币询价失败，不能用稳定币通道或固定 Gas 代替。' } };
  }
}
module.exports = { getLiveQuote, STANDARD_SETTLEMENT: provider.SETTLEMENT };
