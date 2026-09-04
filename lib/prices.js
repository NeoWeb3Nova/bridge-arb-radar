'use strict';
const { request } = require('./net');
const chains = require('./chains');

// DexScreener 免费公开接口：无需 Key，但有速率限制（约 300 次/分钟）。
// 注意：国内网络需走代理，net.js 已处理。
const API = 'https://api.dexscreener.com/latest/dex/tokens/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 内存缓存：同一轮扫描里同一地址会被多个候选反复查询；TTL 设 5 分钟避免陈旧报价。
const CACHE_TTL_MS = 5 * 60000;
const MAX_CACHE_SIZE = 2000;
const quoteCache = new Map();

function cacheKey(address) {
  return String(address || '').toLowerCase();
}
function getCache(address) {
  const k = cacheKey(address);
  const e = quoteCache.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) { quoteCache.delete(k); return null; }
  return e.pairs;
}
function setCache(address, pairs) {
  const k = cacheKey(address);
  if (quoteCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = quoteCache.keys().next().value;
    if (oldestKey) quoteCache.delete(oldestKey);
  }
  quoteCache.set(k, { ts: Date.now(), pairs });
}

// 控制并发：DexScreener 约 300 次/分钟 ≈ 5 次/秒；批量查询时并发放宽到 3，
// 批量本身一次可携带多个地址，整体吞吐远高于顺序单地址请求。
const BATCH_SIZE = 8;
const BATCH_CONCURRENCY = 3;
const INTER_BATCH_DELAY_MS = 160;
const BATCH_TIMEOUT_MS = 12000;

async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

function bestPair(pairs, dsChain) {
  const usable = (pairs || []).filter((p) => p.chainId === dsChain && Number(p.priceUsd) > 0);
  if (!usable.length) return null;
  usable.sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0));
  return usable[0];
}

function summary(pair, chainKey) {
  if (!pair) return null;
  const totalLiqUsd = Number(pair.liquidity?.usd) || 0;
  const priceUsd = Number(pair.priceUsd) || 0;
  const priceNative = Number(pair.priceNative) || 0;
  const baseTokens = Number(pair.liquidity?.base) || 0;
  const quoteTokens = Number(pair.liquidity?.quote) || 0;
  const quotePriceUsd = (priceNative > 0 && priceUsd > 0) ? (priceUsd / priceNative) : 1;
  const baseReserveUsd = Number((baseTokens * priceUsd).toFixed(2));
  const quoteReserveUsd = Number((quoteTokens * quotePriceUsd).toFixed(2));
  const quoteRatio = (baseReserveUsd + quoteReserveUsd > 0)
    ? Number((quoteReserveUsd / (baseReserveUsd + quoteReserveUsd)).toFixed(4))
    : 0.5;

  return {
    chain: chainKey,
    chainName: chains.label(chainKey),
    dex: pair.dexId,
    pairAddress: pair.pairAddress,
    pairUrl: pair.url,
    baseToken: pair.baseToken?.symbol,
    baseTokenName: pair.baseToken?.name,
    quoteToken: pair.quoteToken?.symbol,
    priceUsd,
    liquidityUsd: totalLiqUsd,
    baseTokens,
    quoteTokens,
    baseReserveUsd,
    quoteReserveUsd,
    quoteRatio,
    quotePriceUsd,
    volume24h: Number(pair.volume?.h24) || 0,
    volume6h: Number(pair.volume?.h6) || 0,
    priceChange24h: Number(pair.priceChange?.h24) || 0,
    txns24h: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
    txns6h: (pair.txns?.h6?.buys || 0) + (pair.txns?.h6?.sells || 0),
    fdv: Number(pair.fdv) || 0,
  };
}

/** 单个代币在某条链上的最优报价 */
async function quote(chainKey, tokenAddress, settings) {
  const c = chains.get(chainKey);
  if (!c || !c.ds || !tokenAddress) return null;
  const res = await request(API + tokenAddress, { settings, timeout: 20000 });
  if (!res.ok || !res.json?.pairs) return null;
  return summary(bestPair(res.json.pairs, c.ds), chainKey);
}

/** 一次性拿到某代币在多条链上的报价（按 tokenAddress 映射）。
 *  内部默认走 DexScreener 批量 tokens 端点，减少 HTTP 请求数；
 *  delayMs > 0 时退化到顺序单地址请求（兼容旧调用/测试）。
 */
async function multiChainQuotes(items, settings, delayMs = 0) {
  if (!items || !items.length) return [];
  if (delayMs > 0) {
    const out = [];
    for (const it of items) {
      const q = await quote(it.chain, it.address, settings).catch(() => null);
      out.push({ input: it, quote: q });
      if (delayMs) await sleep(delayMs);
    }
    return out.filter((x) => x.quote);
  }
  return multiChainQuotesBatch(items, settings);
}

/** 使用 DexScreener 批量 tokens 端点：一次请求最多 BATCH_SIZE 个地址。
 *  返回格式与 multiChainQuotes 完全一致：{input, quote}[]
 */
