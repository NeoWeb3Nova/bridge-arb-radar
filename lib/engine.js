'use strict';
const { addressKey } = require('./amounts');
const store = require('./store');
const sources = require('./sources');
const prices = require('./prices');
const chains = require('./chains');
const resolver = require('./resolver');
const adjudicate = require('./adjudicate');
const walletScorer = require('./wallet-scorer');
const ArbDetector = require('./arb-detector');
const securityChecker = require('./security-checker');
const events = require('./events');
const notifier = require('./notifier');

const { COMMON, MONEY_LEGS, CYCLE_WINDOW_MS, detectCapitalCycles, scoreSingleWallet } = walletScorer;

const KNOWN_APP_HINTS = ['BRIDGE', 'OMNI', 'STARGATE', 'ACROSS', 'SQUID', 'MAYAN', 'DEBRIDGE', 'CCTP', 'PORTAL', 'WORMHOLE'];



function isEvmAddr(a) { return typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a); }
function isSolAddr(a) { return typeof a === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a); }

/** 判断一个地址值是否值得纳入钱包库（排除合约/系统地址意义不大，但先全收再做筛选） */
function walletWorthy(a) { return isEvmAddr(a) || isSolAddr(a); }

function chainOfAddress(addr) {
  if (isEvmAddr(addr)) return null; // EVM 地址跨链通用，单独用链记录
  if (isSolAddr(addr)) return 'solana';
  return null;
}

