'use strict';
const { request } = require('../net');

// Hyperlane 官方公开 GraphQL API（api.hyperlane.xyz/v1/graphql），免 Key、无需鉴权。
// message_view 表同时混有主网与测试网消息，且全表排序会触发 5s 超时，因此：
//   1. 必须带 send_occurred_at 时间窗过滤；
//   2. 用主网 domain id 白名单（_or: origin/destination 任一在列）过滤掉测试网与未登记链。
const ENDPOINT = 'https://api.hyperlane.xyz/v1/graphql';

// Hyperlane domain id → 内部链 key（只收录 chains.js 已登记的主网链）。
// 未登记的链（如 hyperevm/eni/各类新链）与测试网（basesepolia 等）自然被 _in 白名单挡掉。
const DOMAIN_TO_CHAIN = {
  1: 'ethereum',
  10: 'optimism',
  56: 'bsc',
  100: 'gnosis',
  130: 'unichain',
  137: 'polygon',
  146: 'sonic',
  196: 'xlayer',
  250: 'fantom',
  324: 'zksync',
  480: 'worldchain',
  1088: 'metis',
  1284: 'moonbeam',
  5000: 'mantle',
  8217: 'klaytn',
  8453: 'base',
  34443: 'mode',
  42161: 'arbitrum',
  42220: 'celo',
  43114: 'avalanche',
  57073: 'ink',
  59144: 'linea',
  80094: 'berachain',
  81457: 'blast',
  534352: 'scroll',
  1313161554: 'aurora',
  1399811149: 'solana',
  6909546: 'injective',
};
const DOMAIN_IDS = Object.keys(DOMAIN_TO_CHAIN).map(Number).sort((a, b) => a - b);
const IN_LIST = DOMAIN_IDS.join(',');

// Hasura bytea 返回 "\x1dac..."，转成 0x 前缀（兼容 explorer / 钱包识别）。
function hex(v) {
  if (v == null) return null;
  const s = String(v);
  return s.startsWith('\\x') ? '0x' + s.slice(2) : s;
}

function normalize(m) {
  return {
    source: 'hyperlane',
    txHash: hex(m.origin_tx_hash),
    dstTxHash: hex(m.destination_tx_hash),
    fromChain: DOMAIN_TO_CHAIN[m.origin_domain_id] || null,
    toChain: DOMAIN_TO_CHAIN[m.destination_domain_id] || null,
    tokenChain: null,
    sender: hex(m.sender),
    receiver: hex(m.recipient),
    tokenAddress: null,
    tokenSymbol: null,
    amount: null,
    amountUsd: null,
    timestamp: m.send_occurred_at || null,
    status: m.is_delivered ? 'delivered' : 'pending',
    app: null,
  };
}

async function fetchTransfers(ctx) {
  const limit = Math.min(ctx.limit || 100, 200);
  // health 检查会传 since=0，此时兜底成「最近 2 小时」，避免全表扫描触发 5s 超时。
  const sinceMs = ctx.since ? new Date(ctx.since).getTime() : 0;
  const effMs = sinceMs > 0 ? sinceMs : Date.now() - 2 * 3600000;
  const sinceISO = new Date(effMs).toISOString();

  const query = `query {
    message_view(
      limit: ${limit},
      where: {
        _and: [
          { send_occurred_at: { _gt: "${sinceISO}" } },
          { _or: [
            { origin_domain_id: { _in: [${IN_LIST}] } },
            { destination_domain_id: { _in: [${IN_LIST}] } }
          ] }
        ]
      },
      order_by: { send_occurred_at: desc }
    ) {
      msg_id origin_tx_hash destination_tx_hash sender recipient
      is_delivered origin_domain_id destination_domain_id send_occurred_at
    }
  }`;

  const res = await request(ENDPOINT, { settings: ctx.settings, method: 'POST', body: { query }, timeout: 25000 });
  if (!res.ok || !res.json) return { ok: false, error: res.error || ('HTTP ' + res.status), transfers: [] };
  if (res.json.errors) return { ok: false, error: res.json.errors[0]?.message || 'GraphQL 错误', transfers: [] };
  const list = res.json?.data?.message_view || [];
  if (!Array.isArray(list) || !list.length) return { ok: false, error: '未返回数据', transfers: [] };
  return { ok: true, transfers: list.map(normalize) };
}

module.exports = {
  id: 'hyperlane',
  name: 'Hyperlane Explorer',
  siteUrl: 'https://explorer.hyperlane.xyz',
  needsKey: false,
  note: '官方公开 GraphQL（api.hyperlane.xyz/v1/graphql）免 Key；仅收录已登记主网链，测试网消息自动过滤',
  fetchTransfers,
};
