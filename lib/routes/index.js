'use strict';
const store = require('../store');
const sources = require('../sources');
const engine = require('../engine');
const prices = require('../prices');
const chains = require('../chains');
const resolver = require('../resolver');
const db = require('../db');
const quoter = require('../crosschain-quoter');
const ArbDetector = require('../arb-detector');
const securityChecker = require('../security-checker');
const { stamp, buildCsv, EXPORT_COLS } = require('./export-utils');

let oppRefreshBusy = false;

function createApiRoutes(context) {
  const { isScanning, setScanning, scheduleScan, getNextScanAtMs } = context;
  const api = {};

  api['/api/state'] = async () => {
    const d = store.raw();
    const settings = d.settings;
    const lastScan = d.scanLog.find((l) => l.type === 'scan');
    const wallets = Object.values(d.wallets);
    const tokens = Object.values(d.tokens);
    const since24 = Date.now() - 86400000;
    return {
      ok: true,
      chains: Object.entries(chains.CHAINS).map(([key, c]) => ({ key, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
      counts: {
        wallets: wallets.length,
        walletsA: wallets.filter((w) => w.grade === 'A').length,
        tokens: tokens.length,
        unknownTokens: tokens.filter((t) => t.unknown).length,
        transfers: d.transfers.length,
        opportunities: d.opportunities.length,
        decisions: Object.keys(d.decisions || {}).length,
        transfers24h: d.transfers.filter((t) => t.timestamp && new Date(t.timestamp).getTime() >= since24).length,
      },
      lastScan: lastScan ? lastScan.report : null,
      lastScanAt: d.stats.lastScanAt,
      scanning: isScanning(),
      registry: resolver.registryStatus(),
      settings: {
        proxyUrl: settings.proxyUrl, useProxy: settings.useProxy,
        hasKeys: Object.fromEntries(Object.entries(settings.keys || {}).map(([k, v]) => [k, !!v])),
        sources: settings.sources, scan: settings.scan,
        endpoints: settings.endpoints || {},
      },
      opportunities: [...d.opportunities].map((o) => {
        if (typeof o.qualityScore !== 'number') {
          const sc = ArbDetector.calculateOpportunityScore(o);
          o.qualityScore = sc.qualityScore;
          o.qualityGrade = sc.qualityGrade;
          o.scoreComment = sc.scoreComment;
        }
        return o;
      }).sort((a, b) => (!!a.suspicious - !!b.suspicious) || ((b.qualityScore || 0) - (a.qualityScore || 0)) || ((b.spreadPct || 0) - (a.spreadPct || 0))).slice(0, 12),
      topWallets: wallets.filter((w) => !w.ignored && !w.likelyContract).sort((a, b) => b.score - a.score).slice(0, 8),
      recentLog: d.scanLog.slice(0, 15),
    };
  };

  api['/api/transfers'] = async (ctx) => {
    const { q, source, chain, unknown, minUsd, limit = 200, offset = 0, hours } = ctx.query;
    const res = db.queryTransfers({ q, source, chain, unknown, minUsd, hours, limit: Number(limit) || 200, offset: Number(offset) || 0 });
    return { ok: true, total: res.total, items: res.items };
  };

  api['/api/wallets'] = async (ctx) => {
    const { q, grade, sort = 'score', starred, limit = 200, offset = 0, hideContracts } = ctx.query;
    const res = db.queryWallets({ q, grade, sort, starred, limit: Number(limit) || 200, offset: Number(offset) || 0, hideContracts });
    return { ok: true, total: res.total, items: res.items };
  };

  api['/api/wallet/update'] = async (ctx) => {
    const { address, patch } = ctx.body;
    if (!address) return { ok: false, error: '缺少地址' };
    const w = store.upsertWallet(address, patch || {});
    return { ok: true, wallet: w };
  };

  api['/api/wallet/delete'] = async (ctx) => {
    const { address } = ctx.body;
    store.removeWallet(address);
    return { ok: true };
  };

  api['/api/wallet/track'] = async (ctx) => {
    const { addresses = [], tags = [], notes = '' } = ctx.body;
    const added = [];
    for (const a of addresses) {
      const list = String(a).split(/[\s,;\n]+/).map((x) => x.trim()).filter(Boolean);
      for (const addr of list) {
        const w = store.upsertWallet(addr, { notes: notes || undefined, tags: tags.length ? tags : undefined, manual: true });
        if (w) added.push(w.address);
      }
    }
    engine.scoreWallets();
    return { ok: true, added };
  };

  api['/api/wallet/activity'] = async (ctx) => {
    const { address, chains: chainList, source = 'all' } = ctx.query;
    if (!address) return { ok: false, error: '缺少地址' };
    const settings = store.settings();
    const chainKeys = (chainList || '').split(',').filter(Boolean);
    const picked = source === 'blockscan' ? [sources.blockscan]
      : source === 'layerzero' ? [sources.layerzero]
        : [sources.blockscan, sources.layerzero];

    const activity = [];
    const errors = [];
    let anyOk = false;
    for (const s of picked) {
      if (typeof s.fetchWalletActivity !== 'function') continue;
      try {
        const r = await s.fetchWalletActivity({ settings }, address, chainKeys);
        if (r.ok && r.activity) {
          anyOk = true;
          for (const a of r.activity) activity.push(Object.assign({ source: s.id }, a));
        }
        if (r.errors?.length) errors.push(...r.errors);
        if (!r.ok && r.error) errors.push(s.id + ': ' + r.error);
      } catch (e) {
        errors.push(s.id + ': ' + e.message);
      }
    }
    if (!anyOk) return { ok: false, error: errors[0] || '未取到流水', errors };
    const seen = new Map();
    for (const a of activity) {
      if (!a.tokenAddress) continue;
      const k = a.chain + ':' + String(a.tokenAddress).toLowerCase();
      seen.set(k, a);
    }
    for (const [k, a] of seen) {
      store.upsertToken(a.chain, a.tokenAddress, { symbol: a.tokenSymbol, discoveredFrom: address, unknown: !engine.COMMON.has(String(a.tokenSymbol || '').toUpperCase()) });
    }
    engine.scoreWallets();
    return { ok: true, address, activity: activity.slice(0, 200), tokensFound: [...seen.values()], errors };
  };

  api['/api/tokens'] = async (ctx) => {
    const { q, unknown, starred, sort = 'score', limit = 200 } = ctx.query;
    const d = store.raw();
    let list = Object.values(d.tokens).filter((t) => !t.ignored || starred === '1');
    if (unknown === '1') list = list.filter((t) => t.unknown);
    if (starred === '1') list = list.filter((t) => t.starred);
    if (q) {
      const s = String(q).toLowerCase();
      list = list.filter((t) => (t.symbol || '').toLowerCase().includes(s) || String(t.address || '').toLowerCase().includes(s));
    }
    const score = (t) => (t.starred ? 1000 : 0) + (t.unknown ? 30 : 0) + Math.min(40, (t.bridges || 0) * 2) + Math.min(30, Object.keys(t.wallets || {}).length * 4) + (t.bestSpread || 0);
    list.sort(sort === 'spread' ? (a, b) => (b.bestSpread || 0) - (a.bestSpread || 0)
      : sort === 'recent' ? (a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || ''))
        : (a, b) => score(b) - score(a));
    return { ok: true, total: list.length, items: list.slice(0, Number(limit)) };
  };

  api['/api/token/update'] = async (ctx) => {
    const { chain, address, patch } = ctx.body;
    const t = store.upsertToken(chain, address, patch || {});
    return { ok: true, token: t };
  };

  api['/api/token/check'] = async (ctx) => {
    const { chain, address } = ctx.body;
    const d = store.raw();
    const tok = d.tokens[store.tokenKey(chain, address)];
    if (!tok) return { ok: false, error: '代币不在库中' };
    // 只有真实跨链套利机会（排除假币、同名不同币碰撞及假套利）才沉淀至机会矩阵
    if (r.best && r.best.spreadPct >= 0.5 && r.best.verdict !== 'fake' && !r.best.isSymbolCollision && !r.best.collisionRisk) {
      store.addOpportunities([r.best]);
    }

    let tokenSecurity = r.best?.security || null;
    if (!tokenSecurity && chain && address) {
      const sec = await securityChecker.checkTokenSecurity(chain, address, store.settings()).catch(() => null);
      if (sec) {
        tokenSecurity = {
          safe: sec.safe,
          hasRisk: sec.isHoneypot || sec.riskLevel === 'warning',
          isHoneypot: sec.isHoneypot,
          riskLevel: sec.riskLevel,
          riskReason: sec.riskReason,
          buySecurity: sec,
          sellSecurity: null,
          checkedAt: sec.checkedAt,
        };
      }
    }
    return { ok: true, result: r, security: tokenSecurity };
  };

  api['/api/spread/check'] = async (ctx) => {
    const { items = [], symbol = '' } = ctx.body;
    const settings = store.settings();
    let result;
    if (items.length >= 2) {
      result = await prices.spreadMatrix(items, settings);
    } else if (symbol) {
      result = await engine.checkToken({ symbol, chain: null, address: null }, settings, false);
    } else {
      return { ok: false, error: '请提供至少两个 {chain,address} 或一个 symbol' };
    }
    return { ok: true, ...result };
  };

  api['/api/registry/status'] = async () => ({ ok: true, ...resolver.registryStatus() });

  api['/api/registry/build'] = async () => {
    const settings = store.settings();
    const r = await resolver.buildRegistry(settings);
    return { ok: true, ...r };
  };

  api['/api/registry/export'] = async (ctx) => {
    const { format = 'csv' } = ctx.query;
    const rows = resolver.flattenRegistry();
    const base = 'token-registry-' + stamp();
    if (format === 'json') {
      return { __download: { filename: base + '.json', contentType: 'application/json; charset=utf-8', data: JSON.stringify(rows, null, 2) } };
    }
    const cols = [
      { label: 'Symbol', get: (r) => r.symbol },
      { label: '链', get: (r) => r.chain },
      { label: '官方合约地址', get: (r) => r.address },
      { label: '代币名', get: (r) => r.name },
      { label: '精度', get: (r) => r.decimals },
      { label: '来源', get: (r) => r.source },
    ];
    return { __download: { filename: base + '.csv', contentType: 'text/csv; charset=utf-8', data: buildCsv(rows, cols) } };
  };

  api['/api/resolve'] = async (ctx) => {
    const { symbol, originChain, originAddress } = ctx.query;
    if (!symbol) return { ok: false, error: '缺少 symbol' };
    const r = resolver.resolveSymbol(symbol, { originChain, originAddress });
    return { ok: true, ...r };
  };

  api['/api/storage'] = async () => ({ ok: true, ...store.storageStatus() });

  api['/api/storage/compact'] = async () => {
    try {
      const r = store.compact();
      return { ok: true, ...r };
    } catch (e) { return { ok: false, error: e.message }; }
  };

  api['/api/backup'] = async () => {
    try {
      const dest = store.backupNow();
      return { ok: true, file: dest };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  api['/api/opportunities'] = async (ctx) => {
    const d = store.raw();
    const list = [...d.opportunities].map((o) => {
      if (typeof o.qualityScore !== 'number') {
        const sc = ArbDetector.calculateOpportunityScore(o);
        o.qualityScore = sc.qualityScore;
        o.qualityGrade = sc.qualityGrade;
        o.scoreComment = sc.scoreComment;
      }
      return o;
    }).sort((a, b) => (!!a.suspicious - !!b.suspicious) || ((b.qualityScore || 0) - (a.qualityScore || 0)) || ((b.spreadPct || 0) - (a.spreadPct || 0)));
    const dec = d.decisions || {};
    const joined = list.slice(0, Number(ctx.query.limit || 200)).map((o) => {
      const k = store.decisionKey(o.symbol, o.buyChain, o.sellChain);
      const d2 = dec[k];
      return d2 ? Object.assign({}, o, { decision: d2 }) : o;
    });
    return { ok: true, items: joined };
  };

  api['/api/quote/live'] = async (ctx) => {
    const { buyChain, sellChain, buyAddress, sellAddress, amountUsd, force, fresh } = ctx.query || {};
    if (!buyChain || !sellChain) {
      return { ok: false, error: 'Missing buyChain or sellChain' };
    }
    try {
      const res = await quoter.getLiveQuote({
        buyChain,
        sellChain,
        buyAddress,
        sellAddress,
        amountUsd: Number(amountUsd) || 1000,
        force: force === 'true' || force === '1' || fresh === '1',
      });
      return res;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  api['/api/security/check'] = async (ctx) => {
    const { chain, address } = ctx.query || {};
    if (!chain || !address) {
      return { ok: false, error: 'Missing chain or address' };
    }
    try {
      const res = await securityChecker.checkTokenSecurity(chain, address, store.settings());
      return { ok: true, result: res };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  api['/api/decisions'] = async (ctx) => {
    const d = store.raw();
    const dec = d.decisions || {};
    const byStatus = { todo: 0, watching: 0, executed: 0, closed: 0, dropped: 0, unmarked: 0 };
    const seenKeys = new Set();
    const rows = [];

    // 1. 活跃机会列表
    for (const o of [...d.opportunities].sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))) {
      const k = store.decisionKey(o.symbol, o.buyChain, o.sellChain);
      seenKeys.add(k);
      const rec = dec[k];
      const status = rec ? rec.status : 'todo';
      if (!rec) byStatus.unmarked++;
      else if (byStatus[status] != null) byStatus[status]++;
      rows.push({
        key: k,
        symbol: o.symbol, buyChain: o.buyChain, buyChainName: o.buyChainName, sellChain: o.sellChain, sellChainName: o.sellChainName,
        spreadPct: o.spreadPct, verified: o.verified, suspicious: o.suspicious, verdict: o.verdict,
        minLiquidityUsd: o.minLiquidityUsd, hits: o.hits, ts: o.ts,
        buyPrice: o.buyPrice, sellPrice: o.sellPrice,
        buyDex: o.buyDex, sellDex: o.sellDex,
        buyVerdict: o.buyVerdict, sellVerdict: o.sellVerdict,
        buyAddress: o.buyAddress, sellAddress: o.sellAddress,
        buyExplorer: o.buyExplorer, sellExplorer: o.sellExplorer,
        buyUrl: o.buyUrl, sellUrl: o.sellUrl,
        status,
        decision: rec || null,
      });
    }

    // 2. 补全已不在当前 opportunities 中的历史决策（防止已执行/已结算工单被扫描冲刷丢弃）
    for (const [k, rec] of Object.entries(dec)) {
      if (seenKeys.has(k)) continue;
      const status = rec.status || 'todo';
      if (byStatus[status] != null) byStatus[status]++;
      rows.push({
        key: k,
        symbol: rec.symbol,
        buyChain: rec.buyChain, buyChainName: chains.label(rec.buyChain),
        sellChain: rec.sellChain, sellChainName: chains.label(rec.sellChain),
        spreadPct: rec.spreadPct ?? null,
        verified: rec.verified ?? true,
        suspicious: rec.suspicious ?? false,
        verdict: rec.verdict || 'confirmed',
        minLiquidityUsd: rec.minLiquidityUsd ?? null,
        hits: rec.hits ?? 1,
        ts: rec.updatedAt || rec.createdAt || new Date().toISOString(),
        buyPrice: rec.buyPrice ?? null,
        sellPrice: rec.sellPrice ?? null,
        buyDex: rec.buyDex ?? null,
        sellDex: rec.sellDex ?? null,
        buyVerdict: rec.buyVerdict ?? 'confirmed',
        sellVerdict: rec.sellVerdict ?? 'confirmed',
        buyAddress: rec.buyAddress ?? null,
        sellAddress: rec.sellAddress ?? null,
        buyExplorer: chains.tokenUrl(rec.buyChain, rec.buyAddress),
        sellExplorer: chains.tokenUrl(rec.sellChain, rec.sellAddress),
        buyUrl: rec.buyUrl ?? null,
        sellUrl: rec.sellUrl ?? null,
        status,
        decision: rec,
      });
    }

    const byMarked = (r) => (r.decision && (r.status !== 'todo' || r.decision.note || r.decision.journal?.length) ? 0 : 1);
    rows.sort((a, b) => byMarked(a) - byMarked(b) || String(b.ts || '').localeCompare(String(a.ts || '')));
    const filter = ctx.query.status;
    let out = rows;
    if (filter && filter !== 'all') out = filter === 'unmarked' ? rows.filter((r) => byMarked(r) === 1) : rows.filter((r) => r.status === filter);
    // 全局已实现盈亏：统计全量决策账本，不因机会退市而丢失
    const pnl = Object.values(dec).reduce((s, r) => s + (r.realizedPnlUsd || 0), 0);
    return { ok: true, total: rows.length, items: out.slice(0, Number(ctx.query.limit || 500)), byStatus, realizedPnlUsd: pnl };
  };

  api['/api/decisions/status'] = async (ctx) => {
    const b = ctx.body || {};
    if (!b.symbol || !b.buyChain || !b.sellChain) return { ok: false, error: '缺 symbol/buyChain/sellChain' };
    if (!store.DECISION_STATUS.includes(b.status)) return { ok: false, error: '非法状态：' + b.status };
    const rec = store.upsertDecision(Object.assign({ symbol: b.symbol, buyChain: b.buyChain, sellChain: b.sellChain, status: b.status, note: b.note }, b));
    return { ok: true, decision: rec };
  };

  api['/api/decisions/log'] = async (ctx) => {
    const b = ctx.body || {};
    if (!b.symbol || !b.buyChain || !b.sellChain || !b.text) return { ok: false, error: '缺 symbol/buyChain/sellChain/text' };
    const rec = store.appendDecisionLog({
      symbol: b.symbol, buyChain: b.buyChain, sellChain: b.sellChain,
      text: b.text, status: b.status, pnlDeltaUsd: b.pnlDeltaUsd,
    });
    return { ok: true, decision: rec };
  };

  api['/api/decisions/remove'] = async (ctx) => {
    const b = ctx.body || {};
    const k = store.decisionKey(b.symbol, b.buyChain, b.sellChain);
    return { ok: store.removeDecision(k), removed: k };
  };

  api['/api/opportunities/refresh'] = async () => {
    if (oppRefreshBusy) return { ok: false, error: '机会刷新进行中' };
    oppRefreshBusy = true;
    try {
      const d = store.raw();
      const settings = store.settings();
      const opps = d.opportunities;
      const todo = opps.filter((o) => !o.verdict || !o.buyVerdict || !o.buyAddress);
      const byKey = new Map();
      for (const o of todo) {
        if (!o.tokenKey) continue;
        if (!byKey.has(o.tokenKey)) byKey.set(o.tokenKey, []);
        byKey.get(o.tokenKey).push(o);
      }
      let updated = 0, noBest = 0, skipped = 0, failed = 0;
      for (const [tk, group] of byKey) {
        const [chain, address] = String(tk).split(':');
        const tok = d.tokens[store.tokenKey(chain, address)];
        if (!tok || !tok.symbol) { skipped++; continue; }
        try {
          const r = await engine.checkToken(tok, settings, false);
          if (!r.best) { noBest++; continue; }
          const b = r.best;
          for (const o of group) {
            if (o.symbol !== b.symbol || o.buyChain !== b.buyChain || o.sellChain !== b.sellChain) continue;
            Object.assign(o, {
              verdict: b.verdict, suspicious: b.suspicious, heuristic: b.heuristic, verified: b.verified,
              spreadPct: b.spreadPct, minLiquidityUsd: b.minLiquidityUsd,
              buyDex: b.buyDex, buyUrl: b.buyUrl, buyPrice: b.buyPrice,
              sellDex: b.sellDex, sellUrl: b.sellUrl, sellPrice: b.sellPrice,
              buyAddress: b.buyAddress, buyExplorer: b.buyExplorer, buyVerdict: b.buyVerdict,
              sellAddress: b.sellAddress, sellExplorer: b.sellExplorer, sellVerdict: b.sellVerdict,
            });
            updated++;
          }
        } catch (e) { failed++; }
      }
      store.save();
      store.flush();
      const dist = {};
      for (const o of d.opportunities) dist[o.verdict || 'unknown'] = (dist[o.verdict || 'unknown'] || 0) + 1;
      return { ok: true, updated, skipped, noBest, failed, distribution: dist };
    } finally {
      oppRefreshBusy = false;
    }
  };

  api['/api/scan'] = async (ctx) => {
    if (isScanning()) return { ok: false, error: '扫描进行中' };
    setScanning(true);
    try {
      const { sourceIds, limit, priceCheck, priceLimit } = ctx.body || {};
      const report = await engine.runScan({ sourceIds, limit, priceCheck, priceLimit });
      return { ok: true, report };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      setScanning(false);
    }
  };

  api['/api/sources/health'] = async () => {
    const settings = store.settings();
    const out = [];
    for (const s of sources.ALL) {
      try {
        const t0 = Date.now();
        const r = await s.fetchTransfers({ settings, since: 0, limit: 5 });
        out.push({ id: s.id, name: s.name, siteUrl: s.siteUrl, needsKey: s.needsKey, note: s.note, ok: r.ok, error: r.error || null, count: r.transfers?.length || 0, ms: Date.now() - t0 });
      } catch (err) {
        out.push({ id: s.id, name: s.name, siteUrl: s.siteUrl, needsKey: s.needsKey, note: s.note, ok: false, error: err.message, count: 0 });
      }
    }
    return { ok: true, sources: out };
  };

  api['/api/settings'] = async (ctx) => {
    const req = ctx.req;
    if (req.method === 'POST') {
      const d = store.raw();
      const patch = ctx.body || {};
      d.settings = Object.assign(d.settings, patch);
      if (patch.keys) d.settings.keys = Object.assign(d.settings.keys || {}, patch.keys);
      if (patch.sources) d.settings.sources = Object.assign(d.settings.sources || {}, patch.sources);
      if (patch.scan) d.settings.scan = Object.assign(d.settings.scan || {}, patch.scan);
      if (patch.endpoints) d.settings.endpoints = Object.assign(d.settings.endpoints || {}, patch.endpoints);
      store.touchMeta();
      store.save();
      scheduleScan();
      return { ok: true, settings: d.settings };
    }
    return { ok: true, settings: store.settings() };
  };

  api['/api/import'] = async (ctx) => {
    const { source = 'manual', records, text } = ctx.body || {};
    let recs = records;
    if (!recs && text) {
      const t = String(text).trim();
      try {
        recs = JSON.parse(t);
      } catch {
        const lines = t.split(/\r?\n/).filter(Boolean);
        const head = lines[0].toLowerCase();
        const hasHeader = /txhash|hash|symbol/.test(head);
        const rows = hasHeader ? lines.slice(1) : lines;
        recs = rows.map((line) => {
          const c = line.split(/[,\t;]/).map((x) => x.trim());
          return { txHash: c[0], fromChain: c[1] || null, toChain: c[2] || null, tokenSymbol: c[3] || null, tokenAddress: c[4] || null, sender: c[5] || null, receiver: c[6] || null, amount: Number(c[7]) || null, timestamp: c[8] || null };
        });
        if (hasHeader) {
          const cols = head.split(/[,\t;]/).map((x) => x.trim());
          recs = rows.map((line) => {
            const c = line.split(/[,\t;]/).map((x) => x.trim());
            const o = {};
            cols.forEach((col, i) => { o[col] = c[i]; });
            return {
              txHash: o.txhash || o.hash || o.tx, fromChain: o.fromchain || o.from, toChain: o.tochain || o.to,
              tokenSymbol: o.tokensymbol || o.symbol, tokenAddress: o.tokenaddress || o.token || o.contract,
              sender: o.sender || o.from_address, receiver: o.receiver || o.to_address,
              amount: Number(o.amount) || null, amountUsd: Number(o.amountusd || o.usdamount) || null, timestamp: o.timestamp || o.time || null,
            };
          });
        }
      }
    }
    if (!Array.isArray(recs)) recs = [recs];
    const res = engine.importRecords(recs, source);
    return { ok: true, ...res };
  };

  api['/api/export'] = async (ctx) => {
    const { type = 'wallets', format = 'json' } = ctx.query;
    const d = store.raw();
    let items;
    if (type === 'wallets') items = Object.values(d.wallets);
    else if (type === 'tokens') items = Object.values(d.tokens);
    else if (type === 'transfers') items = d.transfers;
    else if (type === 'opportunities') items = d.opportunities;
    else return { ok: false, error: '未知导出类型 ' + type };

    const base = 'arb-' + type + '-' + stamp();
    if (format === 'csv') {
      return { __download: { filename: base + '.csv', contentType: 'text/csv; charset=utf-8', data: buildCsv(items, EXPORT_COLS[type]) } };
    }
    return { __download: { filename: base + '.json', contentType: 'application/json; charset=utf-8', data: JSON.stringify(items, null, 2) } };
  };

  api['/api/rebuild'] = async () => {
    const r = engine.rebuildFromTransfers();
    return { ok: true, ...r };
  };

  api['/api/log'] = async () => ({ ok: true, items: store.raw().scanLog.slice(0, 60) });

  api['/api/pipeline'] = async () => {
    const d = store.raw();
    const last = d.scanLog.find((l) => l.type === 'scan');
    const s = store.settings();
    const report = last?.report || null;
    return {
      ok: true,
      scanning: isScanning(),
      autoEnabled: !!s.scan?.autoEnabled,
      intervalMin: Number(s.scan?.intervalMin) || 5,
      nextScanAt: getNextScanAtMs() ? new Date(getNextScanAtMs()).toISOString() : null,
      lastScanAt: d.stats.lastScanAt || null,
      lastScan: report,
      funnel: report?.funnel || [],
      gates: report?.gates || null,
      counts: {
        transfers: d.transfers.length,
        wallets: Object.keys(d.wallets).length,
        tokens: Object.keys(d.tokens).length,
        opportunities: d.opportunities.length,
      },
    };
  };

  return api;
}

module.exports = { createApiRoutes };
