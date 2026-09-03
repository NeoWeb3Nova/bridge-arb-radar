'use strict';
// 逐阶段测量 checkToken 耗时，定位真正瓶颈。
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const store = require('../lib/store');
const engine = require('../lib/engine');
const resolver = require('../lib/resolver');
const prices = require('../lib/prices');
const adjudicate = require('../lib/adjudicate');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function profileToken(t, settings) {
  const phases = [];
  function mark(name) { phases.push({ name, t: Date.now() }); }

  mark('start');
  let resolved = resolver.resolveSymbol(t.symbol, { originChain: t.chain, originAddress: t.address });
  mark('resolve');

  if (resolved.verifiedCount === 0 && t.symbol && !engine.COMMON.has(String(t.symbol).toUpperCase())) {
    await resolver.coingeckoLookup(t.symbol, settings).catch(() => null);
    resolved = resolver.resolveSymbol(t.symbol, { originChain: t.chain, originAddress: t.address });
    mark('coingecko');
  }

  const needAdj = resolved.ambiguous || resolved.entries.some((e) => e.source === 'bridge' && !e.verified);
  let all = [], quotes = [], adjudicated = false;

  if (needAdj) {
    const uniqueEntries = new Set(resolved.entries.map((e) => `${e.chain}:${e.address}`)).size;
    const adj = await adjudicate.adjudicateAmbiguous(t.symbol, resolved.entries, settings);
    mark('adjudicate');
    adjudicated = true;
    all = adj.quotes;
    console.log(`    [${t.symbol}] entries=${resolved.entries.length} unique=${uniqueEntries} quotes=${all.length}`);
  } else {
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
    mark('pick-best');

    const own = await prices.multiChainQuotes(addrItems, settings);
    mark('multi-quotes');

    const covered = new Set(own.map((x) => x.quote.chain));
    const sameSymbol = await prices.searchBySymbol(t.symbol, settings, { excludeChains: [...covered] });
    mark('search-symbol');

    quotes = own.map((x) => x.quote);
    all = [...quotes, ...sameSymbol];
  }

  return { symbol: t.symbol, phases, adjudicated, quoteCount: all.length };
}

async function main() {
  store.load();
  const settings = store.settings();
  const cands = engine.pickCandidates(12);
  console.log(`候选 ${cands.length} 个\n`);

  for (const t of cands) {
    const p = await profileToken(t, settings);
    const dur = [];
    for (let i = 1; i < p.phases.length; i++) {
      dur.push(`${p.phases[i].name}=${p.phases[i].t - p.phases[i - 1].t}ms`);
    }
    console.log(`${p.symbol}: total=${p.phases[p.phases.length - 1].t - p.phases[0].t}ms, quotes=${p.quoteCount}, adj=${p.adjudicated}, ${dur.join(', ')}`);
    await sleep(500);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