// ---------------- 沉淀：把 transfer 记入钱包库 / 代币库 ----------------
function absorb(transfers) {
  const d = store.raw();
  let walletsTouched = 0;
  let tokensTouched = 0;

  for (const t of transfers) {
    const sym = (t.tokenSymbol || '').toUpperCase();
    const senderWorthy = walletWorthy(t.sender);
    const receiverWorthy = walletWorthy(t.receiver);
    const senderKey = senderWorthy ? addressKey(t.sender) : null;
    const receiverKey = receiverWorthy ? addressKey(t.receiver) : null;
    const isSelfBridge = Boolean(senderKey && receiverKey && senderKey === receiverKey);

    // 1. 发起方（Sender）：真正主动跨链的钱包实体（或者自跨链）
    if (senderKey) {
      const ws = d.wallets[senderKey] || {
        address: t.sender, firstSeen: new Date().toISOString(), tags: [], notes: '',
        starred: false, ignored: false, bridgeCount: 0, sentCount: 0, receivedCount: 0,
        tokens: {}, chains: {}, sources: {}, dirs: {}, score: 0
      };
      ws.sentCount = (ws.sentCount || 0) + 1;
      ws.bridgeCount = (ws.sentCount || 0) + (ws.receivedCount || 0);
      ws.lastSeen = t.timestamp || new Date().toISOString();
      ws.chains = ws.chains || {};
      if (t.fromChain) ws.chains[t.fromChain] = (ws.chains[t.fromChain] || 0) + 1;
      if (isSelfBridge && t.toChain) ws.chains[t.toChain] = (ws.chains[t.toChain] || 0) + 1;
      ws.sources = ws.sources || {};
      ws.sources[t.source] = (ws.sources[t.source] || 0) + 1;
      ws.tokens = ws.tokens || {};
      if (sym) ws.tokens[sym] = (ws.tokens[sym] || 0) + 1;
      ws.dirs = ws.dirs || {};
      if (sym && t.fromChain && t.toChain) {
        const dk = `${sym}|${t.fromChain}>${t.toChain}`;
        ws.dirs[dk] = (ws.dirs[dk] || 0) + 1;
      }
      ws.maxUsd = Math.max(ws.maxUsd || 0, t.amountUsd || 0);
      ws.flows = ws.flows || [];
      ws.flows.push({
        sym, from: t.fromChain || null, to: t.toChain || null,
        ts: t.timestamp || null, usd: t.amountUsd || 0, tx: t.txHash, src: t.source,
        role: isSelfBridge ? 'self' : 'sender',
        peer: receiverKey || null,
      });
      if (ws.flows.length > 400) ws.flows.shift();
      if (t.timestamp && (!ws.firstSeen || t.timestamp < ws.firstSeen)) ws.firstSeen = t.timestamp;
      if (!d.wallets[senderKey]) walletsTouched++;
      d.wallets[senderKey] = ws;
      store.touchWallet(senderKey);
    }

    // 2. 接收方（Receiver）：仅当不同于发送方时，作为独立地址记入被动接收统计
    if (receiverKey && !isSelfBridge) {
      const wr = d.wallets[receiverKey] || {
        address: t.receiver, firstSeen: new Date().toISOString(), tags: [], notes: '',
        starred: false, ignored: false, bridgeCount: 0, sentCount: 0, receivedCount: 0,
        tokens: {}, chains: {}, sources: {}, dirs: {}, score: 0
      };
      wr.receivedCount = (wr.receivedCount || 0) + 1;
      wr.bridgeCount = (wr.sentCount || 0) + (wr.receivedCount || 0);
      wr.lastSeen = t.timestamp || new Date().toISOString();
      wr.chains = wr.chains || {};
      // 接收方仅在目标链有到账，绝不能虚增其在源链的活跃度
      if (t.toChain) wr.chains[t.toChain] = (wr.chains[t.toChain] || 0) + 1;
      wr.sources = wr.sources || {};
      wr.sources[t.source] = (wr.sources[t.source] || 0) + 1;
      wr.tokens = wr.tokens || {};
      if (sym) wr.tokens[sym] = (wr.tokens[sym] || 0) + 1;
      // 注意：接收方并未主动发起跨链，严禁写入 dirs 导致虚假同币往返
      wr.maxUsd = Math.max(wr.maxUsd || 0, t.amountUsd || 0);
      wr.flows = wr.flows || [];
      wr.flows.push({
        sym, from: t.fromChain || null, to: t.toChain || null,
        ts: t.timestamp || null, usd: t.amountUsd || 0, tx: t.txHash, src: t.source,
        role: 'receiver',
        peer: senderKey || null,
      });
      if (wr.flows.length > 400) wr.flows.shift();
      if (t.timestamp && (!wr.firstSeen || t.timestamp < wr.firstSeen)) wr.firstSeen = t.timestamp;
      if (!d.wallets[receiverKey]) walletsTouched++;
      d.wallets[receiverKey] = wr;
      store.touchWallet(receiverKey);
    }

    const tk = t.tokenChain || t.fromChain;
    if (tk && t.tokenAddress && sym) {
      const key = store.tokenKey(tk, t.tokenAddress);
      const tok = d.tokens[key] || { chain: tk, address: addressKey(t.tokenAddress), firstSeen: new Date().toISOString(), bridges: 0, wallets: {}, routes: {}, starred: false, ignored: false };
      tok.symbol = sym;
      tok.bridges = (tok.bridges || 0) + 1;
      tok.lastSeen = t.timestamp || new Date().toISOString();
      tok.routes = tok.routes || {};
      if (t.fromChain && t.toChain) {
        const rk = `${t.fromChain}>${t.toChain}`;
        tok.routes[rk] = (tok.routes[rk] || 0) + 1;
      }
      tok.wallets = tok.wallets || {};
      if (senderKey) tok.wallets[senderKey] = (tok.wallets[senderKey] || 0) + 1;
      if (receiverKey && receiverKey !== senderKey) tok.wallets[receiverKey] = (tok.wallets[receiverKey] || 0) + 1;
      tok.unknown = !COMMON.has(sym);
      tok.maxUsd = Math.max(tok.maxUsd || 0, t.amountUsd || 0);
      if (!d.tokens[key]) tokensTouched++;
      d.tokens[key] = tok;
      store.touchToken(key); // 增量持久化：标记本行已变更
    }
  }
  store.save();
  return { walletsTouched, tokensTouched };
}



// ---------------- 钱包评分与自动标签 ----------------
function scoreWallets() {
  const d = store.raw();
  const now = Date.now();
  const all = Object.values(d.wallets);
  const maxBridges = all.reduce((m, w) => Math.max(m, w.bridgeCount || 0), 0);
  // 评分是「全量重算」，但绝大多数钱包每次算出来的结果和上次一样。
  // 只对真正变化的行打脏标记，避免每次扫描都回写 2000+ 个没变的钱包。
  const sig = (w) => `${w.score}|${w.grade}|${(w.autoTags || []).join(',')}|${w.roundtrips || 0}|${w.capitalCycles || 0}|${w.tokenCount}|${w.chainCount}|${w.exoticCount}`;
  let scoreChanged = 0;
  for (const [key, w] of Object.entries(d.wallets)) {
    const before = sig(w);
    scoreSingleWallet(w, maxBridges, now);
    if (sig(w) !== before) { store.touchWallet(key); scoreChanged++; }
  }
  store.save();
  return { scored: all.length, changed: scoreChanged };
}

