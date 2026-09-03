'use strict';
// 自动裁决器单元测试：验证无官方注册表时仍能按链间价格偏离识别假币。
const assert = require('assert');
const { adjudicateAmbiguous } = require('../lib/adjudicate.js');
const prices = require('../lib/prices.js');

const S = {};
const realMultiChain = prices.multiChainQuotes;

function e(chain, address, priceUsd, baseToken, baseTokenName, opts = {}) {
  return {
    chain, address, name: opts.name || baseTokenName,
    source: opts.source || 'bridge', verified: opts.verified === true,
    quote: priceUsd == null ? null : {
      chain, priceUsd, baseToken, baseTokenName,
      liquidityUsd: 10000, volume24h: 1000, dex: 'test',
    },
  };
}

function run(name, entries, expectedMap, extra) {
  test(name, async () => {
    // 注入 mock 报价，避免单测走 DexScreener 网络
    prices.multiChainQuotes = async (items) => items.map((it) => {
      const e = entries.find((x) => x.chain === it.chain && x.address === it.address);
      return { input: it, quote: e ? e.quote : null };
    }).filter((x) => x.quote);
    const r = await adjudicateAmbiguous('TEST', entries, S);
    for (const [chain, want] of Object.entries(expectedMap)) {
      const v = r.verdicts.find((x) => x.chain === chain);
      assert(v, `缺少 ${chain} 的裁决`);
      assert.strictEqual(v.verdict, want.verdict, `${chain} 期望 ${want.verdict}，实际 ${v.verdict}: ${v.reason}`);
      if (want.ratio) assert(v.reason.includes(String(want.ratio)) || r.quotes.find((x) => x.chain === chain)?.devRatio >= want.ratio, `${chain} ratio 不匹配`);
    }
    if (extra) extra(r);
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log('✓', name);
  } catch (e) {
    console.log('✗', name, '\n ', e.message);
    process.exitCode = 1;
  }
}

(async () => {
  // 1. 两条链报价一致 → confirmed（无官方锚点 fallback）
  run('无官方注册表但报价一致 → confirmed', [
    e('solana', '0xaaa', 1.0, 'TEST', 'Test Token'),
    e('ethereum', '0xbbb', 1.01, 'TEST', 'Test Token'),
  ], { solana: { verdict: 'confirmed' }, ethereum: { verdict: 'confirmed' } }, (r) => {
    assert.strictEqual(r.anchor.source, 'all-median');
    assert.strictEqual(r.counts.confirmed, 2);
  });

  // 2. 80 倍偏离 → fake（这是核心回归用例：TRUMP 类型假币）
  run('无官方注册表但 80× 偏离 → fake', [
    e('solana', '0xaaa', 2.25, 'TEST', 'Test Token'),
    e('ethereum', '0xbbb', 0.02811, 'TEST', 'Test Token'),
  ], { solana: { verdict: 'fake', ratio: 8 }, ethereum: { verdict: 'fake', ratio: 8 } }, (r) => {
    assert.strictEqual(r.anchor.source, 'all-median');
    assert.strictEqual(r.counts.fake, 2);
    assert.strictEqual(r.counts.confirmed, 0);
  });

  // 3. 仅 1 条链有报价 → suspicious（无法交叉验证）
  run('仅 1 条链报价 → suspicious', [
    e('solana', '0xaaa', 1.0, 'TEST', 'Test Token'),
  ], { solana: { verdict: 'suspicious' } }, (r) => {
    assert.strictEqual(r.counts.suspicious, 1);
  });

  // 4. 官方注册表存在时，偏离官方锚点 → fake
  run('官方锚点下 5× 偏离 → fake', [
    e('ethereum', '0xofficial', 1.0, 'TEST', 'Test Token', { source: 'trustwallet', verified: true }),
    e('bsc', '0xfake', 5.0, 'TEST', 'Test Token'),
  ], { ethereum: { verdict: 'official' }, bsc: { verdict: 'fake' } }, (r) => {
    assert.strictEqual(r.anchor.source, 'verified-median');
    assert.strictEqual(r.counts.fake, 1);
  });

  // 5. symbol 不一致 → suspicious
  run('链上 symbol 不一致 → suspicious', [
    e('solana', '0xaaa', 1.0, 'TEST', 'Test Token'),
    e('ethereum', '0xbbb', 1.0, 'FAKE', 'Fake Token'),
  ], { ethereum: { verdict: 'suspicious' } }, (r) => {
    assert(r.verdicts.find((x) => x.chain === 'ethereum').reason.includes('FAKE'));
  });
})();

process.on('exit', () => { prices.multiChainQuotes = realMultiChain; });
