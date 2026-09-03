'use strict';
const { request } = require('../net');
const chains = require('../chains');

// Range（原 Range Protocol，覆盖 5 大桥的综合浏览器）：需要 API Key。
const API = 'https://api.range.org/v1/transfers';

function key(v) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return chains.keyOf('evm', n) || String(v);
  const s = String(v).toLowerCase();
  return chains.keyOf('ds', s) || chains.keyOf('db', s) || s;
}

function normalize(t) {
  return {
    source: 'range',
    txHash: t.tx_hash || t.txHash || t.hash || t.id,
    fromChain: key(t.source_chain ?? t.from_chain ?? t.srcChain ?? t.originChain),
    toChain: key(t.destination_chain ?? t.to_chain ?? t.dstChain ?? t.destinationChain),
    fromChainRaw: t.source_chain ?? t.from_chain ?? null,
    toChainRaw: t.destination_chain ?? t.to_chain ?? null,
    tokenChain: null,
    sender: t.sender || t.from_address || t.from || t.sender_address || null,
    receiver: t.recipient || t.to_address || t.to || t.receiver_address || null,
    tokenAddress: t.token_address || t.tokenAddress || t.asset_address || null,
    tokenSymbol: t.symbol || t.token_symbol || t.asset_symbol || null,
    amount: Number(t.amount ?? t.value ?? t.amount_formatted) || null,
    amountUsd: Number(t.usd_amount ?? t.amount_usd ?? t.valueUsd) || null,
    timestamp: (() => {
      const ts = t.timestamp ?? t.block_timestamp ?? t.created_at;
      if (!ts) return null;
      const n = Number(ts);
      const ms = n > 1e11 ? n : (Number.isFinite(n) ? n * 1000 : Date.parse(ts));
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    })(),
    app: t.bridge || t.protocol || t.provider || null,
  };
}

async function fetchTransfers(ctx) {
  const keyStr = ctx.settings.keys?.range;
  if (!keyStr) return { ok: false, error: '未填写 Range API Key', transfers: [] };
  const endpoint = ctx.settings.endpoints?.range || API;
  const res = await request(`${endpoint}?limit=${ctx.limit || 100}`, {
    settings: ctx.settings, timeout: 20000,
    headers: { Authorization: `Bearer ${keyStr}`, 'x-api-key': keyStr },
  });
  if (!res.ok || !res.json) return { ok: false, error: res.error || ('HTTP ' + res.status), transfers: [] };
  const list = Array.isArray(res.json) ? res.json : (res.json.transfers || res.json.data || res.json.transactions || []);
  return { ok: true, transfers: list.map(normalize) };
}

module.exports = {
  id: 'range',
  name: 'Range Explorer',
  siteUrl: 'https://range.org',
  needsKey: true,
  note: '需官方 API Key；免费注册申请入口 app.range.org → Settings → API（app.range.org/keys），覆盖多桥聚合',
  fetchTransfers,
};