// ---------------- 候选代币挑选 ----------------
function pickCandidates(limit = 12) {
  const d = store.raw();
  const arr = Object.values(d.tokens).filter((t) => !t.ignored);
  const score = (t) => {
    let s = 0;
    if (t.starred) s += 1000;
    if (t.unknown) s += 30;
    s += Math.min(40, (t.bridges || 0) * 2);
    s += Math.min(30, Object.keys(t.wallets || {}).length * 4);
    if (!t.checkedAt) s += 20;
    const ageHours = t.checkedAt ? (Date.now() - new Date(t.checkedAt).getTime()) / 3600000 : 999;
    s += Math.min(15, ageHours / 2);
    return s;
  };
  arr.sort((a, b) => score(b) - score(a));
  return arr.slice(0, limit);
}

// ---------------- 单个代币的跨链价差检查 ----------------
// 防假币关键：不再用 symbol 模糊搜索作为主路径。先经 resolver 解析该 symbol 在各链的
// 官方合约地址，只对官方地址做精确报价（verified）；symbol 搜索仅作兜底，且结果必须
// 与官方地址交叉比对，搜出来的地址不在官方列表里的一律标记 unverified（假币嫌疑）。
// 当 symbol 存在「同名多合约 / 链上假币嫌疑」时，走 adjudicate 自动裁决：
// 按链价格联动（真币跨链同价、假币天差地别）+ 官方 explorer 二次确认（链上 symbol 核对）。
async function checkToken(tok, settings, persist = true) {
  let resolved = resolver.resolveSymbol(tok.symbol, {
    originChain: tok.chain, originAddress: tok.address,
  });
  // 官方注册表（Trust Wallet）没覆盖、且非主流白名单的币，尝试 CoinGecko 补全官方多链地址
  if (resolved.verifiedCount === 0 && tok.symbol && !COMMON.has(String(tok.symbol).toUpperCase())) {
    await resolver.coingeckoLookup(tok.symbol, settings).catch(() => null);
    resolved = resolver.resolveSymbol(tok.symbol, {
      originChain: tok.chain, originAddress: tok.address,
    });
  }

  // 是否触发自动裁决：同名多合约，或存在「链上出现过但未官方验证」的桥地址（假币嫌疑）
  const needAdj = resolved.ambiguous || resolved.entries.some((e) => e.source === 'bridge' && !e.verified);

  let all = [];
  let trusted = [];
  let fakes = [];
  let verdicts = [];
  let anchor = null;
  let adjudicated = false;

  if (needAdj) {
    const adj = await adjudicate.adjudicateAmbiguous(tok.symbol, resolved.entries, settings);
    adjudicated = true;
    anchor = adj.anchor;
    verdicts = adj.verdicts;
    all = adj.quotes;
    trusted = all.filter((q) => q.verdict === 'official' || q.verdict === 'confirmed');
    fakes = all.filter((q) => q.verdict === 'fake');
  } else {
    // 原有快速路径：官方地址精确报价 + symbol 兜底（无假币嫌疑时更省请求）
    // 每条链只取「可信度最高」的一个候选地址：verified 优先，其次才看来源。
    const byChainBest = new Map();
    const rankOf = (e) => (e.verified ? 0 : 1);
    for (const e of resolved.entries) {
      const prev = byChainBest.get(e.chain);
      if (!prev || rankOf(e) < rankOf(prev)
        || (rankOf(e) === rankOf(prev) && (resolver.SOURCE_RANK[e.source] ?? 9) < (resolver.SOURCE_RANK[prev.source] ?? 9))) {
        byChainBest.set(e.chain, e);
      }
    }
    const addrItems = [...byChainBest.values()].slice(0, 12).map((e) => ({ chain: e.chain, address: e.address, source: e.source, verified: e.verified }));

    // 1. 官方/桥地址 → 精确报价（只认地址，不认 symbol）；verified 标记随地址走
    const own = await prices.multiChainQuotes(addrItems, settings);
    const quoteMap = new Map();
    const verifiedQuotes = [];
    const onchainUnverified = [];
    for (const x of own) {
      const verified = x.input.verified === true;
      const q = Object.assign(x.quote, { heuristic: !verified, verified, tokenAddress: x.input.address, source: x.input.source });
      quoteMap.set(q.chain, q);
      if (verified) verifiedQuotes.push(q);
      else onchainUnverified.push(q);
    }

    // 2. symbol 搜索兜底：只补已覆盖链之外的链，并与官方地址交叉比对
    const covered = new Set([...quoteMap.keys()]);
    const sameSymbol = await prices.searchBySymbol(tok.symbol, settings, { excludeChains: [...covered] });
    const officialAddrs = new Set(resolved.entries.filter((e) => e.verified).map((e) => `${e.chain}:${addressKey(e.address)}`));
    const searchUnverified = [];
    for (const q of sameSymbol) {
      if (officialAddrs.has(`${q.chain}:${addressKey(q.tokenAddress)}`)) {
        q.heuristic = false; q.verified = true; q.source = 'bridge';
        if (!quoteMap.has(q.chain)) { quoteMap.set(q.chain, q); verifiedQuotes.push(q); }
      } else {
        q.verified = false; q.heuristic = true;
        searchUnverified.push(q);
      }
    }

    // 3. 未验证报价（链上出现但未官方验证 + symbol 搜出来的）再做价格离群过滤
    const unverified = [...onchainUnverified, ...searchUnverified];
    let heuristicPool = unverified.slice(0, 6);
    if (verifiedQuotes.length) {
      const anchorPrice = verifiedQuotes[0].priceUsd;
      heuristicPool = heuristicPool.filter((q) => {
        const ratio = q.priceUsd > 0 && anchorPrice > 0 ? Math.max(q.priceUsd / anchorPrice, anchorPrice / q.priceUsd) : 1;
        return ratio <= 3;
      });
    }

    // 官方地址多链价格一致性校验：真币跨链价差通常在 15% 以内，若偏离 >= 2.0x 则判定为同名不同币或操纵假池
    if (verifiedQuotes.length >= 2) {
      const vPrices = verifiedQuotes.map((q) => q.priceUsd).filter((p) => p > 0);
      if (vPrices.length >= 2) {
        const minP = Math.min(...vPrices);
        const maxP = Math.max(...vPrices);
        if (minP > 0 && (maxP / minP) >= 2.0) {
          // 存在严重跨链价格分裂（偏离 >= 2.0x），以低价/稳定端或几何中位数甄别
          const vMedian = vPrices.length === 2 ? Math.min(...vPrices) : (vPrices.reduce((a, b) => a + b, 0) / vPrices.length);
          for (const q of verifiedQuotes) {
            if (q.priceUsd > 0 && vMedian > 0) {
              const ratio = Math.max(q.priceUsd / vMedian, vMedian / q.priceUsd);
              if (ratio >= 2.0) {
                q.verified = false;
                q.heuristic = true;
                q.verdict = 'fake';
                q.fakeReason = `跨链价格偏离 ${ratio.toFixed(1)}×（证实为同名不同资产或操纵池）`;
              }
            }
          }
        }
      }
    }

    trusted = verifiedQuotes.filter((q) => q.verified === true);
    all = [...verifiedQuotes, ...heuristicPool];
    // 统一 verdict 标记（前端据此渲染确认/存疑徽标）
    for (const q of all) {
      if (q.verdict === 'fake') continue;
      q.verdict = q.verified === true ? 'official' : 'suspicious';
    }
  }

  // 补 explorer 代币页链接（快速路径的报价没有，统一补齐）
  for (const q of all) {
    if (!q.explorerUrl) q.explorerUrl = chains.tokenUrl(q.chain, q.tokenAddress);
  }

  // 4. 委派给 ArbDetector 计算可信价差、最佳买卖腿与假币裁决
  const isTrusted = (q) => ArbDetector.isTrustedQuote(q);
  const maxHeuristic = Number(settings.scan?.maxHeuristicSpreadPct) || 25;
  const minLiq = Number(settings.scan?.minLiquidityUsd) || 500;
  const best = ArbDetector.evaluateBestOpportunity({
    symbol: tok.symbol,
    quotes: all,
    tokenKey: store.tokenKey(tok.chain || '', tok.address || ''),
    maxHeuristicSpreadPct: maxHeuristic,
    minLiquidityUsd: minLiq,
  });

  if (best && (best.buyAddress || best.sellAddress)) {
    await securityChecker.checkOpportunitySecurity(best, settings).catch(() => null);
    // 重新根据貔貅体检结果同步评分与评语
    const sc = ArbDetector.calculateOpportunityScore(best);
    best.qualityScore = sc.qualityScore;
    best.qualityGrade = sc.qualityGrade;
    best.scoreComment = sc.scoreComment;
  }

  const result = { quotes: all, best, resolved, adjudicated, anchor, verdicts };

  if (persist !== false) {
    store.upsertToken(tok.chain, tok.address, {
      checkedAt: new Date().toISOString(),
      bestSpread: result.best ? result.best.spreadPct : 0,
      canonical: resolved.entries.map((e) => ({ chain: e.chain, address: e.address, source: e.source })),
      ambiguous: resolved.ambiguous,
      adjudicated,
      adjudication: adjudicated ? { anchor, verdicts: verdicts.map((v) => ({ chain: v.chain, address: v.address, verdict: v.verdict, reason: v.reason })) } : null,
      quotes: all.map((q) => ({
        chain: q.chain, dex: q.dex, priceUsd: q.priceUsd, liquidityUsd: q.liquidityUsd,
        volume24h: q.volume24h, url: q.pairUrl, heuristic: !!q.heuristic, verified: isTrusted(q),
        verdict: q.verdict, tokenAddress: q.tokenAddress, source: q.source,
      })),
    });
  }
  return result;
}

