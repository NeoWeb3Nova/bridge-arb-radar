'use strict';
// 同名多合约（ambiguous）代币的自动裁决器。
//
// 核心问题：symbol 无法唯一标识资产。同名 symbol 在不同链、甚至同一条链上可能对应
// 多个合约，其中掺杂假币（有人真会去桥假币）。官方注册表（TrustWallet / CoinGecko）
// 只覆盖主流币，冷门币和被桥过的假币需要额外的裁决信号。
//
// 这里用两个信号自动裁决，互相印证：
//   1. 按链价格联动 —— 真币在不同链上的价格高度相关（跨链套利空间通常 <10%），
//      假币价格天差地别（经常是几倍到几百倍的偏离）。
//   2. 官方 explorer 二次确认 —— 读合约在链上声明的 symbol（DexScreener 代币端点
//      直接反映链上元数据，等价于 explorer 展示的内容），并给出官方 explorer 代币页
//      URL 供人工核验。
//
// 裁决结论分四档：official（官方注册表）/ confirmed（价格+标识确认）/ suspicious（存疑）
// / fake（假币）。只有 official + confirmed 才参与价差计算。
const chains = require('./chains');
const prices = require('./prices');

// 价格联动带宽：真币跨链价差通常 <5%，留到 15% 容忍桥费 + 滑点 + 报价时点差
const PRICE_BAND = 0.15;
// 偏离锚点超过这个倍数 → 判假币
const FAKE_RATIO = 3;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function geoMean(arr) {
  if (!arr.length) return null;
  let logSum = 0;
  for (const v of arr) logSum += Math.log(Math.max(v, Number.MIN_VALUE));
  return Math.exp(logSum / arr.length);
}

function crossAnchor(prices) {
  if (!prices || !prices.length) return null;
  if (prices.length === 1) return prices[0];
  // 只有 2 条报价时，几何平均对乘性偏离更对称（避免 median 让一侧只判 suspicious）；
  // ≥3 条时 median 更抗极端单点噪声。
  return prices.length === 2 ? geoMean(prices) : median(prices);
}

function explorerTokenUrl(chainKey, address) {
  return chains.tokenUrl(chainKey, address);
}

/**
 * 对同名多合约代币做自动裁决。
 * entries = resolver.resolveSymbol().entries（每项含 chain/address/name/source/verified）。
 * 返回 { symbol, anchor, quotes, verdicts, counts }，quotes 每项带 verdict / reason / explorerUrl / devRatio。
 */
