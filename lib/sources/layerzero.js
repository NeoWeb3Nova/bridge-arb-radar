'use strict';
const BaseBridgeAdapter = require('./base');
const { request } = require('../net');
const chains = require('../chains');

const API = 'https://scan.layerzero-api.com/v1';

const CHAIN_ALIAS = {
  bera: 'berachain',
  cronosevm: 'cronos',
};

function mapChain(name) {
  if (!name) return null;
  const k = String(name).toLowerCase();
  if (chains.get(k)) return k;
  return CHAIN_ALIAS[k] || k;
}

function num(v, fallback = null) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function cleanSymbol(name) {
  if (!name) return null;
  const s = String(name).trim();
  if (!s || s.toLowerCase() === 'unknown') return null;
  return s;
}

class LayerZeroAdapter extends BaseBridgeAdapter {
  constructor() {
    super({
      id: 'layerzero',
      name: 'LayerZero Scan',
      siteUrl: 'https://scan.layerzero-api.com/v1/swagger',
      needsKey: false,
      note: '官方公开 API，无需 Key，开箱即用（发现层 + 钱包追踪层）',
    });
  }

  normalize(m) {
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
      sender: srcTx.from || null,
      receiver: null,
      tokenAddress: senderOapp.address || null,
      tokenSymbol: cleanSymbol(name),
      amount: null,
      amountUsd: null,
      timestamp: ts ? new Date(ts * 1000).toISOString() : (m.created || null),
      app: name,
      status: (m.status && m.status.name) || null,
      explorer: (srcTx.txHash && fromChain) ? chains.txUrl(fromChain, srcTx.txHash) : null,
    };
  }

  async _fetchTransfers(ctx) {
    const limit = Math.min(ctx.limit || 200, 1000);
    const out = [];
    let nextToken = null;
    let firstError = null;
    const maxPages = Math.ceil(limit / 100);
    for (let i = 0; i < maxPages; i++) {
      const url = `${API}/messages/latest${nextToken ? '?nextToken=' + encodeURIComponent(nextToken) : ''}`;
      const res = await request(url, { settings: ctx.settings, timeout: 25000 });
      if (!res.ok || !res.json || !Array.isArray(res.json.data)) {
        firstError = res.error || ('HTTP ' + res.status);
        break;
      }
      out.push(...res.json.data.map((m) => this.normalize(m)));
      nextToken = res.json.nextToken;
      if (!nextToken || out.length >= limit) break;
    }
    if (!out.length) return { ok: false, error: firstError || '未取到数据', transfers: [] };
    const since = ctx.since ? new Date(ctx.since).getTime() : 0;
    return {
      ok: true,
      transfers: out.filter((t) => !t.timestamp || new Date(t.timestamp).getTime() >= since),
      partialError: firstError,
    };
  }

  async fetchWalletActivity(ctx, address, _chainKeys = [], limit = 100) {
    if (!address) return { ok: false, error: '缺少地址', activity: [] };
    const url = `${API}/messages/wallet/${encodeURIComponent(address)}?limit=${Math.min(limit || 100, 500)}`;
    const res = await request(url, { settings: ctx.settings, timeout: 25000 });
    if (!res.ok || !res.json || !Array.isArray(res.json.data)) {
      return { ok: false, error: res.error || ('HTTP ' + res.status), activity: [] };
    }
    const activity = res.json.data.map((m) => {
      const t = this.normalize(m);
      return {
        chain: t.fromChain,
        txHash: t.txHash,
        timestamp: t.timestamp,
        from: t.sender,
        to: null,
        direction: 'out',
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
}

const instance = new LayerZeroAdapter();
module.exports = instance;
