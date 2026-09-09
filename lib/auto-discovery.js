'use strict';
const { addressKey } = require('./amounts');
const { SETTLEMENT } = require('./lifi-readonly');
const ArbDetector = require('./arb-detector');
const { COMMON } = require('./wallet-scorer');

function tokenKey(t) { return t.chain + ':' + addressKey(t.address); }
function routeKey(o) {
  return [o.buyChain, addressKey(o.buyAddress), o.sellChain, addressKey(o.sellAddress)].join(':');
}
function universe(tokens) {
  return Object.values(tokens || {}).filter(t => !t.ignored && t.symbol && SETTLEMENT[t.chain] &&
    /^0x[0-9a-f]{40}$/i.test(t.address || '') && !COMMON.has(String(t.symbol).toUpperCase()))
    .sort((a, b) => tokenKey(a).localeCompare(tokenKey(b)));
}
// Oldest examined first: new assets start at zero, and a busy token cannot starve the tail.
function selectBatch(tokens, visits = {}, limit = 12) {
  const list = universe(tokens);
  return list.sort((a, b) => (visits[tokenKey(a)] || 0) - (visits[tokenKey(b)] || 0) ||
    Number(!!b.starred) - Number(!!a.starred) || tokenKey(a).localeCompare(tokenKey(b))).slice(0, limit);
}
async function discover(tokens, visits, settings, deps = {}) {
  const resolver = deps.resolver || require('./resolver');
  const prices = deps.prices || require('./prices');
  const now = deps.now || Date.now;
  const selected = selectBatch(tokens, visits);
  const groups = [], reasons = { noOfficialCrossChainMapping: 0, missingQuotes: 0, belowThreshold: 0 };
  for (const t of selected) {
    const resolved = resolver.resolveSymbol(t.symbol, { originChain: t.chain, originAddress: t.address });
    const entries = resolved.entries.filter(e => e.verified && SETTLEMENT[e.chain] && /^0x[0-9a-f]{40}$/i.test(e.address));
    if (new Set(entries.map(e => e.chain)).size < 2) { reasons.noOfficialCrossChainMapping++; continue; }
    groups.push({ token: t, entries });
  }
  const items = [...new Map(groups.flatMap(g => g.entries).map(e => [tokenKey(e), e])).values()];
  const quotes = items.length ? await prices.multiChainQuotes(items, settings) : [];
  const byToken = new Map(quotes.map(x => [tokenKey(x.input), x.quote]));
  const routes = new Map();
  let priced = 0;
  for (const g of groups) {
    const all = g.entries.map(e => {
      const q = byToken.get(tokenKey(e));
      return q ? { ...q, tokenAddress: e.address, verified: true, heuristic: false, verdict: 'official' } : null;
    }).filter(Boolean);
    if (new Set(all.map(q => q.chain)).size < 2) { reasons.missingQuotes++; continue; }
    priced++;
    const best = ArbDetector.evaluateBestOpportunity({ symbol: g.token.symbol, quotes: all, minLiquidityUsd: 5000 });
    if (!best || best.suspicious || best.verdict === 'fake' || best.spreadPct < 0.5) { reasons.belowThreshold++; continue; }
    routes.set(routeKey(best), { ...best, discoveredAt: now(), source: 'automatic_discovery' });
  }
  return { selected: selected.map(tokenKey), eligibleTokens: universe(tokens).length, addressQueries: items.length,
    returnedQuotes: quotes.length, priced, reasons, routes: [...routes.values()] };
}
module.exports = { discover, selectBatch, universe, tokenKey, routeKey };
