'use strict';
// 价格查询性能基准：对比顺序 / 并发 / DexScreener 批量 tokens 端点的耗时与成功率。
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const prices = require('../lib/prices');
const store = require('../lib/store');
const engine = require('../lib/engine');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  store.load();
  const settings = store.settings();
  const cands = engine.pickCandidates(12);
  console.log(`候选代币 ${cands.length} 个`);

  // 1. 探测每个候选需要查询多少条链的地址
  const itemsPerToken = [];
  for (const t of cands) {
    const resolver = require('../lib/resolver');
    const r = resolver.resolveSymbol(t.symbol, { originChain: t.chain, originAddress: t.address });
    const byChainBest = new Map();
    const rankOf = (e) => (e.verified ? 0 : 1);
    for (const e of r.entries) {
      const prev = byChainBest.get(e.chain);
      if (!prev || rankOf(e) < rankOf(prev)
        || (rankOf(e) === rankOf(prev) && (resolver.SOURCE_RANK[e.source] ?? 9) < (resolver.SOURCE_RANK[prev.source] ?? 9))) {
        byChainBest.set(e.chain, e);
      }
    }
    const items = [...byChainBest.values()].slice(0, 12).map((e) => ({ chain: e.chain, address: e.address, source: e.source, verified: e.verified }));
    itemsPerToken.push({ symbol: t.symbol, items });
    console.log(`  ${t.symbol}: ${items.length} 条链地址`);
  }

  // 2. 顺序 multiChainQuotes（当前实现）
  console.log('\n--- 顺序 multiChainQuotes ---');
  const seq0 = Date.now();
  for (const { symbol, items } of itemsPerToken) {
    const t0 = Date.now();
    const r = await prices.multiChainQuotes(items, settings);
    console.log(`  ${symbol}: ${r.length}/${items.length} 报价, ${Date.now() - t0}ms`);
  }
  console.log(`顺序总耗时: ${Date.now() - seq0}ms`);

  await sleep(2000);

  // 3. 并发 multiChainQuotes（无延迟）
  console.log('\n--- 并发 multiChainQuotes(无延迟) ---');
  const con0 = Date.now();
  const conResults = await Promise.all(itemsPerToken.map(({ items }) => prices.multiChainQuotes(items, settings, 0)));
  console.log(`并发总耗时: ${Date.now() - con0}ms, 结果: ${conResults.map((r) => r.length).join('/')}`);

  await sleep(2000);

  // 4. 批量 tokens 端点（新实现）
  console.log('\n--- 批量 tokens 端点 ---');
  const flat = itemsPerToken.flatMap((x) => x.items);
  const bat0 = Date.now();
  const bat = await prices.multiChainQuotesBatch(flat, settings);
  console.log(`批量总耗时: ${Date.now() - bat0}ms, 返回 ${bat ? bat.length : 'N/A'} 条`);

  // 5. 模拟完整扫描：并发 checkToken
  console.log('\n--- 模拟扫描（并发 checkToken） ---');
  await sleep(2000);
  const scan0 = Date.now();
  const scanResults = await Promise.all(cands.map((t) => engine.checkToken(t, settings, false)));
  console.log(`并发 checkToken 总耗时: ${Date.now() - scan0}ms, best: ${scanResults.filter((r) => r.best).length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
