'use strict';
// checkToken 的 best 携带裁决证据字段的单元测试。
// 验证新加的 buy/sellAddress、buy/sellExplorer、buy/sellVerdict、verdict 能从报价正确推导，
// 且旧字段（buyUrl/sellUrl/spreadPct/verified/suspicious 等）不受影响。
const assert = require('assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const prices = require('../lib/prices.js');
const resolver = require('../lib/resolver.js');
const { checkToken } = require('../lib/engine.js');

let passed = 0, failed = 0;
function ok(label, cond) { if (cond) { console.log('✓ ' + label); passed++; } else { console.log('✗ ' + label); failed++; } }

// --- 打桩：resolver 返回两条链各一个「已确认」候选，prices 按地址精确报价 ---
const realResolve = resolver.resolveSymbol;
const realCoingecko = resolver.coingeckoLookup;
const realMulti = prices.multiChainQuotes;
const realSearch = prices.searchBySymbol;

// 场景 A：官方注册表两条链（ethereum + base），同为真币 → 期望整体 confirmed
async function runCase(name, setup, expect) {
  resolver.resolveSymbol = () => ({
    ambiguous: false,
    entries: setup.entries,
    verifiedCount: setup.entries.filter((x) => x.verified).length,
  });
  resolver.coingeckoLookup = async () => null;
  prices.multiChainQuotes = async (items) => items.map((it) => {
    const en = setup.entries.find((x) => x.chain === it.chain && String(x.address).toLowerCase() === String(it.address).toLowerCase());
    if (!en || !en.priceUsd) return { input: it, quote: null };
    return {
      input: it,
      quote: {
        chain: it.chain, priceUsd: en.priceUsd, liquidityUsd: 30000, volume24h: 5000,
        dex: 'uniswap', pairUrl: 'https://dexscreener.com/' + it.chain + '/' + it.address,
        baseToken: setup.symbol,
      },
    };
  }).filter((x) => x.quote);
  prices.searchBySymbol = async () => [];

  const tok = { symbol: setup.symbol, chain: setup.entries[0].chain, address: setup.entries[0].address };
  const r = await checkToken(tok, {}, false);
  const b = r.best;
  ok(`${name}：产生 best`, !!b);
  if (!b) return;
  ok(`${name}：整体 verdict=${expect.verdict}`, b.verdict === expect.verdict);
  ok(`${name}：verified=${expect.verified}`, b.verified === expect.verified);
  ok(`${name}：buyAddress=sellAddress 为低/高腿合约`, typeof b.buyAddress === 'string' && b.buyAddress.length > 0);
  ok(`${name}：buyExplorer 指向该链 explorer`, String(b.buyExplorer).includes(expect.buyExplorerHost));
  ok(`${name}：buyVerdict=${expect.buyVerdict}`, b.buyVerdict === expect.buyVerdict);
  ok(`${name}：sellVerdict=${expect.sellVerdict}`, b.sellVerdict === expect.sellVerdict);
  ok(`${name}：旧字段 buyUrl/sellUrl 保留`, !!b.buyUrl && !!b.sellUrl);
  ok(`${name}：spreadPct 为数值`, typeof b.spreadPct === 'number');
}

async function main() {
  // 真币：ethereum 与 base 价格一致
  const confirmed = {
    symbol: 'TESTCOIN',
    entries: [
      { chain: 'ethereum', address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'Test Coin', source: 'trustwallet', verified: true, priceUsd: 2.0 },
      { chain: 'base', address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'Test Coin', source: 'trustwallet', verified: true, priceUsd: 2.05 },
    ],
  };
  await runCase('双官方腿真币', confirmed, { verdict: 'confirmed', verified: true, buyVerdict: 'confirmed', sellVerdict: 'confirmed', buyExplorerHost: 'etherscan' });

  // 场景 B：同一条链既有最低又有最高，但中间有其他链可形成跨链套利对
  const ArbDetector = require('../lib/arb-detector');
  const multiQuotes = [
    { chain: 'bsc', priceUsd: 1.00, liquidityUsd: 20000, dex: 'pancake1', verdict: 'official' },
    { chain: 'arbitrum', priceUsd: 1.05, liquidityUsd: 20000, dex: 'camelot', verdict: 'official' },
    { chain: 'bsc', priceUsd: 1.10, liquidityUsd: 20000, dex: 'pancake2', verdict: 'official' },
  ];
  const multiBest = ArbDetector.evaluateBestOpportunity({ symbol: 'MULTI', quotes: multiQuotes });
  ok('同链极值场景：能正确选出跨链最佳买卖腿', !!multiBest);
  if (multiBest) {
    ok('同链极值场景：买卖链不相同', multiBest.buyChain !== multiBest.sellChain);
    ok('同链极值场景：价差为正', multiBest.spreadPct > 0);
  }

  // 恢复打桩
  resolver.resolveSymbol = realResolve;
  resolver.coingeckoLookup = realCoingecko;
  prices.multiChainQuotes = realMulti;
  prices.searchBySymbol = realSearch;

  console.log(`\n通过 ${passed} / 失败 ${failed}`);
  if (failed > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
