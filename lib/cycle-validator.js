'use strict';
const lifi = require('./lifi-readonly');
const { toUnits, fromUnits } = require('./amounts');
const DEFAULTS = { budgetUsd: 500, gasReserveUsd: 50, amountUsd: 100, minNetUsd: 2, extraCostBufferUsd: 1, maxQuoteWindowMs: 60000 };
async function validateCycle(params, settings = {}, deps = {}) {
  const provider = deps.provider || lifi;
  const now = deps.now || Date.now;
  const startedAt = now();
  const report = { id: require('crypto').randomUUID(), mode: 'paper', executable: false, realizedPnlUsd: null,
    symbol: String(params.symbol || ''), buyChain: params.buyChain, sellChain: params.sellChain,
    buyAddress: params.buyAddress, sellAddress: params.sellAddress,
    startedAt, amountUsd: Number(params.amountUsd ?? DEFAULTS.amountUsd), legs: [], blockers: [],
    assumptions: { ...DEFAULTS, address: 'public research address; wallet balances and approvals not checked',
      slippage: 0.003, futurePricesLocked: false },
    limitations: ['Sequential cross-chain quotes are not atomic or locked through bridge arrival.',
      'Quote replay is not an on-chain simulation or a filled trade.',
      'Security, wallet balances, approvals, bridge limits and gas must be checked before a user signs.'] };
  let stage = 'input';
  try {
    const s1 = lifi.SETTLEMENT[params.buyChain], s2 = lifi.SETTLEMENT[params.sellChain];
    if (!s1 || !s2 || params.buyChain === params.sellChain) throw lifi.fail('UNSUPPORTED_ROUTE', '当前验证支持已配置的两条不同 EVM 链');
    for (const addr of [params.buyAddress, params.sellAddress]) if (!/^0x[0-9a-f]{40}$/i.test(addr || '')) throw lifi.fail('INVALID_ADDRESS', '需要两端准确的 EVM 合约地址');
    const amount = report.amountUsd;
    if (!Number.isFinite(amount) || amount < 5 || amount > DEFAULTS.budgetUsd - DEFAULTS.gasReserveUsd) throw lifi.fail('BUDGET_LIMIT', '单次试算金额须在 $5–$450，预算 $500 中留 $50 费用余额');
    stage = 'metadata';
    deps.onStage?.(stage);
    const [cashA, assetA, assetB, cashB] = await Promise.all([
      provider.token(s1.chainId, s1.address, settings), provider.token(s1.chainId, params.buyAddress, settings),
      provider.token(s2.chainId, params.sellAddress, settings), provider.token(s2.chainId, s2.address, settings),
    ]);
    // Validate settlement configuration and USD conversion; do not assume stablecoins are exactly $1.
    if (cashA.decimals !== s1.decimals || cashB.decimals !== s2.decimals) throw lifi.fail('TOKEN_MISMATCH', 'Settlement decimals mismatch');
    const cashPrice = Number(cashA.priceUSD);
    if (!Number.isFinite(cashPrice) || cashPrice < 0.98 || cashPrice > 1.02) throw lifi.fail('SETTLEMENT_PRICE', '结算币价格缺失或明显偏离 $1');
    const initialUnits = toUnits((amount / cashPrice).toFixed(Math.min(cashA.decimals, 8)), cashA.decimals);
    report.settlement = { symbol: cashA.symbol, chain: params.buyChain, address: cashA.address, priceUSD: cashPrice };
    report.initialAmount = initialUnits;
    const steps = [
      ['buy', cashA, assetA], ['bridge_asset', assetA, assetB],
      ['sell', assetB, cashB], ['return_cash', cashB, cashA],
    ];
    let units = initialUnits;
    for (const [name, from, to] of steps) {
      stage = name;
      deps.onStage?.(stage);
      const q = await provider.quote({ from, to, amount: units }, settings);
      report.legs.push({ ...q, name });
      units = q.toAmountMin; // Each following leg spends only the preceding minimum output.
    }
    const finishedAt = now();
    const gasUsd = report.legs.reduce((s, q) => s + q.gasUsd, 0);
    const externalFeeUsd = report.legs.reduce((s, q) => s + q.externalFeeUsd, 0);
    const initialUsd = Number(fromUnits(initialUnits, cashA.decimals)) * cashPrice;
    const finalUsd = Number(fromUnits(units, cashA.decimals)) * cashPrice;
    const netUsd = finalUsd - initialUsd - gasUsd - externalFeeUsd - DEFAULTS.extraCostBufferUsd;
    const requiredCapitalUsd = initialUsd + gasUsd + externalFeeUsd + DEFAULTS.extraCostBufferUsd;
    const quoteWindowMs = finishedAt - Math.min(...report.legs.map(q => q.requestedAt));
    const etaSeconds = report.legs.reduce((s, q) => s + q.etaSeconds, 0);
    report.result = { initialUsd, finalUsd, finalAmount: units, gasUsd, externalFeeUsd,
      extraCostBufferUsd: DEFAULTS.extraCostBufferUsd, netUsd, requiredCapitalUsd, etaSeconds, quoteWindowMs,
      includedFeesUsd: report.legs.reduce((s, q) => s + q.includedFeeUsd, 0) };
    if (quoteWindowMs > DEFAULTS.maxQuoteWindowMs) report.blockers.push({ code: 'QUOTE_WINDOW', message: '询价跨度超过 60 秒，无法视为同步快照' });
    if (requiredCapitalUsd > DEFAULTS.budgetUsd) report.blockers.push({ code: 'BUDGET_LIMIT', message: '本金加费用超过 $500' });
    if (netUsd < DEFAULTS.minNetUsd) report.blockers.push({ code: 'NET_BELOW_TARGET', message: '四段报价扣费后不足 $2' });
    report.status = report.blockers.length ? 'REJECTED' : 'POSITIVE_INDICATION';
    report.ok = true;
    report.validUntil = Math.min(...report.legs.map(q => q.requestedAt)) + DEFAULTS.maxQuoteWindowMs;
    report.nextCheckAfter = finishedAt + Math.max(60000, etaSeconds * 1000);
  } catch (e) {
    report.ok = false;
    report.status = 'BLOCKED';
    report.blockers.push({ stage, code: e.code || 'VALIDATION_ERROR', message: e.message, ...(e.retryAt ? { retryAt: e.retryAt } : {}) });
  }
  report.finishedAt = now();
  return report;
}
module.exports = { validateCycle, DEFAULTS };
