'use strict';
const store = require('./store');
const sources = require('./sources');
const prices = require('./prices');
const chains = require('./chains');
const resolver = require('./resolver');
const adjudicate = require('./adjudicate');

// 主流币白名单：不在名单里的 symbol 视为「陌生代币」，优先进入人工/自动审查队列。
const COMMON = new Set([
  'ETH', 'WETH', 'USDC', 'USDC.E', 'USDBC', 'USDT', 'DAI', 'WBTC', 'CBBTC', 'TBTC', 'WSTETH', 'STETH', 'RETH', 'CBETH',
  'WEETH', 'EZETH', 'RSETH', 'PXETH', 'FRXETH', 'SFRXETH', 'USDE', 'SUSDE', 'USDS', 'SDAI', 'SUSDS', 'BNB', 'WBNB',
  'SOL', 'WSOL', 'MSOL', 'JITOSOL', 'BSOL', 'JSOL', 'ARB', 'OP', 'MNT', 'POL', 'MATIC', 'AVAX', 'WAVAX', 'FTM', 'S',
  'BERA', 'UNI', 'LINK', 'AAVE', 'LDO', 'PENDLE', 'CRV', 'CVX', 'BAL', 'COMP', 'MKR', 'SKY', 'ENA', 'ONDO', 'PYUSD',
  'FDUSD', 'TUSD', 'USDP', 'GUSD', 'GHO', 'CRVUSD', 'FRAX', 'LUSD', 'DOLA', 'MIM', 'EURC', 'EURS', 'XAUT', 'PAXG',
  'RLUSD', 'USD0', 'USDF', 'XAUt', 'INJ', 'APT', 'SUI', 'TON', 'TRX', 'USDD', 'USDX', 'USDY', 'STKAAVE', 'RPL',
]);

const KNOWN_APP_HINTS = ['BRIDGE', 'OMNI', 'STARGATE', 'ACROSS', 'SQUID', 'MAYAN', 'DEBRIDGE', 'CCTP', 'PORTAL', 'WORMHOLE'];

// 套利闭环里的「回流腿」载体：卖掉代币后桥回去的通常是稳定币/主流 gas 资产，
// 而不是原币本身。用它来识别「币出去、钱回来」的真实套利闭环。
const MONEY_LEGS = new Set([
  'USDC', 'USDC.E', 'USDBC', 'USDT', 'DAI', 'USDE', 'SUSDE', 'USDS', 'SDAI', 'SUSDS',
  'PYUSD', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'GHO', 'CRVUSD', 'FRAX', 'LUSD', 'DOLA',
  'MIM', 'EURC', 'USD0', 'USDF', 'RLUSD', 'USDD', 'USDX', 'USDY',
  'ETH', 'WETH', 'WSTETH', 'STETH', 'WBNB', 'BNB', 'SOL', 'WSOL', 'POL', 'MATIC',
  'AVAX', 'WAVAX', 'FTM', 'S', 'BERA', 'MNT', 'WBTC', 'CBBTC',
]);

