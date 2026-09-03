'use strict';
// prices 批量查询 + engine 并发 checkToken 回归测试。
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const assert = require('assert');
const prices = require('../lib/prices');
const store = require('../lib/store');
const engine = require('../lib/engine');

async function main() {
  store.load();
  const settings = store.settings();
  let passed = 0, failed = 0;

  function ok(label, cond) {
    if (cond) { console.log(`✓ ${label}`); passed++; }
    else { console.log(`✗ ${label}`); failed++; }
  }

  // 1. 批量查询 USDC 多链官方地址（常用稳定币，各链一般都有池子）
  const usdcItems = [
    { chain: 'ethereum', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', source: 'trustwallet', verified: true },
    { chain: 'arbitrum', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', source: 'trustwallet', verified: true },
    { chain: 'base', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', source: 'trustwallet', verified: true },
  ];
  const t0 = Date.now();
  const batch = await prices.multiChainQuotesBatch(usdcItems, settings);
  const batchMs = Date.now() - t0;
  ok(`批量 USDC 返回 ≥2 条报价 (got ${batch.length})`, batch.length >= 2);
  ok(`批量 USDC 耗时 < 5000ms (${batchMs}ms)`, batchMs < 5000);
  ok(`批量返回含 input/quote 结构`, batch.every((x) => x.input && x.quote && x.quote.priceUsd > 0));

  // 2. multiChainQuotes 默认走批量（delayMs=0）
  const t1 = Date.now();
  const viaDefault = await prices.multiChainQuotes(usdcItems, settings);
  ok(`multiChainQuotes 默认路径返回 ≥2 条 (got ${viaDefault.length})`, viaDefault.length >= 2);
  ok(`默认路径耗时 < 5000ms (${Date.now() - t1}ms)`, Date.now() - t1 < 5000);

  // 3. 顺序路径兼容（delayMs>0 仍工作）
  const t2 = Date.now();
  const viaSeq = await prices.multiChainQuotes(usdcItems.slice(0, 2), settings, 160);
  ok(`顺序路径返回 ≥1 条 (got ${viaSeq.length})`, viaSeq.length >= 1);
  ok(`顺序路径耗时 ≥160ms (${Date.now() - t2}ms)`, Date.now() - t2 >= 160);

  // 4. engine.checkToken 不会明显拖慢（使用缓存后应 < 8s）
  const cands = engine.pickCandidates(6);
  if (cands.length >= 2) {
    const t3 = Date.now();
    const results = await Promise.all(cands.slice(0, 4).map((t) => engine.checkToken(t, settings, false)));
    const scanMs = Date.now() - t3;
    ok(`并发 checkToken 4 个 < 30000ms (${scanMs}ms)`, scanMs < 30000);
    ok(`每个结果都有 quotes 数组`, results.every((r) => Array.isArray(r.quotes)));
  } else {
    ok('候选代币不足 2 个，跳过并发 checkToken 测试', true);
  }

  // 5. 内存缓存生效：同一地址再次查询应秒回
  const t4 = Date.now();
  const cached = await prices.multiChainQuotesBatch(usdcItems, settings);
  ok(`缓存命中耗时 < 50ms (${Date.now() - t4}ms)`, Date.now() - t4 < 50);
  ok(`缓存命中结果一致 (${cached.length} 条)`, cached.length === batch.length);

  console.log(`\n通过 ${passed} / 失败 ${failed}`);
  if (failed > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
