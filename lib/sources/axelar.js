'use strict';
const BaseBridgeAdapter = require('./base');
const { request } = require('../net');
const chains = require('../chains');

const BASE = 'https://api.axelarscan.io';

function chainKey(v) {
  if (v == null) return null;
  if (typeof v === 'number') return chains.keyOf('evm', v);
  const s = String(v).toLowerCase();
  return chains.keyOf('ds', s) || chains.keyOf('db', s) || s;
}

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

class AxelarAdapter extends BaseBridgeAdapter {
  constructor() {
    super({
      id: 'axelar',
      name: 'Axelarscan',
      siteUrl: 'https://axelarscan.io',
      needsKey: false,
      note: '公开 REST API，无需 Key，免鉴权',
    });
  }

  normalizeGMP(t) {
    const c = t.call || {};
    const rv = c.returnValues || {};
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

  normalizeTransfer(t) {
    const s = t.send || {};
    const link = t.link || {};
    return {
      source: 'axelar',
      txHash: normHash(s.txhash || t.id),
      fromChain: chainKey(s.source_chain),
      toChain: chainKey(s.destination_chain),
      fromChainRaw: s.source_chain || null,
      toChainRaw: s.destination_chain || null,
      tokenChain: null,
      sender: s.sender_address || null,
      receiver: s.recipient_address || link.recipient_address || null,
      tokenAddress: null,
      tokenSymbol: s.denom || link.denom || null,
      amount: Number(s.amount) || null,
      amountUsd: Number(s.value) || null,
      timestamp: s.created_at?.ms ? tsToIso(s.created_at.ms) : null,
      app: 'axelar-transfer',
    };
  }

  async _fetchTransfers(ctx) {
    const limit = Math.min(ctx.limit || 100, 100);
    const pageSize = 25;
    const pages = Math.max(1, Math.min(Math.ceil(limit / pageSize), 4));
    const pageOffsets = Array.from({ length: pages }, (_, i) => i * pageSize);

    const gmpPromises = pageOffsets.map((from) =>
      request(`${BASE}/api/searchGMP?size=${pageSize}&from=${from}`, { settings: ctx.settings, timeout: 20000 })
    );

    const responses = await Promise.all(gmpPromises);
    const out = [];
    const seenTx = new Set();
    let firstError = null;

    function add(item) {
      if (!item || !item.txHash) return;
      if (seenTx.has(item.txHash)) return;
      seenTx.add(item.txHash);
      out.push(item);
    }

    for (const res of responses) {
      if (!res.ok || !res.json) {
        if (!firstError) firstError = res.error || ('HTTP ' + res.status);
        continue;
      }
      if (res.json.error) {
        if (!firstError) firstError = res.json.message || 'Axelar GMP API Error';
        continue;
      }
      const list = Array.isArray(res.json) ? res.json : (res.json.data || []);
      for (const t of list) {
        add(this.normalizeGMP(t));
      }
    }

    if (!out.length && firstError) {
      return { ok: false, error: firstError, transfers: [] };
    }

    out.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    const since = ctx.since ? new Date(ctx.since).getTime() : 0;
    return {
      ok: true,
      transfers: out.filter((t) => !t.timestamp || new Date(t.timestamp).getTime() >= since),
    };
  }
}

const instance = new AxelarAdapter();
module.exports = instance;