// 一笔「出去」和一笔「回来」相隔超过这个时间，就不再认为是同一次套利闭环
const CYCLE_WINDOW_MS = 7 * 86400000;

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
    const actors = new Set();
    if (walletWorthy(t.sender)) actors.add(t.sender);
    if (walletWorthy(t.receiver)) actors.add(t.receiver);

    for (const a of actors) {
      const key = a.toLowerCase();
      const w = d.wallets[key] || { address: a, firstSeen: new Date().toISOString(), tags: [], notes: '', starred: false, ignored: false, bridgeCount: 0, tokens: {}, chains: {}, sources: {}, dirs: {}, score: 0 };
      w.bridgeCount = (w.bridgeCount || 0) + 1;
      w.lastSeen = t.timestamp || new Date().toISOString();
      w.chains = w.chains || {};
      if (t.fromChain) w.chains[t.fromChain] = (w.chains[t.fromChain] || 0) + 1;
      if (t.toChain) w.chains[t.toChain] = (w.chains[t.toChain] || 0) + 1;
      w.sources = w.sources || {};
      w.sources[t.source] = (w.sources[t.source] || 0) + 1;
      w.tokens = w.tokens || {};
      if (sym) w.tokens[sym] = (w.tokens[sym] || 0) + 1;
      w.dirs = w.dirs || {};
      if (sym && t.fromChain && t.toChain) {
        const dk = `${sym}|${t.fromChain}>${t.toChain}`;
        w.dirs[dk] = (w.dirs[dk] || 0) + 1;
      }
      w.maxUsd = Math.max(w.maxUsd || 0, t.amountUsd || 0);
      // 精简流水：闭环检测需要「哪条链到哪条链、什么币、什么时间」这一层信息，
      // dirs 只存了计数，不足以判断时间先后。限长防止单钱包无限膨胀。
      w.flows = w.flows || [];
      w.flows.push({
        sym, from: t.fromChain || null, to: t.toChain || null,
        ts: t.timestamp || null, usd: t.amountUsd || 0, tx: t.txHash, src: t.source,
      });
      if (w.flows.length > 400) w.flows.shift();
      if (t.timestamp && (!w.firstSeen || t.timestamp < w.firstSeen)) w.firstSeen = t.timestamp;
      if (!d.wallets[key]) walletsTouched++;
      d.wallets[key] = w;
      store.touchWallet(key); // 增量持久化：标记本行已变更
    }

    const tk = t.tokenChain || t.fromChain;
    if (tk && t.tokenAddress && sym) {
      const key = store.tokenKey(tk, t.tokenAddress);
      const tok = d.tokens[key] || { chain: tk, address: String(t.tokenAddress).toLowerCase(), firstSeen: new Date().toISOString(), bridges: 0, wallets: {}, routes: {}, starred: false, ignored: false };
      tok.symbol = sym;
      tok.bridges = (tok.bridges || 0) + 1;
      tok.lastSeen = t.timestamp || new Date().toISOString();
      tok.routes = tok.routes || {};
      if (t.fromChain && t.toChain) {
        const rk = `${t.fromChain}>${t.toChain}`;
        tok.routes[rk] = (tok.routes[rk] || 0) + 1;
      }
      tok.wallets = tok.wallets || {};
      for (const a of actors) tok.wallets[a.toLowerCase()] = (tok.wallets[a.toLowerCase()] || 0) + 1;
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

// ---------------- 资金闭环检测（真实套利指纹） ----------------
// 套利的实际动作是：把代币 X 从 A 桥到 B → 在 B 卖掉换成 USDC → 把 USDC 从 B 桥回 A。
// 卖掉之后手上已经没有 X 了，所以回来的必然是钱，不是原币。
// 因此桥数据上真正的套利指纹是「非资金类代币 A→B 出去 + 资金类资产 B→A 回来」。
function detectCapitalCycles(w) {
  const flows = (w.flows || []).filter((f) => f.from && f.to && f.ts);
  if (flows.length < 2) return { cycles: 0, details: [] };
  const sorted = [...flows].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const used = new Set();
  const details = [];
  for (const back of sorted) {
    if (used.has(back)) continue;
    if (!MONEY_LEGS.has(back.sym)) continue; // 回流腿必须是资金类资产
    const match = sorted.find((f) =>
      !used.has(f) && f !== back
      && f.sym && !MONEY_LEGS.has(f.sym)     // 出去的是代币，不是钱
      && f.from === back.to && f.to === back.from   // 方向正好相反
      && new Date(f.ts) <= new Date(back.ts)        // 先出后回
      && (new Date(back.ts) - new Date(f.ts)) <= CYCLE_WINDOW_MS
    );
    if (!match) continue;
    used.add(match);
    used.add(back);
    details.push({
      token: match.sym, outChain: match.from, inChain: match.to, moneyLeg: back.sym,
      outTs: match.ts, backTs: back.ts,
      hours: Number(((new Date(back.ts) - new Date(match.ts)) / 3600000).toFixed(1)),
      outUsd: Math.round(match.usd || 0), backUsd: Math.round(back.usd || 0),
    });
  }
  return { cycles: details.length, details: details.slice(-12) };
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
    const tokenCount = Object.keys(w.tokens || {}).length;
    const chainCount = Object.keys(w.chains || {}).length;

    // 往返计数：同 symbol 存在 A>B 且 B>A
    let roundtrips = 0;
    const dirs = w.dirs || {};
    const pairs = {};
    for (const dk of Object.keys(dirs)) {
      const [sym, route] = dk.split('|');
      const [from, to] = route.split('>');
      const key = `${sym}|${[from, to].sort().join('~')}`;
      pairs[key] = pairs[key] || new Set();
      pairs[key].add(route);
    }
    const exotic = Object.keys(w.tokens || {}).filter((s) => !COMMON.has(s));
    for (const set of Object.values(pairs)) if (set.size >= 2) roundtrips += 1;

    // 资金闭环：比同币往返更硬的套利证据
    const cyc = detectCapitalCycles(w);
    w.capitalCycles = cyc.cycles;
    w.capitalCycleDetails = cyc.details;

    const recencyDays = w.lastSeen ? (now - new Date(w.lastSeen).getTime()) / 86400000 : 999;

    // 桥路由合约 / 中继器会出现在几乎每条记录里，把它当钱包去追没有意义
    const share = maxBridges > 0 ? (w.bridgeCount || 0) / maxBridges : 0;
    const likelyContract = (w.bridgeCount || 0) >= 25 && share > 0.35;
    w.likelyContract = likelyContract;

    let score = 0;
    // 基础活跃度：高频桥是必要不充分条件，权重压到 30，避免路由器/做市商靠次数冲顶
    score += Math.min(30, (w.bridgeCount || 0) * 2);
    score += Math.min(20, tokenCount * 3);
    score += Math.min(15, chainCount * 4);
    // 同币往返是弱信号（做市商调仓也会 A↔B 双向搬），大幅降权，仅作微弱加分
    score += Math.min(10, roundtrips * 3);
    // 资金闭环才是套利的决定性证据：1 次闭环 = 25 分，直接拉开与高频普通用户的差距
    score += Math.min(70, (w.capitalCycles || 0) * 25);
    score += recencyDays <= 1 ? 10 : recencyDays <= 3 ? 5 : 0;
    if ((w.maxUsd || 0) >= 100000) score += 8;
    if (likelyContract) score = Math.round(score * 0.25);

    w.roundtrips = roundtrips;
    w.tokenCount = tokenCount;
    w.chainCount = chainCount;
    w.exoticCount = exotic.length;
    w.score = Math.round(score);
    // 阈值按新总分上限（约 163）重设：A 级以资金闭环为主，B/C 级保留活跃度区分
    w.grade = w.score >= 70 ? 'A' : w.score >= 40 ? 'B' : w.score >= 20 ? 'C' : 'D';
    w.autoTags = [
      likelyContract ? '疑似桥合约' : null,
      (w.capitalCycles || 0) >= 2 ? '职业套利者' : null,
      (w.capitalCycles || 0) >= 1 ? '资金闭环' : null,
      // 同币往返更可能是做市商调仓或搬过去后撤单，不一定是套利
      roundtrips >= 2 ? '同币往返×2' : null,
      roundtrips >= 1 ? '同币往返' : null,
      (w.maxUsd || 0) >= 100000 ? '大额' : null,
      chainCount >= 3 ? '多链活跃' : null,
      exotic.length >= 3 ? '偏好冷门币' : null,
      (w.bridgeCount || 0) >= 20 ? '高频桥用户' : null,
      recencyDays <= 1 ? '24h 内活跃' : null,
    ].filter(Boolean);

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
    const officialAddrs = new Set(resolved.entries.filter((e) => e.verified).map((e) => `${e.chain}:${e.address.toLowerCase()}`));
    const searchUnverified = [];
    for (const q of sameSymbol) {
      if (officialAddrs.has(`${q.chain}:${String(q.tokenAddress || '').toLowerCase()}`)) {
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

    trusted = verifiedQuotes.slice();
    all = [...verifiedQuotes, ...heuristicPool];
    // 统一 verdict 标记（前端据此渲染确认/存疑徽标）
    for (const q of all) q.verdict = q.verified === true ? 'official' : 'suspicious';
  }

  // 补 explorer 代币页链接（快速路径的报价没有，统一补齐）
  for (const q of all) {
    if (!q.explorerUrl) q.explorerUrl = chains.tokenUrl(q.chain, q.tokenAddress);
  }

  // 4. 优先只在可信报价（official/confirmed）之间算价差；不足 2 条才退而求其次
  const isTrusted = (q) => q.verdict === 'official' || q.verdict === 'confirmed';
  const heuristics = all.filter((q) => !isTrusted(q) && q.verdict !== 'fake');
  const pool = trusted.length >= 2 ? trusted : [...trusted, ...heuristics];

  const result = { quotes: all, best: null, resolved, adjudicated, anchor, verdicts };
  if (pool.length >= 2) {
    const sorted = [...pool].sort((a, b) => a.priceUsd - b.priceUsd);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    if (low.priceUsd > 0 && high.chain !== low.chain) {
      const spreadPct = ((high.priceUsd - low.priceUsd) / low.priceUsd) * 100;
      const maxHeuristic = Number(settings.scan?.maxHeuristicSpreadPct) || 25;
      const anyUnverified = !isTrusted(low) || !isTrusted(high);
      // 未验证报价参与的价差，一律按更严格标准标记为可疑
      const suspicious = spreadPct > 100 || (anyUnverified && spreadPct > maxHeuristic);
      // 每条腿的独立裁决：official/confirmed = 已通过官方合约验证；其余为存疑
      const legVerdict = (q) => (q.verdict === 'official' || q.verdict === 'confirmed'
        ? 'confirmed' : (q.verdict === 'fake' ? 'fake' : 'suspicious'));
      const lowV = legVerdict(low);
      const highV = legVerdict(high);
      // 整体裁决：任一腿判假 → fake；任一腿存疑 → suspicious；都通过 → confirmed
      const verdict = lowV === 'fake' || highV === 'fake' ? 'fake'
        : (lowV === 'suspicious' || highV === 'suspicious' ? 'suspicious' : 'confirmed');
      result.best = {
        suspicious,
        verdict, // confirmed / suspicious / fake —— 前端据此渲染徽标与告警
        symbol: tok.symbol,
        buyChain: low.chain, buyChainName: chains.label(low.chain), buyPrice: low.priceUsd, buyDex: low.dex, buyUrl: low.pairUrl,
        // 核验入口：买入/卖出腿的代币合约地址 + 官方 explorer 代币页
        buyAddress: low.tokenAddress || null, buyExplorer: chains.tokenUrl(low.chain, low.tokenAddress), buyVerdict: lowV,
        sellChain: high.chain, sellChainName: chains.label(high.chain), sellPrice: high.priceUsd, sellDex: high.dex, sellUrl: high.pairUrl,
        sellAddress: high.tokenAddress || null, sellExplorer: chains.tokenUrl(high.chain, high.tokenAddress), sellVerdict: highV,
        spreadPct: Number(spreadPct.toFixed(3)),
        minLiquidityUsd: Math.min(low.liquidityUsd, high.liquidityUsd),
        heuristic: anyUnverified,
        verified: !anyUnverified,
        tokenKey: store.tokenKey(tok.chain || '', tok.address || ''),
      };
    }
  }

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
          if (r.best) {
            gates.priced++;
            if (r.best.verified === true) {
              gates.verified++;
              if (!r.best.suspicious) {
                gates.notSuspicious++;
                if (r.best.spreadPct >= gates.minSpread) {
                  gates.spread++;
                  if (r.best.minLiquidityUsd >= gates.minLiquidity) gates.liquidity++;
                }
              }
            }
          }
          // 防假币：只有「官方地址精确比价」得到的 verified 价差才能作为机会入库；
          // 由 symbol 搜索兜底拼出来的 unverified 价差，一律挡在机会库外，宁缺毋滥。
          const ok = r.best
            && r.best.verified === true
            && !r.best.suspicious
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

    if (found.length) report.opportunitiesNew = store.addOpportunities(found);
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
    w.bridgeCount = 0; w.tokens = {}; w.chains = {}; w.sources = {};
    w.dirs = {}; w.flows = []; w.maxUsd = 0; w.firstSeen = null; w.lastSeen = null;
    w.roundtrips = 0; w.capitalCycles = 0; w.capitalCycleDetails = [];
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
