'use strict';
const net = require('./net');
const { addressKey } = require('./amounts');
const SETTLEMENT = {
  ethereum: { chainId: 1, symbol: 'USDC', decimals: 6, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  base: { chainId: 8453, symbol: 'USDC', decimals: 6, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  arbitrum: { chainId: 42161, symbol: 'USDC', decimals: 6, address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
  optimism: { chainId: 10, symbol: 'USDC', decimals: 6, address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' },
  polygon: { chainId: 137, symbol: 'USDC', decimals: 6, address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
  avalanche: { chainId: 43114, symbol: 'USDC', decimals: 6, address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' },
  bsc: { chainId: 56, symbol: 'USDT', decimals: 18, address: '0x55d398326f99059fF775485246999027B3197955' },
};
const RESEARCH_ADDRESS = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0';
function fail(code, message) { return Object.assign(new Error(message), { code }); }
let retryAt = 0;
function rateLimitError() { return Object.assign(fail('RATE_LIMITED', '报价服务限流，已暂停请求直到 ' + new Date(retryAt).toISOString()), { retryAt }); }
async function api(endpoint, params, settings) {
  if (Date.now() < retryAt) throw rateLimitError();
  if (process.env.RADAR_LIFI_DIRECT === '1') settings = { ...settings, useProxy: false };
  const key = String(settings?.keys?.lifi || process.env.LIFI_API_KEY || '').trim();
  const url = 'https://li.quest/v1/' + endpoint + '?' + new URLSearchParams(params);
  let r = await net.request(url, { settings, timeout: 12000, headers: key ? { 'x-lifi-api-key': key } : {} });
  if (key && [401, 403].includes(r.status)) {
    throw fail('INVALID_KEY', 'LI.FI API Key 鉴权失败 (HTTP ' + r.status + ')，请检查 Partner Portal 秘钥状态');
  }
  if (r.code === 'LOCAL_QUOTE_BUDGET') throw Object.assign(fail(r.code, r.error), { retryAt: r.retryAt });
  if (r.status === 429) {
    const seconds = typeof r.retryAfter === 'string' && /^\d+$/.test(r.retryAfter) ? Number(r.retryAfter) : NaN;
    const date = Date.parse(r.retryAfter || '');
    const hint = String(r.json?.message || '').match(/retry in\s+(\d+)\s*(second|minute|hour)/i);
    const hintMs = hint ? Number(hint[1]) * ({second:1000,minute:60000,hour:3600000}[hint[2].toLowerCase()]) : 60000;
    retryAt = Math.max(retryAt, Date.now() + 1000, Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Number.isFinite(date) ? date : Date.now() + hintMs);
    throw rateLimitError();
  }
  if (!r.ok && r.code) throw Object.assign(fail(r.code, r.error || '请求受保护策略限制'), { retryAt: r.retryAt });
  if (!r.ok) throw fail(r.status === 404 ? 'NO_ROUTE' : 'PROVIDER_ERROR', 'LI.FI HTTP ' + r.status + ': ' + String(r.json?.message || r.error || 'request failed').slice(0, 240));
  return r.json;
}
function matches(token, chainId, address) {
  return token && Number(token.chainId) === Number(chainId) && addressKey(token.address) === addressKey(address);
}
function decimalsOK(token) {
  return Number.isInteger(token?.decimals) && token.decimals >= 0 && token.decimals <= 36;
}
async function token(chainId, address, settings) {
  const t = await api('token', { chain: chainId, token: address }, settings);
  if (!matches(t, chainId, address) || !decimalsOK(t)) throw fail('TOKEN_MISMATCH', 'Token identity or decimals unavailable');
  return t;
}
function cost(value) {
  if (value === null || value === undefined || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) throw fail('UNKNOWN_COST', 'Missing gas/fee USD valuation');
  return Number(value);
}
function parseQuote(q, input, requestedAt, receivedAt = Date.now()) {
  const a = q?.action, e = q?.estimate;
  if (!a || !e || !matches(a.fromToken, input.from.chainId, input.from.address) ||
      !matches(a.toToken, input.to.chainId, input.to.address) ||
      Number(a.fromChainId) !== Number(input.from.chainId) || Number(a.toChainId) !== Number(input.to.chainId) ||
      a.fromToken.decimals !== input.from.decimals || a.toToken.decimals !== input.to.decimals ||
      String(a.fromAmount) !== String(input.amount)) throw fail('QUOTE_MISMATCH', 'Quote does not match requested assets, decimals, chains or size');
  for (const x of [e.toAmount, e.toAmountMin]) {
    if (!/^\d+$/.test(String(x)) || BigInt(x) <= 0n) throw fail('INVALID_OUTPUT', 'Missing positive output/minimum amount');
  }
  if (BigInt(e.toAmountMin) > BigInt(e.toAmount)) throw fail('INVALID_OUTPUT', 'Minimum output exceeds expected output');
  if (!Array.isArray(e.gasCosts) || !e.gasCosts.length || !Array.isArray(e.feeCosts)) throw fail('UNKNOWN_COST', 'Quote has no complete gas/fee breakdown');
  const gasUsd = e.gasCosts.reduce((s, g) => s + cost(g.amountUSD), 0);
  let externalFeeUsd = 0, includedFeeUsd = 0;
  for (const f of e.feeCosts) {
    if (typeof f.included !== 'boolean') throw fail('UNKNOWN_COST', 'Fee inclusion is unknown');
    const usd = cost(f.amountUSD);
    if (f.included) includedFeeUsd += usd; else externalFeeUsd += usd;
  }
  const etaSeconds = Number(e.executionDuration);
  if (!Number.isFinite(etaSeconds) || etaSeconds < 0) throw fail('UNKNOWN_DURATION', 'Route duration unavailable');
  // Never retain transactionRequest, calldata, approvals or a signing payload.
  return { id: q.id || null, tool: q.toolDetails?.name || q.tool || 'LI.FI',
    from: input.from, to: input.to, fromAmount: String(input.amount),
    toAmount: String(e.toAmount), toAmountMin: String(e.toAmountMin),
    gasUsd, externalFeeUsd, includedFeeUsd, etaSeconds, requestedAt, receivedAt,
    steps: (q.includedSteps || []).map(s => ({ type: s.type, tool: s.tool })) };
}
async function quote(input, settings) {
  const requestedAt = Date.now();
  const q = await api('quote', { fromChain: input.from.chainId, toChain: input.to.chainId,
    fromToken: input.from.address, toToken: input.to.address, fromAmount: input.amount,
    fromAddress: RESEARCH_ADDRESS, toAddress: RESEARCH_ADDRESS, slippage: '0.003', order: 'CHEAPEST' }, settings);
  return parseQuote(q, input, requestedAt);
}
module.exports = { SETTLEMENT, token, quote, parseQuote, matches, fail };