// ---------------- 管道漏斗 ----------------
// 把一次扫描拆成有序阶段，每阶段记录进/出条数与淘汰原因，前端据此画转化率漏斗。
// 注意：比价段用链式口径（下一道闸门的 in 就是上一道的 out），所以漏斗必然单调递减。
function buildFunnel(o) {
  const g = o.gates;
  const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US');
  // 理论上限是「源数 × 每源 limit」，但部分源不理会 limit（会多返回），
  // 取二者较大值兜底，避免 out > in 导致转化率算出 >100% 的假象。
  const requested = Math.max(o.sourceCount * o.limit, o.fetched);
  const overFetched = o.fetched > o.sourceCount * o.limit;
  const stages = [
    {
      key: 'fetch', label: '数据源拉取', unit: '条',
      in: requested, out: o.fetched,
      note: `${o.sourceCount} 个数据源并发，每源请求上限 ${o.limit}${overFetched ? '（部分源未按上限截断，实收更多）' : ''}`,
    },
    {
      key: 'normalize', label: '结构校验', unit: '条',
      in: o.fetched, out: o.valid,
      note: '需要同时具备 txHash 与至少一侧链名',
    },
    {
      key: 'dedupe', label: '去重入库', unit: '条',
      in: o.valid, out: o.added,
      note: `过滤历史重复 ${o.duplicates} 条`,
    },
    {
      key: 'absorb', label: '实体沉淀', unit: '条',
      in: o.added, out: o.added,
      note: `触及钱包 ${o.walletsTouched} 个 / 代币 ${o.tokensTouched} 个`,
    },
    {
      key: 'candidates', label: '比价候选', unit: '个',
      in: o.tokenTotal, out: g.candidates,
      note: '按星标 / 桥次数 / 未检查时长评分取前 N',
      skipped: !o.priceCheckRan,
    },
    {
      key: 'priced', label: '多链报价', unit: '个',
      in: g.candidates, out: g.priced,
      note: `拿到 ≥2 条链报价才计入；假币裁决 ${g.adjudicated} 个，剔除假报价 ${g.fakeQuotes} 条`,
      skipped: !o.priceCheckRan,
    },
    {
      key: 'verified', label: '官方地址验证', unit: '个',
      in: g.priced, out: g.verified,
      note: '只认官方/已确认合约地址的报价，symbol 搜索兜底一律挡在门外',
      skipped: !o.priceCheckRan,
    },
    {
      key: 'outlier', label: '离群过滤', unit: '个',
      in: g.verified, out: g.notSuspicious,
      note: '剔除异常价差（>100%，或未验证报价超启发式阈值）',
      skipped: !o.priceCheckRan,
    },
    {
      key: 'spread', label: '价差阈值', unit: '个',
      in: g.notSuspicious, out: g.spread,
      note: `价差 ≥ ${g.minSpread}%`,
      skipped: !o.priceCheckRan,
    },
    {
      key: 'liquidity', label: '流动性阈值', unit: '个',
      in: g.spread, out: g.liquidity,
      note: `两条腿中较小者 ≥ ${usd(g.minLiquidity)}`,
      skipped: !o.priceCheckRan,
    },
    {
      key: 'stored', label: '机会入库', unit: '个',
      in: g.liquidity, out: g.stored,
      note: '与机会库已有记录去重',
      skipped: !o.priceCheckRan,
    },
  ];
  return stages.map((s) => {
    const dropped = Math.max(0, (s.in || 0) - (s.out || 0));
    return {
      ...s,
      dropped,
      rate: s.in > 0 ? Number(((s.out / s.in) * 100).toFixed(1)) : 0,
      skipped: !!s.skipped,
    };
  });
}

