'use strict';
const { request } = require('./net');
const chains = require('./chains');

// DexScreener 免费公开接口：无需 Key，但有速率限制（约 300 次/分钟）。
// 注意：国内网络需走代理，net.js 已处理。
const API = 'https://api.dexscreener.com/latest/dex/tokens/';
const PAIR_API = 'https://api.dexscreener.com/latest/dex/pairs/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 内存缓存：同一轮扫描里同一地址会被多个候选反复查询；TTL 设 5 分钟避免陈旧报价。
const CACHE_TTL_MS = 5 * 60000;
const PAIR_CACHE_TTL_MS = 30000; // pair 实时行情缓存 30s
const MAX_CACHE_SIZE = 2000;
const quoteCache = new Map();
const pairCache = new Map();

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

function pairScore(p) {
  const totalLiq = Number(p.liquidity?.usd) || 0;
  const priceUsd = Number(p.priceUsd) || 0;
  const priceNative = Number(p.priceNative) || 0;
  const quoteTokens = Number(p.liquidity?.quote) || 0;
  const baseTokens = Number(p.liquidity?.base) || 0;
  const vol24h = Number(p.volume?.h24) || 0;
  const txns24h = (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0);

  // 估算 Quote 现金价值（USDT / USDC / WETH 等）
  const quotePriceUsd = (priceNative > 0 && priceUsd > 0) ? (priceUsd / priceNative) : 1;
  const quoteReserveUsd = quoteTokens * quotePriceUsd;
  const baseReserveUsd = baseTokens * priceUsd;
  const sumReserve = baseReserveUsd + quoteReserveUsd;
  const quoteRatio = sumReserve > 0 ? (quoteReserveUsd / sumReserve) : 0.5;

  // 虚假/空心池熔断：若现金储备极低且单边严重失衡（如注入大批代币但仅有几百U现金）
  // 真实 AMM 的最大承兑额度绝不能超过现金储备
  let effectiveLiquidity = totalLiq;
  if (quoteRatio < 0.02 && quoteReserveUsd < 500) {
    // 纸面虚假流动性降为其实际现金储备，杜绝操纵
    effectiveLiquidity = quoteReserveUsd;
  } else if (quoteReserveUsd > 0) {
    // 正常池承兑能力不能超过 2.2 倍现金储备
    effectiveLiquidity = Math.min(totalLiq, quoteReserveUsd * 2.2);
  }

  // 交易活跃度与流动性综合打分（杜绝无交易的僵尸池）
  const volumeWeight = Math.min(vol24h, 20000) * 0.5;
  const txnsWeight = Math.min(txns24h, 200) * 5;

  return effectiveLiquidity + volumeWeight + txnsWeight;
}

function bestPair(pairs, dsChain, tokenAddress) {
  let usable = (pairs || []).filter((p) => p.chainId === dsChain && Number(p.priceUsd) > 0);
  if (!usable.length) return null;

  // 核心防御：DexScreener 的 priceUsd 严格是 baseToken 的 USD 单价！
  // 若传入了 tokenAddress，优先筛选 baseToken 与之匹配的交易池；
  // 严禁将目标代币作为 quoteToken 时的配对资产价格（如 ZCHF/XAN 中的 ZCHF 1.24$）直接作为目标代币价格！
  if (tokenAddress) {
    const target = String(tokenAddress).toLowerCase();
    const baseMatches = usable.filter((p) => String(p.baseToken?.address || '').toLowerCase() === target);
    if (baseMatches.length > 0) {
      usable = baseMatches;
    } else {
      const quoteMatches = usable.filter((p) => String(p.quoteToken?.address || '').toLowerCase() === target);
      if (quoteMatches.length > 0) {
        usable = quoteMatches;
      }
    }
  }

  if (!usable.length) return null;
  usable.sort((a, b) => pairScore(b) - pairScore(a));
  return usable[0];
}

