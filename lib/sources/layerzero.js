'use strict';
const { request } = require('../net');
const chains = require('../chains');

// LayerZero 官方 Scan API：免 Key、公开、直连可用。
// 注意域名：官方 API 是 scan.layerzero-api.com（免 Key、无 Vercel 拦截）；
// 社区浏览器 api.layerzeroscan.com 才是被 Vercel Security Checkpoint 挡的那个，别搞混。
const API = 'https://scan.layerzero-api.com/v1';

// LayerZero 链名 → 内部 chain key 的别名（只有命名与 chains.js 不一致的少数几条需要）。
const CHAIN_ALIAS = {
  bera: 'berachain',
  cronosevm: 'cronos',
};

function mapChain(name) {
  if (!name) return null;
  const k = String(name).toLowerCase();
  if (chains.get(k)) return k;           // 直接命中内部 key（ethereum/bsc/base/… 命名一致）
  return CHAIN_ALIAS[k] || k;            // 别名归一；未收录链保留原字符串（发现层可用，比价层自然跳过）
}

function num(v, fallback = null) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// OApp 展示名 → tokenSymbol。name 是 LayerZero 已识别的 OApp 标识（USDT0 / Stargate / Ethena…）。
function cleanSymbol(name) {
  if (!name) return null;
  const s = String(name).trim();
  if (!s || s.toLowerCase() === 'unknown') return null;
  return s;
}

function normalize(m) {
  const p = m.pathway || {};
  const senderOapp = p.sender || {};
  const receiverOapp = p.receiver || {};
  const srcTx = (m.source && m.source.tx) || {};
  const dstTx = (m.destination && m.destination.tx) || {};
  const fromChain = mapChain(senderOapp.chain);
  const toChain = mapChain(receiverOapp.chain);
  const name = senderOapp.name || senderOapp.id || null;
  const ts = num(srcTx.blockTimestamp, null);
  return {
    source: 'layerzero',
    txHash: srcTx.txHash || m.guid || null,
    dstTxHash: dstTx.txHash || null,
    fromChain,
    toChain,
    tokenChain: fromChain,
    fromChainRaw: senderOapp.chain || null,
    toChainRaw: receiverOapp.chain || null,
    sender: srcTx.from || null,            // 源链上调用 OApp 的 EOA —— 真正的「套利钱包」候选
    receiver: null,                        // 目标链 EOA 编码在 OFT payload 里，Scan 不直接给；避免把 OApp 合约误当钱包
    tokenAddress: senderOapp.address || null, // 源链 OApp/OFT 合约（链上事实锚点）
    tokenSymbol: cleanSymbol(name),
    amount: null,                          // OFT 数量编码在 payload 里，需另行解码
    amountUsd: null,
    timestamp: ts ? new Date(ts * 1000).toISOString() : (m.created || null),
    app: name,
    status: (m.status && m.status.name) || null,
    explorer: (srcTx.txHash && fromChain) ? chains.txUrl(fromChain, srcTx.txHash) : null,
  };
}

async function fetchTransfers(ctx) {
  const limit = Math.min(ctx.limit || 200, 1000);
  const out = [];
  let nextToken = null;
  let firstError = null;
  // latest 按时间倒序返回（每页约 100 条）；翻到 nextToken 空或凑够 limit 就停。
  const maxPages = Math.ceil(limit / 100);
  for (let i = 0; i < maxPages; i++) {
    const url = `${API}/messages/latest${nextToken ? '?nextToken=' + encodeURIComponent(nextToken) : ''}`;
    const res = await request(url, { settings: ctx.settings, timeout: 25000 });
    if (!res.ok || !res.json || !Array.isArray(res.json.data)) {
      firstError = res.error || ('HTTP ' + res.status);
      break;
    }
    out.push(...res.json.data.map(normalize));
    nextToken = res.json.nextToken;
    if (!nextToken || out.length >= limit) break;
  }
  if (!out.length) return { ok: false, error: firstError || '未取到数据', transfers: [] };
  const since = ctx.since ? new Date(ctx.since).getTime() : 0;
  return { ok: true, transfers: out.filter((t) => !t.timestamp || new Date(t.timestamp).getTime() >= since), partialError: firstError };
}

async function fetchWalletActivity(ctx, address, _chainKeys = [], limit = 100) {
  if (!address) return { ok: false, error: '缺少地址', activity: [] };
  const url = `${API}/messages/wallet/${encodeURIComponent(address)}?limit=${Math.min(limit || 100, 500)}`;
  const res = await request(url, { settings: ctx.settings, timeout: 25000 });
  if (!res.ok || !res.json || !Array.isArray(res.json.data)) {
    return { ok: false, error: res.error || ('HTTP ' + res.status), activity: [] };
  }
  const activity = res.json.data.map((m) => {
    const t = normalize(m);
    return {
      chain: t.fromChain,
      txHash: t.txHash,
      timestamp: t.timestamp,
      from: t.sender,
      to: null,
      direction: 'out',          // wallet 端点只返回该地址「发起」的跨链消息
      tokenAddress: t.tokenAddress,
      tokenSymbol: t.tokenSymbol,
      tokenName: t.app,
      amount: t.amount,
      status: t.status,
      toChain: t.toChain,
    };
  });
  return { ok: activity.length > 0, activity, errors: [] };
}

module.exports = {
  id: 'layerzero',
  name: 'LayerZero Scan',
  siteUrl: 'https://scan.layerzero-api.com/v1/swagger',
  needsKey: false,
  note: '官方公开 API，无需 Key，开箱即用（发现层 + 钱包追踪层）',
  fetchTransfers,
  fetchWalletActivity,
};
