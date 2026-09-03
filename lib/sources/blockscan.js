'use strict';
const { request } = require('../net');
const chains = require('../chains');

// Blockscan（Etherscan 多链 V2 API）：用来把「追踪钱包」这一步自动化——
// 拉某个地址在多条链上的 ERC20 转账，看它在倒腾哪些代币。需要 API Key。
const API = 'https://api.etherscan.io/v2/api';

// Etherscan V2 官方 chainlist（https://api.etherscan.io/v2/chainlist）不包含以下 chainid。
// 对这些链发起 tokentx 会返回 "Missing or unsupported chainid"，纯属浪费请求，默认跳过。
// 若日后官方把某条链加进 chainlist，从这里移除对应 chainid 即可。
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

async function fetchWalletActivity(ctx, address, chainKeys = [], limitPerChain = 30) {
  const key = ctx.settings.keys?.etherscan;
  if (!key) return { ok: false, error: '未填写 Etherscan/Blockscan API Key', activity: [] };
  // 默认覆盖全部「V2 官方支持的」EVM 链（当前 16 条），过滤掉 chainid 不被支持的链；
  // 前端可传 chains 参数只查指定链（此时不做过滤，付费 Key 用户可自行指定）。
  const list = chainKeys.length
    ? chainKeys
    : chains.evmChainKeys().filter((k) => {
        const c = chains.get(k);
        return c && !V2_UNSUPPORTED_EVM.has(c.evm);
      });
  const activity = [];
  const errors = [];

  async function pullOne(ck) {
    const c = chains.get(ck);
    if (!c || !c.evm) return;
    // 不传 startblock/endblock，只取最近 N 条（sort=desc），避免全历史扫描触发 "Query Timeout"。
    const url = `${API}?chainid=${c.evm}&module=account&action=tokentx&address=${address}&page=1&offset=${limitPerChain}&sort=desc&apikey=${encodeURIComponent(key)}`;
    try {
      const res = await request(url, { settings: ctx.settings, timeout: 20000 });
      if (!res.ok) { errors.push(`${c.name}: ${res.error || res.status}`); return; }
      const j = res.json || {};
      if (j.status !== '1' || !Array.isArray(j.result)) {
        // 真实错误描述在 result 字段（message 常是 "NOTOK" 这种无意义占位）
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
          timestamp: new Date(Number(r.timeStamp) * 1000).toISOString(),
          from: r.from, to: r.to,
          direction: String(r.to || '').toLowerCase() === String(address).toLowerCase() ? 'in' : 'out',
          tokenAddress: r.contractAddress,
          tokenSymbol: r.tokenSymbol,
          tokenName: r.tokenName,
          amount: Number(r.value) / 10 ** Number(r.tokenDecimal || 18),
        });
      }
    } catch (e) {
      errors.push(`${c.name}: ${e.message}`);
    }
  }

  // 并发池：Etherscan V2 免费层限流约 5 req/s，用 3 并发留足余量，避免触发限流（实测 5 并发会把部分链误判为 NOTOK）。
  const CONCURRENCY = 3;
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
    while (next < list.length) await pullOne(list[next++]);
  });
  await Promise.all(workers);

  activity.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { ok: activity.length > 0, activity, errors };
}

module.exports = {
  id: 'blockscan',
  name: 'Blockscan / Etherscan V2',
  siteUrl: 'https://docs.etherscan.io',
  needsKey: true,
  note: '需 API Key；用于自动追踪钱包在多条链上的代币流水（步骤 4-5）',
  fetchWalletActivity,
  fetchTransfers: async () => ({ ok: false, error: 'Blockscan 用于钱包追踪，不提供全局桥流', transfers: [] }),
};