function summary(pair, chainKey, tokenAddress) {
  if (!pair) return null;

  let baseToken = pair.baseToken?.symbol;
  let baseTokenName = pair.baseToken?.name;
  let quoteToken = pair.quoteToken?.symbol;
  let quoteTokenName = pair.quoteToken?.name;
  let priceUsd = Number(pair.priceUsd) || 0;
  let priceNative = Number(pair.priceNative) || 0;
  let baseTokens = Number(pair.liquidity?.base) || 0;
  let quoteTokens = Number(pair.liquidity?.quote) || 0;

  // 关键保护：DexScreener 的 pair.priceUsd 始终是 baseToken 的美元价格！
  // 若指定了 tokenAddress，且目标 token 实际上是 quoteToken（反向配对池）：
  // 必须倒算汇率与方向，避免把 baseToken (如 ZCHF 1.24$) 误当作目标代币的价格！
  if (tokenAddress) {
    const target = String(tokenAddress).toLowerCase();
    const isBase = String(pair.baseToken?.address || '').toLowerCase() === target;
    const isQuote = String(pair.quoteToken?.address || '').toLowerCase() === target;
    if (!isBase && isQuote) {
      const nativeInverted = priceNative > 0 ? (1 / priceNative) : 0;
      const usdInverted = (priceNative > 0 && priceUsd > 0) ? (priceUsd / priceNative) : 0;
      baseToken = pair.quoteToken?.symbol;
      baseTokenName = pair.quoteToken?.name;
      quoteToken = pair.baseToken?.symbol;
      quoteTokenName = pair.baseToken?.name;
      priceUsd = usdInverted;
      priceNative = nativeInverted;
      baseTokens = Number(pair.liquidity?.quote) || 0;
      quoteTokens = Number(pair.liquidity?.base) || 0;
    }
  }

  const totalLiqUsd = Number(pair.liquidity?.usd) || 0;
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
    baseToken,
    baseTokenName,
    quoteToken,
    quoteTokenName,
    priceUsd,
    priceNative,
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

/** 精确指定池地址的实时行情查询 */
async function quotePair(chainKey, pairAddress, settings, tokenAddress) {
  const c = chains.get(chainKey);
  if (!c || !c.ds || !pairAddress) return null;
  const pKey = `${c.ds}:${String(pairAddress).toLowerCase()}`;
  const cached = pairCache.get(pKey);
  if (cached && (Date.now() - cached.ts < PAIR_CACHE_TTL_MS)) {
    return cached.summary;
  }
  const url = `${PAIR_API}${c.ds}/${pairAddress}`;
  const res = await request(url, { settings, timeout: 15000 });
  if (!res.ok) return null;
  const pair = res.json?.pair || (Array.isArray(res.json?.pairs) ? res.json.pairs[0] : null);
  if (!pair || !Number(pair.priceUsd)) return null;
  const summ = summary(pair, chainKey, tokenAddress);
  if (summ) {
    if (pairCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = pairCache.keys().next().value;
      if (oldestKey) pairCache.delete(oldestKey);
    }
    pairCache.set(pKey, { ts: Date.now(), summary: summ });
  }
  return summ;
}

/** 单个代币在某条链上的最优报价（支持指定 pairAddress 优先直查） */
async function quote(chainKey, tokenAddress, settings, pairAddress) {
  const c = chains.get(chainKey);
  if (!c || !c.ds) return null;

  // 1. 若提供了 pairAddress，优先查目标池（确保 live 报价与套利发现池严格一致）
  if (pairAddress) {
    const pairQuote = await quotePair(chainKey, pairAddress, settings, tokenAddress).catch(() => null);
    if (pairQuote && pairQuote.priceUsd > 0) return pairQuote;
  }

  // 2. 兜底按 tokenAddress 查询
  if (!tokenAddress) return null;
  const res = await request(API + tokenAddress, { settings, timeout: 20000 });
  if (!res.ok || !res.json?.pairs) return null;
  return summary(bestPair(res.json.pairs, c.ds, tokenAddress), chainKey, tokenAddress);
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
      const q = summary(bestPair(pairs, c.ds, it.address), it.chain, it.address);
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

module.exports = { quote, quotePair, multiChainQuotes, multiChainQuotesBatch, spreadMatrix, searchBySymbol, API, PAIR_API, BATCH_SIZE, BATCH_CONCURRENCY };