// ---------------- 主扫描 ----------------
async function runScan(opts = {}) {
  const settings = store.settings();
  const d = store.raw();
  const limit = opts.limit || 200;
  const lookback = (settings.scan?.lookbackHours || 24) * 3600000;
  const since = new Date(Date.now() - lookback).toISOString();
  const ctx = { settings, since, limit };

  const list = opts.sourceIds && opts.sourceIds.length
    ? sources.ALL.filter((s) => opts.sourceIds.includes(s.id))
    : sources.ALL.filter((s) => (settings.sources?.[s.id] ? settings.sources[s.id].enabled !== false : true));

  const t0 = Date.now();
  const report = { startedAt: new Date().toISOString(), sources: {}, added: 0, walletsNew: 0, tokensNew: 0, opportunitiesNew: 0 };
  const collected = [];

  await Promise.all(list.map(async (s) => {
    try {
      const r = await s.fetchTransfers(ctx);
      if (r.ok) { collected.push(...r.transfers); report.sources[s.id] = { ok: true, count: r.transfers.length }; }
      else report.sources[s.id] = { ok: false, error: r.error, count: 0 };
    } catch (err) {
      report.sources[s.id] = { ok: false, error: err.message, count: 0 };
    }
  }));
  const tFetch = Date.now();

  const valid = collected.filter((t) => t && t.txHash && (t.fromChain || t.toChain));
  // 只对新增记录沉淀：重复扫描时历史记录已入库，再算一遍会虚增钱包计数
  const addedList = store.addTransfers(valid);
  report.added = addedList.length;
  const absorbed = absorb(addedList);
  const tStore = Date.now();
  report.walletsNew = absorbed.walletsTouched;
  report.tokensNew = absorbed.tokensTouched;
  scoreWallets();

  // 自动比价
  // 逐闸门链式计数：只有同时通过前一道闸门的样本才计入下一道，保证漏斗单调递减
  const gates = {
    candidates: 0, adjudicated: 0, fakeQuotes: 0, priced: 0,
    verified: 0, notSuspicious: 0, spread: 0, liquidity: 0, stored: 0, errors: 0,
    minSpread: Number(settings.scan.spreadAlertPct) || 1.5,
    minLiquidity: Number(settings.scan.minLiquidityUsd) || 5000,
  };
  if (opts.priceCheck !== false && settings.scan.autoPriceCheck !== false) {
    const cands = pickCandidates(opts.priceLimit || 12);
    gates.candidates = cands.length;
    const found = [];

    // 并发检查代币：每个 checkToken 内部已走批量 DexScreener 端点，
    // 但 searchBySymbol / CoinGecko 仍可能发请求，控制并发避免触发外部限速。
    const CHECK_CONCURRENCY = 4;
    let i = 0;
    async function checker() {
      while (i < cands.length) {
        const t = cands[i++];
        try {
          const r = await checkToken(t, settings);
          if (r.adjudicated) gates.adjudicated++;
          gates.fakeQuotes += (r.quotes || []).filter((q) => q.verdict === 'fake').length;
          if (r.best?.security?.isHoneypot) gates.fakeQuotes++;
          if (r.best) {
            gates.priced++;
            if (r.best.verified === true) {
              gates.verified++;
              if (!r.best.suspicious && !r.best.security?.isHoneypot) {
                gates.notSuspicious++;
                if (r.best.spreadPct >= gates.minSpread) {
                  gates.spread++;
                  if (r.best.minLiquidityUsd >= gates.minLiquidity) gates.liquidity++;
                }
              }
            }
          }
          // 防假币：只有「官方地址精确比价」且无貔貅风险得到的 verified 价差才能作为机会入库；
          // 由 symbol 搜索兜底拼出来的 unverified 价差，或智能合约被检出貔貅的，一律挡在机会库外，宁缺毋滥。
          const ok = r.best
            && r.best.verified === true
            && !r.best.suspicious
            && !r.best.security?.isHoneypot
            && r.best.spreadPct >= gates.minSpread
            && r.best.minLiquidityUsd >= gates.minLiquidity;
          if (ok) found.push(r.best);
        } catch (e) {
          gates.errors++;
          report.sources.priceError = { ok: false, error: e.message };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, cands.length) }, checker));

    if (found.length) {
      report.opportunitiesNew = store.addOpportunities(found);
      require('./paper-lab').enqueue(found, 'bridge_scan');
      events.broadcast('opportunities', { count: report.opportunitiesNew, items: found });
      try {
        notifier.notifyOpportunities(found, { settings });
      } catch (err) {
        console.error('[Notifier] Error sending opportunities notification:', err.message);
      }
    }
    gates.stored = report.opportunitiesNew;
    report.checked = cands.length;
  }
  report.gates = gates;
  // 分段耗时：扫描动辄几分钟，不记录就只能靠猜是哪一段慢
  const tPrice = Date.now();
  report.timings = {
    fetchMs: tFetch - t0,
    storeMs: tStore - tFetch,
    priceMs: tPrice - tStore,
    totalMs: tPrice - t0,
  };
  report.funnel = buildFunnel({
    sourceCount: list.length,
    limit,
    fetched: collected.length,
    valid: valid.length,
    added: report.added,
    duplicates: valid.length - report.added,
    priceCheckRan: opts.priceCheck !== false && settings.scan.autoPriceCheck !== false,
    tokenTotal: Object.keys(d.tokens).length,
    walletsTouched: report.walletsNew,
    tokensTouched: report.tokensNew,
    gates,
  });

  d.stats.scans = (d.stats.scans || 0) + 1;
  d.stats.lastScanAt = new Date().toISOString();
  store.touchMeta(); // stats 存在 meta 表
  report.finishedAt = d.stats.lastScanAt;
  store.log({ type: 'scan', report });
  store.save();

  // 广播扫描完成事件到所有前端长连接
  events.broadcast('scan_completed', { report, lastScanAt: d.stats.lastScanAt });
  return report;
}

