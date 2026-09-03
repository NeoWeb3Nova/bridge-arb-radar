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
    const limit = Math.min(ctx.limit || 200, 500);
    const gmpLimit = Math.min(limit, 100);
    const [gmpRes, xferRes] = await Promise.all([
      request(`${BASE}/api/searchGMP?size=${gmpLimit}`, { settings: ctx.settings, timeout: 25000 }),
      request(`${BASE}/api/searchTransfers?size=${limit}`, { settings: ctx.settings, timeout: 25000 }),
    ]);

    const out = [];
    const seenTx = new Set();
    function add(item) {
      if (!item || !item.txHash) return;
      if (seenTx.has(item.txHash)) return;
      seenTx.add(item.txHash);
      out.push(item);
    }

    if (gmpRes.ok && gmpRes.json) {
      const gmpList = Array.isArray(gmpRes.json) ? gmpRes.json : (gmpRes.json.data || []);
      gmpList.forEach((t) => add(this.normalizeGMP(t)));
    }
    if (xferRes.ok && xferRes.json) {
      const xferList = Array.isArray(xferRes.json) ? xferRes.json : (xferRes.json.data || []);
      xferList.forEach((t) => add(this.normalizeTransfer(t)));
    }

    if (!out.length) {
      const err = (!gmpRes.ok ? gmpRes.error : null) || (!xferRes.ok ? xferRes.error : null) || '未取到数据';
      return { ok: false, error: err, transfers: [] };
    }

    out.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    const since = ctx.since ? new Date(ctx.since).getTime() : 0;
    const partialError = (!gmpRes.ok ? ('GMP: ' + gmpRes.error) : null) || (!xferRes.ok ? ('Transfer: ' + xferRes.error) : null);
    return {
      ok: true,
      transfers: out.filter((t) => !t.timestamp || new Date(t.timestamp).getTime() >= since),
      partialError,
    };
  }
}

const instance = new AxelarAdapter();
module.exports = instance;