async function multiChainQuotesBatch(items, settings) {
  if (!items || !items.length) return [];
  const byAddress = new Map();
  for (const it of items) {
    const addr = String(it.address || '').toLowerCase();
    if (!addr) continue;
    const list = byAddress.get(addr) || [];
    list.push(it);
    byAddress.set(addr, list);
  }
  const addresses = [...byAddress.keys()];
  const addressToPairs = new Map();

  // 命中缓存的地址直接复用
  const uncached = [];
  for (const addr of addresses) {
    const cached = getCache(addr);
    if (cached) addressToPairs.set(addr, cached);
    else uncached.push(addr);
  }

  // 分批并发请求
  const batches = [];
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    batches.push(uncached.slice(i, i + BATCH_SIZE));
  }

  async function fetchBatch(batch, bi, attempt = 1) {
    if (bi > 0 && INTER_BATCH_DELAY_MS) await sleep(INTER_BATCH_DELAY_MS);
    const url = API + batch.join(',');
    const req0 = Date.now();
    const res = await request(url, { settings, timeout: BATCH_TIMEOUT_MS });
    if (res.ok) {
      const pairs = Array.isArray(res.json?.pairs) ? res.json.pairs : [];
      if (process.env.PRICE_DEBUG) console.log(`[prices] batch ${bi + 1}/${batches.length} OK ${Date.now() - req0}ms pairs=${pairs.length} addrs=${batch.length}`);
      for (const addr of batch) {
        const relevant = pairs.filter((p) => String(p.baseToken?.address || '').toLowerCase() === addr);
        addressToPairs.set(addr, relevant);
        setCache(addr, relevant);
      }
      return;
    }
    if (process.env.PRICE_DEBUG) console.log(`[prices] batch ${bi + 1}/${batches.length} FAILED ${Date.now() - req0}ms status=${res.status} url=${url.slice(0, 120)}`);
    // 批量失败大概率是网络瞬抖或某地址触发服务端限流：先重试一次批量，仍失败再并发降级单地址。
    if (attempt === 1) {
      await sleep(400);
      return fetchBatch(batch, bi, 2);
    }
    // 并发单地址 fallback，短超时，避免某个无效地址拖垮整批。
    const fbTasks = batch.map((addr) => async () => {
      const r = await request(API + addr, { settings, timeout: 8000 });
      if (r.ok && Array.isArray(r.json?.pairs)) {
        addressToPairs.set(addr, r.json.pairs);
        setCache(addr, r.json.pairs);
      }
    });
    await runWithConcurrency(fbTasks, 4);
  }

  const tasks = batches.map((batch, bi) => () => fetchBatch(batch, bi));
  await runWithConcurrency(tasks, BATCH_CONCURRENCY);

  const out = [];
  for (const [addr, its] of byAddress) {
    const pairs = addressToPairs.get(addr) || [];
    for (const it of its) {
      const c = chains.get(it.chain);
      if (!c || !c.ds) continue;
      const q = summary(bestPair(pairs, c.ds), it.chain);
      if (q) {
        q.tokenAddress = it.address;
        out.push({ input: it, quote: q });
      }
    }
  }
  return out;
}

/**
 * 跨链价差矩阵：输入 [{chain, address}]，输出报价列表 + 最优买卖对。
 * spreadPct 已扣除两侧 24h 波动的影响解释，仅做粗略提示。
 */
async function spreadMatrix(items, settings) {
  const quotes = await multiChainQuotes(items, settings);
  if (quotes.length < 2) return { quotes: quotes.map((q) => q.quote), best: null };
  const list = quotes.map((q) => q.quote).sort((a, b) => a.priceUsd - b.priceUsd);
  const low = list[0];
  const high = list[list.length - 1];
  const spreadPct = low.priceUsd > 0 ? ((high.priceUsd - low.priceUsd) / low.priceUsd) * 100 : 0;
  const liquidityCapUsd = Math.min(
    ...list.filter((l) => l === low || l === high).map((l) => l.liquidityUsd)
  );
  return {
    quotes: list,
    best: spreadPct > 0 ? {
      buyChain: low.chain, buyChainName: low.chainName, buyPrice: low.priceUsd, buyDex: low.dex, buyUrl: low.pairUrl,
      sellChain: high.chain, sellChainName: high.chainName, sellPrice: high.priceUsd, sellDex: high.dex, sellUrl: high.pairUrl,
      spreadPct: Number(spreadPct.toFixed(3)),
      minLiquidityUsd: liquidityCapUsd,
    } : null,
  };
}

/**
 * 同名代币在其它链的报价（启发式）。
 * 桥过去之后目标链合约地址往往未知，用 DexScreener 搜索按 symbol 找同名代币，
 * 结果可能混入同名假币，因此标记 heuristic=true，前端会提示人工核验合约地址。
 */
async function searchBySymbol(symbol, settings, { excludeChains = [], minLiquidityUsd = 1000 } = {}) {
  if (!symbol) return [];
  const res = await request(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`, { settings, timeout: 20000 });
  if (!res.ok || !Array.isArray(res.json?.pairs)) return [];
  const exclude = new Set(excludeChains);
  const byChain = new Map();
  for (const p of res.json.pairs) {
    if (!p.chainId || !Number(p.priceUsd)) continue;
    // 同名假币通常只有极薄的池子，直接用流动性门槛挡掉大部分噪音
    if ((Number(p.liquidity?.usd) || 0) < minLiquidityUsd) continue;
    const ck = chains.keyOf('ds', p.chainId);
    if (!ck || exclude.has(ck)) continue;
    // 只接受 symbol 完全一致且本身有流动性的交易对
    if (String(p.baseToken?.symbol || '').toUpperCase() !== String(symbol).toUpperCase()) continue;
    const liq = Number(p.liquidity?.usd) || 0;
    const cur = byChain.get(ck);
    if (!cur || liq > cur.liquidityUsd) {
      byChain.set(ck, Object.assign(summary(p, ck), { heuristic: true, tokenAddress: p.baseToken?.address }));
    }
  }
  return [...byChain.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd);
}

module.exports = { quote, multiChainQuotes, multiChainQuotesBatch, spreadMatrix, searchBySymbol, API, BATCH_SIZE, BATCH_CONCURRENCY };