async function adjudicateAmbiguous(symbol, entries, settings) {
  const sym = String(symbol || '').toUpperCase();

  // 去重候选（同链同地址只留一条，官方可信的覆盖链上出现的）
  const byKey = new Map();
  for (const e of entries) {
    const k = `${e.chain}:${e.address}`;
    const prev = byKey.get(k);
    if (!prev || (e.verified && !prev.verified)) byKey.set(k, e);
  }
  // 过滤掉 DexScreener 不支持的链：没有链上报价的候选去裁决也是空转。
  let cands = [...byKey.values()].filter((e) => !!chains.get(e.chain)?.ds);
  // 限制裁决规模：优先保留官方地址 + 常见链，避免 70+ 个 bridge 同名假币把扫描拖垮。
  const MAX_ADJUDICATE_CANDS = 36;
  if (cands.length > MAX_ADJUDICATE_CANDS) {
    const rank = (e) => (e.verified ? 0 : 1) * 100 + (chains.get(e.chain)?.ds ? 0 : 1) * 10;
    cands.sort((a, b) => rank(a) - rank(b));
    cands = cands.slice(0, MAX_ADJUDICATE_CANDS);
  }

  // 1. 对所有候选地址精确报价（只认地址，不认 symbol）。
  //    传 delayMs=0 走 prices 内部批量 tokens 端点，避免顺序单地址请求拖慢裁决。
  const quoted = await prices.multiChainQuotes(
    cands.map((e) => ({ chain: e.chain, address: e.address, verified: e.verified, name: e.name, source: e.source })),
    settings, 0,
  );

  // 2. 价格锚点：优先用 verified 官方报价的中位数；若官方注册表没覆盖（例如链上事实代币），
  //    退而求其次用「全部报价的中位数」做交叉锚点。这样即使无官方注册表，同名假币的 10×/100×
  //    偏离仍会被识别。只有 <2 条报价时才放弃锚点，避免单点噪声误杀/误放。
  const verifiedPriced = quoted.filter((q) => q.input.verified === true && q.quote && q.quote.priceUsd > 0);
  const allPriced = quoted.filter((q) => q.quote && q.quote.priceUsd > 0).map((q) => q.quote.priceUsd);
  let anchorPrice = null;
  let anchorSource = 'none';
  if (verifiedPriced.length) {
    anchorPrice = crossAnchor(verifiedPriced.map((q) => q.quote.priceUsd));
    anchorSource = 'verified-median';
  } else if (allPriced.length >= 2) {
    anchorPrice = crossAnchor(allPriced);
    anchorSource = 'all-median';
  }

  // 锚点 name：官方注册表里出现次数最多的 name（规范化后），用于链上标识核对
  const nameCount = new Map();
  for (const e of entries) {
    if (e.verified && e.name) {
      const nk = norm(e.name);
      nameCount.set(nk, (nameCount.get(nk) || 0) + 1);
    }
  }
  let anchorName = null;
  let bestN = 0;
  for (const [nk, c] of nameCount) if (c > bestN) { bestN = c; anchorName = nk; }

  // 3. 逐条裁决
  const quotes = [];
  const verdicts = [];
  for (const q of quoted) {
    const input = q.input;
    const quote = q.quote;
    const eu = explorerTokenUrl(input.chain, input.address);
    if (!quote || !(quote.priceUsd > 0)) {
      // 没报价：保留原 verified 状态，不做价格裁决
      if (input.verified) {
        verdicts.push({ chain: input.chain, address: input.address, verdict: 'official', reason: '官方注册表', explorerUrl: eu, priceUsd: null });
      }
      continue;
    }
    const isVerified = input.verified === true;
    const price = quote.priceUsd;
    const onChainSym = String(quote.baseToken || '').toUpperCase();
    const onChainName = norm(quote.baseTokenName);
    const symMatch = !onChainSym || onChainSym === sym;
    const nameMatch = !anchorName || !onChainName || onChainName === anchorName;
    let ratio = 1;
    if (anchorPrice && anchorPrice > 0) ratio = Math.max(price / anchorPrice, anchorPrice / price);
    const priceMatch = !anchorPrice || ratio <= 1 + PRICE_BAND;
    const priceFake = !!anchorPrice && ratio >= FAKE_RATIO;

    let verdict;
    let reason;
    if (isVerified) {
      verdict = 'official';
      reason = '官方注册表';
    } else if (priceFake) {
      verdict = 'fake';
      reason = `价格偏离锚点 ${ratio.toFixed(1)}×（≥${FAKE_RATIO}×）`;
    } else if (!symMatch) {
      verdict = 'suspicious';
      reason = `链上 symbol「${quote.baseToken || '?'}」≠「${sym}」（可能是包装币/不同资产）`;
    } else if (anchorPrice !== null && priceMatch) {
      verdict = 'confirmed';
      if (anchorSource === 'all-median') {
        reason = nameMatch ? '链间报价一致（无官方锚点）+ 链上标识一致' : '链间报价一致（无官方锚点）';
      } else {
        reason = nameMatch ? '价格联动一致 + 链上标识一致' : '价格联动一致';
      }
    } else {
      verdict = 'suspicious';
      reason = anchorPrice === null
        ? '仅 1 条链有报价，无法跨链验证'
        : `价格偏离 ${ratio.toFixed(1)}×（<${FAKE_RATIO}×），需人工核验`;
    }

    const qo = Object.assign({}, quote, {
      verified: isVerified,
      verdict,
      reason,
      explorerUrl: eu,
      devRatio: Number(ratio.toFixed(2)),
      source: input.source,
    });
    quotes.push(qo);
    verdicts.push({ chain: input.chain, address: input.address, verdict, reason, explorerUrl: eu, priceUsd: price });
  }

  // 可信度排序：official/confirmed 在前，suspicious 中，fake 末位
  const rank = { official: 0, confirmed: 1, suspicious: 2, fake: 3 };
  quotes.sort((a, b) => (rank[a.verdict] ?? 9) - (rank[b.verdict] ?? 9) || (b.liquidityUsd || 0) - (a.liquidityUsd || 0));

  const counts = { official: 0, confirmed: 0, suspicious: 0, fake: 0, total: quotes.length };
  for (const v of verdicts) counts[v.verdict] = (counts[v.verdict] || 0) + 1;

  return {
    symbol: sym,
    ambiguous: true,
    anchor: { price: anchorPrice, name: anchorName, source: anchorSource },
    quotes,
    verdicts,
    counts,
  };
}

module.exports = { adjudicateAmbiguous, explorerTokenUrl, PRICE_BAND, FAKE_RATIO };
