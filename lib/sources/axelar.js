'use strict';
const { request } = require('../net');
const chains = require('../chains');

// Axelarscan：官方公开 REST API（api.axelarscan.io），免 Key、无需鉴权。
// 官方 axelarscan-api 项目（github.com/axelarnetwork/axelarscan-api）提供两类批量端点：
//  - /api/searchGMP         GMP 消息（含 ContractCallWithToken 跨链带币调用），实时；字段：
//                           call.transactionHash / call.chain / returnValues.{sender,destinationChain,symbol,amount} /
//                           call.blockTimestamp（秒）。amount 是原始整数、无 decimals 元数据，无法归一化，故置空避免误导。
//  - /api/searchTransfers   Token Transfer，字段完整（send.amount 归一化 + send.value 美元 + 双链 + 收发地址），
//                           但官方 OpenSearch 索引实测有约数天延迟。
// 旧的 ?method=getTransfers 已下线；两个端点均用 size 参数控制条数，按时间倒序返回。
const BASE = 'https://api.axelarscan.io';

function chainKey(v) {
  if (v == null) return null;
  if (typeof v === 'number') return chains.keyOf('evm', v);
  const s = String(v).toLowerCase();
  return chains.keyOf('ds', s) || chains.keyOf('db', s) || s;
}

// 统一 txHash 格式：EVM 已是 0x 小写；Cosmos 是大写无前缀 64 位 hex，补 0x 并转小写；其余原样保留。
function normHash(v) {
  if (v == null) return null;
  const s = String(v);
  if (s.startsWith('0x')) return s.toLowerCase();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return '0x' + s.toLowerCase();
  return s;
}

function tsToIso(ms) {
  if (ms == null) return null;
  const n = Number(ms);
  const m = n > 1e11 ? n : (Number.isFinite(n) ? n * 1000 : Date.parse(ms));
  return Number.isFinite(m) ? new Date(m).toISOString() : null;
}

function normalizeGMP(t) {
  const c = t.call || {};
  const rv = c.returnValues || {};
  // 顶层字段已是官方归一化结果：t.amount 为小数、t.value 为美元、t.symbol 为归一化 symbol；
  // returnValues.amount 是 raw 整数、returnValues.denom 是原始 denom，仅作兜底。
  // 时间戳字段名不一致：EVM 消息用 blockTimestamp，Cosmos 消息用 block_timestamp。
  return {
    source: 'axelar',
    txHash: normHash(c.transactionHash || c.axelarTransactionHash),
    fromChain: chainKey(c.chain || rv.sourceChain),
    toChain: chainKey(rv.destinationChain),
    fromChainRaw: (c.chain || rv.sourceChain) || null,
    toChainRaw: rv.destinationChain || null,
    tokenChain: null,
    sender: rv.sender || null,
    receiver: rv.destinationContractAddress || null,
    tokenAddress: null,
    tokenSymbol: t.symbol || rv.symbol || null,
    amount: Number(t.amount ?? rv.amount) || null,
    amountUsd: Number(t.value) || null,
    timestamp: (c.blockTimestamp || c.block_timestamp) ? tsToIso(c.blockTimestamp || c.block_timestamp) : null,
    app: c.event || 'axelar-gmp',
  };
}

function normalizeTransfer(t) {
  const link = t.link || {};
  const send = t.send || {};
  return {
    source: 'axelar',
    txHash: normHash(link.txhash || send.txhash || t.id),
    fromChain: chainKey(link.source_chain),
    toChain: chainKey(link.destination_chain),
    fromChainRaw: link.source_chain || null,
    toChainRaw: link.destination_chain || null,
    tokenChain: null,
    sender: link.sender_address || null,
    receiver: link.recipient_address || null,
    tokenAddress: null,
    tokenSymbol: link.denom || link.asset || null,
    amount: Number(send.amount ?? t.amount ?? t.value) || null,
    amountUsd: Number(send.value ?? t.valueUsd ?? t.usdAmount) || null,
    timestamp: tsToIso(link.created_at?.ms ?? send.created_at?.ms),
    app: t.type || 'axelar-transfer',
  };
}

async function fetchTransfers(ctx) {
  const size = Math.min(ctx.limit || 50, 100);
  // GMP 实时优先，token transfer 作为补充；两者合并并按 txHash 去重。
  const attempts = [
    { url: `${BASE}/api/searchGMP`, norm: normalizeGMP },
    { url: `${BASE}/api/searchTransfers`, norm: normalizeTransfer },
  ];
  const out = [];
  const seen = new Set();
  let lastErr = '';
  for (const a of attempts) {
    const res = await request(`${a.url}?size=${size}`, { settings: ctx.settings, timeout: 20000 });
    if (res.ok && res.json && res.json.error !== true) {
      const list = Array.isArray(res.json) ? res.json : (res.json.data || []);
      if (Array.isArray(list)) {
        for (const t of list) {
          const n = a.norm(t);
          if (n.txHash && !seen.has(n.txHash)) {
            seen.add(n.txHash);
            out.push(n);
          }
        }
      }
    } else if (res.json && res.json.error === true) {
      lastErr = res.json.message || 'Axelarscan 返回错误';
    } else {
      lastErr = res.error || ('HTTP ' + res.status);
    }
  }
  if (out.length) return { ok: true, transfers: out };
  return { ok: false, error: lastErr || '未知错误', transfers: [] };
}

module.exports = {
  id: 'axelar',
  name: 'Axelarscan',
  siteUrl: 'https://axelarscan.io',
  needsKey: false,
  note: '官方公开接口免 Key；批量端点用 searchGMP（实时）与 searchTransfers（Token Transfer，索引或有数天延迟）',
  fetchTransfers,
};
