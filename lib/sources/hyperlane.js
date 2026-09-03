'use strict';
const BaseBridgeAdapter = require('./base');
const { request } = require('../net');

const ENDPOINT = 'https://api.hyperlane.xyz/v1/graphql';

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

function hex(v) {
  if (v == null) return null;
  const s = String(v);
  return s.startsWith('\\x') ? '0x' + s.slice(2) : s;
}

class HyperlaneAdapter extends BaseBridgeAdapter {
  constructor() {
    super({
      id: 'hyperlane',
      name: 'Hyperlanescan',
      siteUrl: 'https://explorer.hyperlane.xyz',
      needsKey: false,
      note: '官方公开 GraphQL API，无需 Key，免鉴权',
    });
  }

  normalize(m) {
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
      app: 'hyperlane',
      msgId: hex(m.msg_id),
      status: m.status || null,
    };
  }

  async _fetchTransfers(ctx) {
    const limit = Math.min(ctx.limit || 200, 500);
    const windowHours = ctx.hours ? Number(ctx.hours) : 48;
    const sinceIso = new Date(Date.now() - windowHours * 3600000).toISOString();

    const query = `
      query GetRecentMessages {
        message_view(
          limit: ${limit}
          order_by: { send_occurred_at: desc }
          where: {
            send_occurred_at: { _gte: "${sinceIso}" }
            _or: [
              { origin_domain_id: { _in: [${IN_LIST}] } }
              { destination_domain_id: { _in: [${IN_LIST}] } }
            ]
          }
        ) {
          msg_id
          origin_tx_hash
          destination_tx_hash
          origin_domain_id
          destination_domain_id
          sender
          recipient
          send_occurred_at
          status
        }
      }
    `;

    const res = await request(ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ query }),
      headers: { 'Content-Type': 'application/json' },
      settings: ctx.settings,
      timeout: 25000,
    });

    if (!res.ok || !res.json || !res.json.data || !Array.isArray(res.json.data.message_view)) {
      const err = res.error || (res.json?.errors?.[0]?.message) || ('HTTP ' + res.status);
      return { ok: false, error: err, transfers: [] };
    }

    const transfers = res.json.data.message_view.map((m) => this.normalize(m));
    const since = ctx.since ? new Date(ctx.since).getTime() : 0;
    return {
      ok: true,
      transfers: transfers.filter((t) => !t.timestamp || new Date(t.timestamp).getTime() >= since),
    };
  }
}

const instance = new HyperlaneAdapter();
module.exports = instance;