/** 手动/外部导入：把任意结构的记录归一化后入库 */
function importRecords(records, source = 'manual') {
  const list = (records || []).map((r) => Object.assign({
    source, txHash: null, fromChain: null, toChain: null, tokenChain: null,
    sender: null, receiver: null, tokenAddress: null, tokenSymbol: null,
    amount: null, amountUsd: null, timestamp: new Date().toISOString(), app: null,
  }, r, { source: r.source || source }));
  const valid = list.filter((t) => t.txHash);
  const addedList = store.addTransfers(valid);
  const absorbed = absorb(addedList);
  scoreWallets();
  store.log({ type: 'import', source, added: addedList.length });
  return { added: addedList.length, ...absorbed };
}

/** 从已入库的 transfers 全量重建统计：修复历史虚增 / 应用新的检测逻辑。
 *  用户手工维护的字段（备注、标签、星标、忽略、别名）保留不动。 */
function rebuildFromTransfers() {
  const d = store.raw();
  store.markFull(); // 全表重算，逐行标记没有意义，本次保存直接走全量重写
  for (const w of Object.values(d.wallets)) {
    w.bridgeCount = 0; w.sentCount = 0; w.receivedCount = 0;
    w.tokens = {}; w.chains = {}; w.sources = {};
    w.dirs = {}; w.flows = []; w.maxUsd = 0; w.firstSeen = null; w.lastSeen = null;
    w.roundtrips = 0; w.capitalCycles = 0; w.capitalCycleDetails = [];
    w.passiveAccount = false;
  }
  for (const t of Object.values(d.tokens)) {
    t.bridges = 0; t.wallets = {}; t.routes = {}; t.maxUsd = 0;
  }
  store.save();
  const res = absorb(d.transfers);
  scoreWallets();
  store.log({ type: 'rebuild', transfers: d.transfers.length });
  return { ...res, transfers: d.transfers.length };
}

module.exports = { runScan, scoreWallets, checkToken, importRecords, COMMON, pickCandidates, detectCapitalCycles, rebuildFromTransfers, buildFunnel };
