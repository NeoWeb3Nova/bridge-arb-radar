'use strict';
const fs = require('fs');
const path = require('path');
const { validateCycle, DEFAULTS } = require('./cycle-validator');
const { SETTLEMENT } = require('./lifi-readonly');
const { discover, routeKey, universe, tokenKey } = require('./auto-discovery');
const file = path.join(__dirname, '..', 'data', 'paper-lab.json');
const DISCOVERY_MS = 30000;
const SIGNAL_TTL_MS = 180000;
let state, busy = false, discoveryBusy = false, timers = [];
function load() {
  if (!state) {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    state = { enabled: false, reports: [], visits: {}, queue: [], cooldowns: {}, sizes: {}, discoveryLog: [],
      ...saved, mode: 'automatic_discovery' };
  }
  return state;
}
function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(load(), null, 2));
  fs.renameSync(file + '.tmp', file);
}
function candidates() {
  const seen = new Set();
  return require('./store').raw().opportunities.filter(o => {
    if (!SETTLEMENT[o.buyChain] || !SETTLEMENT[o.sellChain] || o.buyChain === o.sellChain ||
      ![o.buyAddress, o.sellAddress].every(a => /^0x[0-9a-f]{40}$/i.test(a || '')) || seen.has(routeKey(o))) return false;
    seen.add(routeKey(o)); return true;
  }).map(o => ({ symbol: o.symbol, buyChain: o.buyChain, sellChain: o.sellChain,
    buyAddress: o.buyAddress, sellAddress: o.sellAddress, snapshotAt: o.ts, spreadPct: o.spreadPct }));
}
function snapshot() {
  const s = load(), eligible = universe(require('./store').raw().tokens);
  return { ok: true, enabled: s.enabled, busy, discoveryBusy, mode: s.mode, intervalSeconds: 30,
    defaults: DEFAULTS, providerBackoffUntil: s.providerBackoffUntil > Date.now() ? s.providerBackoffUntil : null, candidates: candidates(), reports: s.reports.slice(0, 100), samples: s.reports.length,
    nextRunAt: s.enabled ? s.nextRunAt || null : null,
    discovery: { eligibleTokens: eligible.length, examinedTokens: eligible.filter(t => s.visits[tokenKey(t)]).length,
      last: s.discoveryLog[0] || null, queueLength: s.queue.length, current: s.current || null },
    positiveIndications: s.reports.filter(r => r.status === 'POSITIVE_INDICATION').length };
}
function enqueue(routes, source = 'bridge_scan') {
  const s = load();
  if (!s.enabled) return 0;
  let added = 0;
  for (const r of routes) {
    const key = routeKey(r);
    if (!SETTLEMENT[r.buyChain] || !SETTLEMENT[r.sellChain] || r.buyChain === r.sellChain ||
      ![r.buyAddress, r.sellAddress].every(a => /^0x[0-9a-f]{40}$/i.test(a || ''))) continue;
    if ((s.cooldowns[key] || 0) > Date.now() || s.queue.some(q => routeKey(q) === key) || s.current?.key === key) continue;
    if (s.queue.length >= 50) break;
    const sizeIndex = s.sizes[key] || 0;
    const amountUsd = [100, 50, 200, 25][sizeIndex % 4];
    s.sizes[key] = sizeIndex + 1;
    s.queue.push({ ...r, source, amountUsd, dueAt: Date.now(), expiresAt: Date.now() + SIGNAL_TTL_MS });
    added++;
  }
  if (added) { save(); setImmediate(() => tick().catch(e => console.error('[paper-lab]', e.message))); }
  return added;
}
async function discoveryTick() {
  const s = load();
  if (!s.enabled || discoveryBusy) return;
  discoveryBusy = true;
  s.nextRunAt = Date.now() + DISCOVERY_MS;
  try {
    const d = require('./store').raw();
    const batch = await discover(d.tokens, s.visits, require('./store').settings());
    const ts = Date.now();
    for (const key of batch.selected) s.visits[key] = ts;
    // Do not retain stale identities after a token is removed.
    const activeKeys = new Set(universe(d.tokens).map(t => tokenKey(t)));
    for (const key of Object.keys(s.visits)) if (!activeKeys.has(key)) delete s.visits[key];
    s.discoveryLog.unshift({ ts, checked: batch.selected.length, eligibleTokens: batch.eligibleTokens,
      addressQueries: batch.addressQueries, returnedQuotes: batch.returnedQuotes,
      priced: batch.priced, found: batch.routes.length, reasons: batch.reasons });
    s.discoveryLog = s.discoveryLog.slice(0, 100);
    enqueue(batch.routes, 'automatic_discovery');
    save();
  } catch (e) {
    s.discoveryLog.unshift({ ts: Date.now(), error: e.message });
    s.discoveryLog = s.discoveryLog.slice(0, 100); save();
  } finally { discoveryBusy = false; }
}
async function check(params, internal = false) {
  if (busy) return { ok: false, error: '已有一次询价正在进行' };
  if (load().providerBackoffUntil > Date.now()) return { ok: false, error: '报价服务限流，已暂停至 ' + new Date(load().providerBackoffUntil).toISOString() };
  busy = true;
  const s = load();
  s.current = { key: routeKey(params), symbol: params.symbol || '', amountUsd: params.amountUsd, stage: 'four_leg_quotes' };
  try {
    const settings = require('./store').settings();
    const previous = internal && params.followupOf ? s.reports.find(r => r.id === params.followupOf && r.status === 'POSITIVE_INDICATION' && routeKey(r) === routeKey(params) && r.amountUsd === Number(params.amountUsd) && Date.now() >= (r.nextCheckAfter || Infinity)) : null;
    const report = await validateCycle(params, settings, { onStage: stage => { if (s.current) s.current.stage = stage; } });
    const rateLimit = (report.blockers || []).find(b => b.code === 'RATE_LIMITED');
    if (rateLimit?.retryAt) s.providerBackoffUntil = rateLimit.retryAt;
    report.source = internal ? params.source : 'manual';
    report.followupOf = previous?.id || null;
    report.repeatCount = report.status === 'POSITIVE_INDICATION' ? (previous?.repeatCount || 0) + 1 : 0;
    report.review = { state: 'NOT_QUALIFIED', executable: false };
    if (report.status === 'POSITIVE_INDICATION') {
      s.current.stage = 'security_check';
      try { report.security = await require('./security-checker').checkOpportunitySecurity({ ...params }, settings); }
      catch (e) { report.security = { safe: false, riskLevel: 'unknown', error: e.message }; }
      const blocked = report.security?.safe !== true || report.security?.unknown || report.security?.isHoneypot;
      report.review = { state: blocked ? 'SECURITY_UNCONFIRMED' : 'RECHECK_REQUIRED', executable: false,
        blockers: blocked ? ['合约安全数据未通过确认'] : [] };
      // A second, independent quote after estimated transfer time; no orders are ever sent.
      if (report.repeatCount < 2 && s.enabled) {
        s.queue = s.queue.filter(q => routeKey(q) !== routeKey(params));
        const dueAt = Math.max(report.nextCheckAfter || 0, Date.now() + 60000);
        s.queue.unshift({ symbol: params.symbol, buyChain: params.buyChain, sellChain: params.sellChain,
          buyAddress: params.buyAddress, sellAddress: params.sellAddress, amountUsd: report.amountUsd,
          source: 'automatic_recheck', followupOf: report.id, repeatCount: report.repeatCount,
          dueAt, expiresAt: dueAt + SIGNAL_TTL_MS });
      } else if (report.repeatCount >= 2) {
        report.review.state = blocked ? 'SECURITY_UNCONFIRMED' : 'WALLET_SIMULATION_REQUIRED';
        report.review.blockers.push('未完成真实钱包余额、授权和交易模拟；需要用户签名');
        require('./events').broadcast('paper_signal', { report });
      }
    } else if (previous) {
      report.review.state = 'SIGNAL_NOT_REPEATED';
    }
    s.cooldowns[routeKey(params)] = Date.now() + 300000;
    s.reports.unshift(report); s.reports = s.reports.slice(0, 500); save();
    return { ok: true, report };
  } finally { busy = false; s.current = null; }
}
async function tick() {
  const s = load();
  if (!s.enabled || busy) return;
  s.queue = s.queue.filter(q => {
    if (q.expiresAt > Date.now()) return true;
    const parent = q.followupOf && s.reports.find(r => r.id === q.followupOf);
    if (parent?.review) parent.review = { state: 'RECHECK_EXPIRED', executable: false, blockers: ['复测排队已过期，需要重新发现与验证'] };
    return false;
  });
  // Due rechecks take priority over newly discovered routes, without blocking discovery itself.
  const i = s.queue.findIndex(q => q.dueAt <= Date.now());
  if (i < 0 || s.providerBackoffUntil > Date.now()) return;
  const [candidate] = s.queue.splice(i, 1);
  await check(candidate, true);
}
function configure(enabled) {
  const s = load(); s.enabled = enabled === true;
  s.nextRunAt = s.enabled ? Date.now() : null;
  if (!s.enabled) s.queue = [];
  save();
  if (s.enabled) setImmediate(() => discoveryTick().catch(e => console.error('[discovery]', e.message)));
  return snapshot();
}
function start() {
  if (timers.length) return;
  const s = load(); s.current = null;
  timers = [setInterval(() => discoveryTick().catch(e => console.error('[discovery]', e.message)), DISCOVERY_MS),
    setInterval(() => tick().catch(e => console.error('[paper-lab]', e.message)), 5000)];
  timers.forEach(t => t.unref?.());
  if (s.enabled) setImmediate(() => discoveryTick().catch(e => console.error('[discovery]', e.message)));
}
module.exports = { snapshot, check, configure, start, tick, enqueue, discoveryTick };
