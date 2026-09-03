'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const store = require('./lib/store');
const sources = require('./lib/sources');
const engine = require('./lib/engine');
const prices = require('./lib/prices');
const chains = require('./lib/chains');
const resolver = require('./lib/resolver');

const PORT = Number(process.env.PORT || 8848);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

let scanTimer = null;
let scanning = false;
// 下一次自动扫描的时间戳（ms）。前端轮询拿它做倒计时。
let nextScanAtMs = 0;

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ---------------- API ----------------
const api = {};

api['/api/state'] = async (ctx) => {
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
    scanning,
    registry: resolver.registryStatus(),
    settings: {
      proxyUrl: settings.proxyUrl, useProxy: settings.useProxy,
      hasKeys: Object.fromEntries(Object.entries(settings.keys || {}).map(([k, v]) => [k, !!v])),
      sources: settings.sources, scan: settings.scan,
      endpoints: settings.endpoints || {},
    },
    opportunities: [...d.opportunities].sort((a, b) => (!!a.suspicious - !!b.suspicious) || ((b.spreadPct || 0) - (a.spreadPct || 0))).slice(0, 12),
    topWallets: wallets.filter((w) => !w.ignored && !w.likelyContract).sort((a, b) => b.score - a.score).slice(0, 8),
    recentLog: d.scanLog.slice(0, 15),
  };
};

api['/api/transfers'] = async (ctx) => {
  const { q, source, chain, unknown, minUsd, limit = 200, offset = 0, hours } = ctx.query;
  const d = store.raw();
  const now = Date.now();
  let list = d.transfers;
  if (hours) list = list.filter((t) => t.timestamp && now - new Date(t.timestamp).getTime() <= Number(hours) * 3600000);
  if (source) list = list.filter((t) => t.source === source);
  if (chain) list = list.filter((t) => t.fromChain === chain || t.toChain === chain);
  if (unknown === '1') list = list.filter((t) => t.tokenSymbol && !engine.COMMON.has(String(t.tokenSymbol).toUpperCase()));
  if (minUsd) list = list.filter((t) => (t.amountUsd || 0) >= Number(minUsd));
  if (q) {
    const s = String(q).toLowerCase();
    list = list.filter((t) => [t.txHash, t.tokenSymbol, t.sender, t.receiver, t.tokenAddress].some((v) => v && String(v).toLowerCase().includes(s)));
  }
  return { ok: true, total: list.length, items: list.slice(Number(offset), Number(offset) + Number(limit)) };
};

api['/api/wallets'] = async (ctx) => {
  const { q, grade, sort = 'score', starred, limit = 200, hideContracts } = ctx.query;
  const d = store.raw();
  let list = Object.values(d.wallets).filter((w) => !w.ignored || starred === '1');
  if (hideContracts === '1') list = list.filter((w) => !w.likelyContract);
  if (q) {
    const s = String(q).toLowerCase();
    list = list.filter((w) => w.address.toLowerCase().includes(s) || (w.notes || '').toLowerCase().includes(s) || (w.tags || []).join(',').toLowerCase().includes(s) || (w.name || '').toLowerCase().includes(s));
  }
  if (grade) list = list.filter((w) => w.grade === grade);
  const dir = sort === 'recent' ? (a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || ''))
    : sort === 'bridges' ? (a, b) => (b.bridgeCount || 0) - (a.bridgeCount || 0)
      : sort === 'cycles' ? (a, b) => (b.capitalCycles || 0) - (a.capitalCycles || 0)
        : sort === 'roundtrips' ? (a, b) => (b.roundtrips || 0) - (a.roundtrips || 0)
          : (a, b) => (b.score || 0) - (a.score || 0);
  list.sort(dir);
  return { ok: true, total: list.length, items: list.slice(0, Number(limit)) };
};

api['/api/wallet/update'] = async (ctx) => {
  const { address, patch } = ctx.body;
  if (!address) return { ok: false, error: '缺少地址' };
  const w = store.upsertWallet(address, patch || {});
  return { ok: true, wallet: w };
};

