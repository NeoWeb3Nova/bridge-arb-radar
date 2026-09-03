'use strict';
const BaseBridgeAdapter = require('./base');
const { request } = require('../net');
const chains = require('../chains');

const API = 'https://api.etherscan.io/v2/api';

const V2_UNSUPPORTED_EVM = new Set([
  534352,        // Scroll
  324,           // zkSync
  250,           // Fantom
  1284,          // Moonbeam
  1088,          // Metis
  25,            // Cronos
  8217,          // Klaytn
  1313161554,    // Aurora
  196,           // X Layer
  34443,         // Mode
  57073,         // Ink
]);

class BlockscanAdapter extends BaseBridgeAdapter {
  constructor() {
    super({
      id: 'blockscan',
      name: 'Etherscan/Blockscan',
      siteUrl: 'https://etherscan.io',
      needsKey: true,
      keyName: 'etherscan',
      note: 'Etherscan 多链 V2 API，用于钱包活动画像与 ERC20 转账历史追踪',
    });
  }

  async _fetchTransfers(_ctx) {
    // Blockscan 不作为跨链桥流主源，主要用于按需查钱包活动
    return { ok: true, transfers: [] };
  }

  async fetchWalletActivity(ctx, address, chainKeys = [], limitPerChain = 30) {
    const key = ctx.settings?.keys?.etherscan;
    if (!key) return { ok: false, error: '未填写 Etherscan/Blockscan API Key', activity: [] };
    const list = chainKeys.length
      ? chainKeys
      : chains.evmChainKeys().filter((k) => {
          const c = chains.get(k);
          return c && !V2_UNSUPPORTED_EVM.has(c.evm);
        });
    const activity = [];
    const errors = [];

    const pullOne = async (ck) => {
      const c = chains.get(ck);
      if (!c || !c.evm) return;
      const url = `${API}?chainid=${c.evm}&module=account&action=tokentx&address=${address}&page=1&offset=${limitPerChain}&sort=desc&apikey=${encodeURIComponent(key)}`;
      try {
        const res = await request(url, { settings: ctx.settings, timeout: 20000 });
        if (!res.ok) { errors.push(`${c.name}: ${res.error || res.status}`); return; }
        const j = res.json || {};
        if (j.status !== '1' || !Array.isArray(j.result)) {
          const raw = String(j.result || j.message || '无数据');
          let msg = raw;
          if (/Free API access is not supported/i.test(raw)) msg = '免费 Key 不支持该链（需 Etherscan 付费 plan）';
          else if (/Query Timeout/i.test(raw)) msg = '查询超时（该链数据量大，已跳过）';
          else if (/rate limit|Max rate/i.test(raw)) msg = '触发限流（免费 Key 约 5 次/秒，已跳过）';
          errors.push(`${c.name}: ${msg}`);
          return;
        }
        for (const r of j.result) {
          activity.push({
            chain: ck,
            txHash: r.hash,
            timestamp: r.timeStamp ? new Date(Number(r.timeStamp) * 1000).toISOString() : null,
            from: r.from,
            to: r.to,
            direction: String(r.to).toLowerCase() === String(address).toLowerCase() ? 'in' : 'out',
            tokenAddress: r.contractAddress,
            tokenSymbol: r.tokenSymbol,
            tokenName: r.tokenName,
            tokenDecimal: Number(r.tokenDecimal) || 18,
            amount: Number(r.value) / 10 ** (Number(r.tokenDecimal) || 18),
          });
        }
      } catch (e) {
        errors.push(`${c.name}: ${e.message}`);
      }
    };

    const CONCURRENCY = 3;
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      await Promise.all(list.slice(i, i + CONCURRENCY).map(pullOne));
    }

    activity.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    return { ok: activity.length > 0, activity, errors };
  }
}

const instance = new BlockscanAdapter();
module.exports = instance;
