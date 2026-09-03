'use strict';
const { request } = require('../net');
const chains = require('../chains');

// Wormholescan 公开 API，无需 Key，实测可用。
const API = 'https://api.wormholescan.io/api/v1/transactions';

function num(v, fallback = null) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalize(t) {
  const sp = t.standardizedProperties || {};
  const tokenChain = chains.keyOf('wh', sp.tokenChain ?? t.emitterChain);
  const fromChain = chains.keyOf('wh', sp.fromChain ?? t.emitterChain);
  const toChain = chains.keyOf('wh', sp.toChain);
  const payload = t.payload || {};
  const rawAmount = num(sp.amount, null);
  const decimals = num(sp.normalizedDecimals, null);
  // standardizedProperties.amount 已经是归一化后的整数字符串，需要除以 10^normalizedDecimals
  const amount = rawAmount != null && decimals != null ? rawAmount / 10 ** decimals : num(t.tokenAmount, null);

  const stripPrefix = (v) => (typeof v === 'string' && v.includes(':') ? v.split(':').slice(1).join(':') : v);
  return {
    source: 'wormhole',
    txHash: t.txHash || t.id,
    fromChain, toChain, tokenChain,
    fromChainRaw: sp.fromChain ?? t.emitterChain ?? null,
    toChainRaw: sp.toChain ?? null,
    sender: sp.fromAddress || stripPrefix(payload.sender) || t.globalTx?.originTx?.from || null,
    receiver: sp.toAddress || stripPrefix(payload.recipient) || null,
    tokenAddress: sp.tokenAddress || stripPrefix(payload.tokenAddress) || null,
    tokenSymbol: t.symbol || null,
    amount,
    amountUsd: num(t.usdAmount, null),
    timestamp: t.timestamp ? new Date(t.timestamp).toISOString() : null,
    app: (sp.appIds || []).join(','),
    explorer: (t.txHash ? chains.txUrl(chains.keyOf('wh', t.emitterChain) || fromChain, t.txHash) : null),
  };
}

async function fetchTransfers(ctx) {
  const limit = Math.min(ctx.limit || 200, 500);
  const perPage = 100;
  const pages = Math.max(1, Math.ceil(limit / perPage));
  const out = [];
  let firstError = null;
  // 分批并发：串行翻页时只要有一页超时就会中断回溯，并发既快又不会因单页失败丢掉整批
  const BATCH = 5;
  for (let start = 0; start < pages; start += BATCH) {
    const batch = [];
    for (let p = start; p < Math.min(start + BATCH, pages); p++) batch.push(p);
    const results = await Promise.all(batch.map((p) =>
      request(`${API}?page=${p}&pageSize=${perPage}`, { settings: ctx.settings, timeout: 30000 })
        .catch((e) => ({ ok: false, error: e.message }))
    ));
    let reachedEnd = false;
    results.forEach((res) => {
      if (!res.ok || !res.json || !Array.isArray(res.json.transactions)) {
        if (!firstError) firstError = res.error || ('HTTP ' + res.status);
        return;
      }
      if (res.json.transactions.length < perPage) reachedEnd = true;
      out.push(...res.json.transactions.map(normalize));
    });
    if (reachedEnd) break;
  }
  if (!out.length) return { ok: false, error: firstError || '未取到数据', transfers: [] };
  const since = ctx.since ? new Date(ctx.since).getTime() : 0;
  return { ok: true, transfers: out.filter((t) => !t.timestamp || new Date(t.timestamp).getTime() >= since), partialError: firstError };
}

module.exports = {
  id: 'wormhole',
  name: 'Wormholescan',
  siteUrl: 'https://wormholescan.io',
  needsKey: false,
  note: '公开 API，无需 Key，开箱即用',
  fetchTransfers,
};