api['/api/wallet/delete'] = async (ctx) => {
  const { address } = ctx.body;
  // 走 store.removeWallet 而不是直接 delete：直接删内存对象不会同步到磁盘
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
  // 数据源选择：blockscan = 多链 ERC20 代币流水（需 Key）；layerzero = 钱包发起的跨链消息（免 Key）；all = 两者合并。
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
      if (!r.ok && r.error) errors.push(`${s.id}: ${r.error}`);
    } catch (e) {
      errors.push(`${s.id}: ${e.message}`);
    }
  }
  if (!anyOk) return { ok: false, error: errors[0] || '未取到流水', errors };
  // 把发现的代币顺手塞进代币库
  const seen = new Map();
  for (const a of activity) {
    if (!a.tokenAddress) continue;
    const k = `${a.chain}:${String(a.tokenAddress).toLowerCase()}`;
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
  const r = await engine.checkToken(tok, store.settings());
  if (r.best && r.best.spreadPct >= 0.5) store.addOpportunities([r.best]);
  return { ok: true, result: r };
};

api['/api/spread/check'] = async (ctx) => {
  const { items = [], symbol = '' } = ctx.body;
  const settings = store.settings();
  let result;
  if (items.length >= 2) {
    result = await prices.spreadMatrix(items, settings);
  } else if (symbol) {
    // 防假币：symbol 查询也走 resolver，先解析官方多链地址精确报价，symbol 搜索仅兜底
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

// 导出官方合约映射对照表（symbol → 各链官方合约），CSV/JSON 文件下载，供线下核对
api['/api/registry/export'] = async (ctx) => {
  const { format = 'csv' } = ctx.query;
  const rows = resolver.flattenRegistry();
  const base = `token-registry-${stamp()}`;
  if (format === 'json') {
    return { __download: { filename: `${base}.json`, contentType: 'application/json; charset=utf-8', data: JSON.stringify(rows, null, 2) } };
  }
  const cols = [
    { label: 'Symbol', get: (r) => r.symbol },
    { label: '链', get: (r) => r.chain },
    { label: '官方合约地址', get: (r) => r.address },
    { label: '代币名', get: (r) => r.name },
    { label: '精度', get: (r) => r.decimals },
    { label: '来源', get: (r) => r.source },
  ];
  return { __download: { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', data: buildCsv(rows, cols) } };
};

// 查询某个 symbol 在各链的官方合约地址（代币身份解析）
api['/api/resolve'] = async (ctx) => {
  const { symbol, originChain, originAddress } = ctx.query;
  if (!symbol) return { ok: false, error: '缺少 symbol' };
  const r = resolver.resolveSymbol(symbol, { originChain, originAddress });
  return { ok: true, ...r };
};

// 数据存储状态（SQLite 主库 + 备份列表 + 完整性校验结果）
api['/api/storage'] = async () => ({ ok: true, ...store.storageStatus() });

// 手动压缩：全量重写主库 + 合并 WAL，用于收缩文件体积、重建索引
api['/api/storage/compact'] = async () => {
  try {
    const r = store.compact();
    return { ok: true, ...r };
  } catch (e) { return { ok: false, error: e.message }; }
};

// 手动触发一次一致性备份
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
  // 可疑项（同名不同资产）沉到列表末尾，避免误导
  const list = [...d.opportunities].sort((a, b) => (!!a.suspicious - !!b.suspicious) || ((b.spreadPct || 0) - (a.spreadPct || 0)));
  // 关联每条机会的人工决策记录（若有），前端决策页/机会列表直接读
  const dec = d.decisions || {};
  const joined = list.slice(0, Number(ctx.query.limit || 200)).map((o) => {
    const k = store.decisionKey(o.symbol, o.buyChain, o.sellChain);
    const d2 = dec[k];
    return d2 ? Object.assign({}, o, { decision: d2 }) : o;
  });
  return { ok: true, items: joined };
};

// 汇总：全部机会 + 其决策 + 按状态分组统计，供「决策/素材」页使用
api['/api/decisions'] = async (ctx) => {
  const d = store.raw();
  const dec = d.decisions || {};
  const byStatus = { todo: 0, watching: 0, executed: 0, closed: 0, dropped: 0, unmarked: 0 };
  const rows = [...d.opportunities]
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
    .map((o) => {
      const k = store.decisionKey(o.symbol, o.buyChain, o.sellChain);
      const rec = dec[k];
      const status = rec ? rec.status : 'todo';
      if (!rec) byStatus.unmarked++;
      else if (byStatus[status] != null) byStatus[status]++;
      return {
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
        status: rec ? rec.status : 'todo',
        decision: rec || null, // 含 note/journal/realizedPnlUsd/createdAt/updatedAt
      };
    });
  // 只留已人工标记过的（status != todo 或带备注/日志）在前，方便追踪；未标记仍列出但靠后
  const byMarked = (r) => (r.decision && (r.status !== 'todo' || r.decision.note || r.decision.journal?.length) ? 0 : 1);
  rows.sort((a, b) => byMarked(a) - byMarked(b) || String(b.ts || '').localeCompare(String(a.ts || '')));
  const filter = ctx.query.status;
  let out = rows;
  if (filter && filter !== 'all') out = filter === 'unmarked' ? rows.filter((r) => byMarked(r) === 1) : rows.filter((r) => r.status === filter);
  const pnl = rows.reduce((s, r) => s + (r.decision?.realizedPnlUsd || 0), 0);
  return { ok: true, total: rows.length, items: out.slice(0, Number(ctx.query.limit || 500)), byStatus, realizedPnlUsd: pnl };
};

// 创建/更新某机会的决策状态
api['/api/decisions/status'] = async (ctx) => {
  const b = ctx.body || {};
  if (!b.symbol || !b.buyChain || !b.sellChain) return { ok: false, error: '缺 symbol/buyChain/sellChain' };
  if (!store.DECISION_STATUS.includes(b.status)) return { ok: false, error: '非法状态：' + b.status };
  const rec = store.upsertDecision({ symbol: b.symbol, buyChain: b.buyChain, sellChain: b.sellChain, status: b.status, note: b.note });
  return { ok: true, decision: rec };
};

// 追加一条行动/盈亏日志（可同时推进状态，可选 pnlDeltaUsd 计入 realizedPnl）
api['/api/decisions/log'] = async (ctx) => {
  const b = ctx.body || {};
  if (!b.symbol || !b.buyChain || !b.sellChain || !b.text) return { ok: false, error: '缺 symbol/buyChain/sellChain/text' };
  const rec = store.appendDecisionLog({
    symbol: b.symbol, buyChain: b.buyChain, sellChain: b.sellChain,
    text: b.text, status: b.status, pnlDeltaUsd: b.pnlDeltaUsd,
  });
  return { ok: true, decision: rec };
};

// 删除一条决策记录（重置为未标记）
api['/api/decisions/remove'] = async (ctx) => {
  const b = ctx.body || {};
  const k = store.decisionKey(b.symbol, b.buyChain, b.sellChain);
  return { ok: store.removeDecision(k), removed: k };
};


// 为存量机会补全裁决证据（合约地址 / explorer / verdict）。老版本入库的机会只存了
// DexScreener 交易对 URL，没有 token 合约地址与裁决标签。这里在服务进程内（同一内存库，
// 避免跨进程并发写）对每条机会引用的代币做一次 checkToken（persist=false），用返回的 best
// 回填匹配记录。路由已反转或代币无报价的记录保持不变，等下次扫描自然刷新。
let oppRefreshBusy = false;
api['/api/opportunities/refresh'] = async (ctx) => {
  if (oppRefreshBusy) return { ok: false, error: '机会刷新进行中' };
  oppRefreshBusy = true;
  try {
    const d = store.raw();
    const settings = store.settings();
    const opps = d.opportunities;
    // 只处理仍缺裁决证据的记录
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
        const r = await engine.checkToken(tok, settings, false); // 不回写代币库
        if (!r.best) { noBest++; continue; }
        const b = r.best;
        for (const o of group) {
          // 只有 symbol + 买卖链都与本次 best 吻合才更新，避免用错腿的地址覆盖
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
  if (scanning) return { ok: false, error: '扫描进行中' };
  scanning = true;
  try {
    const { sourceIds, limit, priceCheck, priceLimit } = ctx.body || {};
    const report = await engine.runScan({ sourceIds, limit, priceCheck, priceLimit });
    return { ok: true, report };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    scanning = false;
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
  // 注意：路由器只传一个 ctx 对象，原生 req 在 ctx.req 上（不能写成 (ctx, req)）
  const req = ctx.req;
  if (req.method === 'POST') {
    const d = store.raw();
    const patch = ctx.body || {};
    d.settings = Object.assign(d.settings, patch);
    if (patch.keys) d.settings.keys = Object.assign(d.settings.keys || {}, patch.keys);
    if (patch.sources) d.settings.sources = Object.assign(d.settings.sources || {}, patch.sources);
    if (patch.scan) d.settings.scan = Object.assign(d.settings.scan || {}, patch.scan);
    if (patch.endpoints) d.settings.endpoints = Object.assign(d.settings.endpoints || {}, patch.endpoints);
    store.touchMeta(); // settings 存在 meta 表，不标记就不会落盘
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
      // CSV/TSV 形式：txHash,fromChain,toChain,tokenSymbol,tokenAddress,sender,receiver,amount,timestamp
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

// ---------- 一键导出（CSV / JSON 文件下载，离线归档） ----------
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s;
  if (typeof v === 'object') s = JSON.stringify(v);
  else if (typeof v === 'boolean') s = v ? '1' : '0';
  else s = String(v);
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function buildCsv(rows, cols) {
  const header = cols.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => cols.map((c) => csvCell(c.get(r))).join(','));
  // 前缀 UTF-8 BOM，让 Excel 直接正确识别中文
  return '\uFEFF' + [header].concat(body).join('\r\n');
}
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const EXPORT_COLS = {
  wallets: [
    { label: '地址', get: (w) => w.address },
    { label: '等级', get: (w) => w.grade },
    { label: '分数', get: (w) => w.score },
    { label: '桥次数', get: (w) => w.bridgeCount },
    { label: '资金闭环', get: (w) => w.capitalCycles },
    { label: '往返', get: (w) => (w.roundtrips || []).length },
    { label: '链数', get: (w) => Object.keys(w.chains || {}).length },
    { label: '币种数', get: (w) => Object.keys(w.tokens || {}).length },
    { label: '标签', get: (w) => (w.tags || []).join('|') },
    { label: '备注', get: (w) => w.notes },
    { label: '疑似合约', get: (w) => w.likelyContract },
    { label: '收藏', get: (w) => w.starred },
    { label: '首次发现', get: (w) => w.firstSeen },
    { label: '最近活跃', get: (w) => w.lastSeen },
  ],
  tokens: [
    { label: '链', get: (t) => t.chain },
    { label: '合约地址', get: (t) => t.address },
    { label: 'Symbol', get: (t) => t.symbol },
    { label: '桥次数', get: (t) => t.bridges },
    { label: '关联钱包', get: (t) => Object.keys(t.wallets || {}).length },
    { label: '最佳价差%', get: (t) => t.bestSpread },
    { label: '冷门', get: (t) => t.unknown },
    { label: '收藏', get: (t) => t.starred },
    { label: '首次发现', get: (t) => t.firstSeen },
    { label: '最近检查', get: (t) => t.checkedAt },
  ],
  transfers: [
    { label: '来源', get: (t) => t.source },
    { label: 'TxHash', get: (t) => t.txHash },
    { label: '源链', get: (t) => t.fromChain },
    { label: '目标链', get: (t) => t.toChain },
    { label: 'Symbol', get: (t) => t.tokenSymbol },
    { label: '合约地址', get: (t) => t.tokenAddress },
    { label: '发送方', get: (t) => t.sender },
    { label: '接收方', get: (t) => t.receiver },
    { label: '数量', get: (t) => t.amount },
    { label: '金额USD', get: (t) => t.amountUsd },
    { label: '时间', get: (t) => t.timestamp },
  ],
  opportunities: [
    { label: 'Symbol', get: (o) => o.symbol },
    { label: '买入链', get: (o) => o.buyChain },
    { label: '卖出链', get: (o) => o.sellChain },
    { label: '价差%', get: (o) => o.spreadPct },
    { label: '已验证', get: (o) => o.verified },
    { label: '可疑', get: (o) => o.suspicious },
    { label: '命中次数', get: (o) => o.hits },
    { label: '时间', get: (o) => o.ts },
  ],
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

  const base = `arb-${type}-${stamp()}`;
  if (format === 'csv') {
    return { __download: { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', data: buildCsv(items, EXPORT_COLS[type]) } };
  }
  return { __download: { filename: `${base}.json`, contentType: 'application/json; charset=utf-8', data: JSON.stringify(items, null, 2) } };
};

api['/api/rebuild'] = async () => {
  const r = engine.rebuildFromTransfers();
  return { ok: true, ...r };
};

api['/api/log'] = async () => ({ ok: true, items: store.raw().scanLog.slice(0, 60) });

// ---------------- 调度 ----------------
function scheduleScan() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  const s = store.settings();
  if (!s.scan?.autoEnabled) { nextScanAtMs = 0; return; }
  const mins = Math.max(1, Number(s.scan.intervalMin) || 5);
  nextScanAtMs = Date.now() + mins * 60000;
  scanTimer = setInterval(async () => {
    nextScanAtMs = Date.now() + mins * 60000; // 先排下一班，避免任务耗时把节奏拖歪
    if (scanning) return;
    scanning = true;
    try { await engine.runScan({}); } catch (e) { console.error('[scan]', e.message); } finally { scanning = false; }
  }, mins * 60000);
  scanTimer.unref?.();
}

// 轻量轮询端点：只回前端画漏斗和倒计时需要的字段，避免每次拉全量 state
api['/api/pipeline'] = async () => {
  const d = store.raw();
  const last = d.scanLog.find((l) => l.type === 'scan');
  const s = store.settings();
  const report = last?.report || null;
  return {
    ok: true,
    scanning,
    autoEnabled: !!s.scan?.autoEnabled,
    intervalMin: Number(s.scan?.intervalMin) || 5,
    nextScanAt: nextScanAtMs ? new Date(nextScanAtMs).toISOString() : null,
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

// ---------------- 定时备份 ----------------
let backupTimer = null;
function scheduleBackup() {
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
  const hours = Math.max(1, Number(process.env.BACKUP_INTERVAL_H || 6));
  backupTimer = setInterval(() => {
    try { store.backupNow(); console.log('[backup] 自动备份完成'); } catch (e) { console.error('[backup] 自动备份失败：', e.message); }
  }, hours * 3600000);
  backupTimer.unref?.();
}

// ---------------- WAL 定期合并 ----------------
// WAL 模式下所有写都先进 -wal 文件，只有 checkpoint 才合并回主库。
// 不主动合并的话它会一直涨（实测 40 分钟涨到 30MB，比主库还大），
// 既占磁盘又让读操作要同时扫主库和 WAL。这里每 10 分钟合并一次。
let walTimer = null;
function scheduleWalCheckpoint() {
  if (walTimer) { clearInterval(walTimer); walTimer = null; }
  walTimer = setInterval(() => {
    try {
      const r = store.checkpoint('TRUNCATE');
      if (r && r.ok === false) console.warn('[wal] checkpoint 跳过（有并发读）');
    } catch (e) { console.error('[wal] checkpoint 失败：', e.message); }
  }, 10 * 60000);
  walTimer.unref?.();
}

// ---------------- 服务 ----------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/')) {
      const handler = api[pathname];
      if (!handler) return json(res, 404, { ok: false, error: '未知接口 ' + pathname });
      const query = Object.fromEntries(url.searchParams.entries());
      const body = req.method === 'POST' ? await readBody(req) : {};
      // 主参数为 ctx（含 query/body/req），同时把原生 req 作为第二参数透出，兼容 (ctx, req) 写法
      const out = await handler({ query, body, req }, req);
      // 文件下载类接口：携带 __download 时直接输出文件流（带 Content-Disposition）
      if (out && out.__download) {
        const dl = out.__download;
        res.writeHead(200, {
          'Content-Type': dl.contentType,
          'Content-Disposition': `attachment; filename="${dl.filename}"`,
          'Content-Length': Buffer.byteLength(dl.data),
        });
        return res.end(dl.data);
      }
      return json(res, 200, out);
    }
    serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[server]', err);
    json(res, 500, { ok: false, error: err.message });
  }
});

// 旧版本沉淀的钱包没有 flows / capitalCycles 字段，闭环检测跑不出来，需要重建一次
function maybeMigrate() {
  const d = store.raw();
  const wallets = Object.values(d.wallets);
  if (!wallets.length) return;
  const needs = wallets.some((w) => !Array.isArray(w.flows) || w.capitalCycles === undefined);
  if (!needs) return;
  console.log('[migrate] 检测到旧格式钱包数据，正从已入库流水重建统计…');
  try {
    const r = engine.rebuildFromTransfers();
    console.log(`[migrate] 重建完成：${r.transfers} 条流水重新沉淀，钱包 ${Object.keys(store.raw().wallets).length} 个`);
  } catch (e) {
    console.error('[migrate] 重建失败：', e.message);
  }
}

server.listen(PORT, HOST, () => {
  store.load();
  maybeMigrate();
  scheduleScan();
  scheduleBackup();
  scheduleWalCheckpoint();

  // 启动时先把残留的 WAL 合并回主库（上次可能是被强杀的）
  try { store.checkpoint('TRUNCATE'); } catch { /* ignore */ }

  // 启动时做一次完整性校验 + 备份（若距上次备份较久）
  const st = store.storageStatus();
  console.log(`\n  Bridge Arb Radar 已启动:  http://${HOST}:${PORT}\n  数据目录: ${path.join(__dirname, 'data')}`);
  console.log(`  存储后端: SQLite（${st.mainSizeBytes > 0 ? (st.mainSizeBytes / 1048576).toFixed(1) + ' MB' : '空库'}，完整性 ${st.integrity}，备份 ${st.backupCount} 份）`);
  if (st.backupCount === 0) {
    try { const b = store.backupNow(); console.log(`  已生成首份备份：${path.basename(b)}`); } catch (e) { console.error('[backup] 首份备份失败：', e.message); }
  }

  if (store.settings().scan?.autoEnabled) {
    console.log(`  自动扫描：每 ${store.settings().scan.intervalMin} 分钟一次`);
  }
  // 官方合约注册表：首次启动后台构建，之后每 24h 自动刷新一次（防假币的锚点数据）
  const rs = resolver.registryStatus();
  if (!rs.builtAt || Date.now() - new Date(rs.builtAt).getTime() > 86400000) {
    console.log('  后台构建官方合约注册表（Trust Wallet 12 链）…');
    resolver.buildRegistry(store.settings())
      .then((r) => console.log(`  注册表构建完成：${r.added} 个代币，覆盖链 [${r.chains.join(', ')}]`))
      .catch((e) => console.error('[registry] 构建失败：', e.message));
  } else {
    console.log(`  官方合约注册表：${rs.symbols} 个 symbol（构建于 ${rs.builtAt}）`);
  }
});

// 优雅关闭：把内存态 flush 到 SQLite 并关闭连接，避免丢失最后一次改动
function shutdown(sig) {
  console.log(`\n[server] 收到 ${sig}，正在优雅关闭…`);
  try { store.flush(); } catch (e) { console.error('[server] flush 失败：', e.message); }
  try { require('./lib/db').close(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
