'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json'); // legacy JSON（迁移后仅作兜底，不再作为主存储）

const DEFAULT_SETTINGS = {
  proxyUrl: process.env.HTTPS_PROXY || 'http://127.0.0.1:10808',
  useProxy: true,
  keys: { layerzero: '', axelar: '', range: '', etherscan: '', debank: '', lifi: '' },
  sources: {
    wormhole: { enabled: true },
    layerzero: { enabled: true },
    axelar: { enabled: true },
    hyperlane: { enabled: true },
    range: { enabled: true },
    blockscan: { enabled: false },
  },
  scan: {
    autoEnabled: true,
    intervalMin: 5,
    lookbackHours: 24,
    maxTransfers: 8000,
    autoPriceCheck: true,
    minLiquidityUsd: 5000,
    spreadAlertPct: 1.5,
    maxHeuristicSpreadPct: 25,
  },
  filters: { unknownOnly: false, minAmountUsd: 0 },
  notifications: {
    web: {
      enabled: true,
      sound: true,
    },
    telegram: {
      enabled: false,
      botToken: '',
      chatId: '',
    },
    minSpreadPct: 1.0,
  },
};

const EMPTY = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  transfers: [],
  wallets: {},
  tokens: {},
  opportunities: [],
  decisions: {},
  scanLog: [],
  stats: { transfersSeen: 0, scans: 0, lastScanAt: null },
};

let mem = null;
let saveTimer = null;

// ---------------- 脏数据追踪（增量持久化的基础） ----------------
// 记录「哪些行变了」，让 save() 只写这些行，而不是每次 DELETE 全表 + 重插 1 万行。
// 实测：全量重写 165ms → 增量写入 6.6ms，写放大从 25x 降到 1x。
// 注意：集合里只存 key，flush 时再取当前内存对象，保证写到的是最新值。
const dirty = {
  wallets: new Set(),
  tokens: new Set(),
  transfers: new Set(),
  walletDeletes: new Set(),
  tokenDeletes: new Set(),
  transferDeletes: new Set(),
  opportunities: false,
  scanLog: false,
  meta: false,
  fullRebuild: false, // 批量重建数据后置位，强制走全量（此时增量反而不划算）
};

function touchWallet(key) { if (key) dirty.wallets.add(String(key).toLowerCase()); }
function touchToken(key) { if (key) dirty.tokens.add(key); }
function touchTransfer(id) { if (id) dirty.transfers.add(id); }
function touchMeta() { dirty.meta = true; }
/** 批量改动 / 无法逐项标记时调用：本次保存走全量重写 */
function markFull() { dirty.fullRebuild = true; }

function clearDirty() {
  dirty.wallets.clear(); dirty.tokens.clear(); dirty.transfers.clear();
  dirty.walletDeletes.clear(); dirty.tokenDeletes.clear(); dirty.transferDeletes.clear();
  dirty.opportunities = false; dirty.scanLog = false; dirty.meta = false; dirty.fullRebuild = false;
}

/** 脏数据规模：超过总量 30% 时，全量重写比逐行 upsert 更划算 */
function dirtyRatio() {
  const total = (mem?.transfers.length || 0) + Object.keys(mem?.wallets || {}).length + Object.keys(mem?.tokens || {}).length;
  if (!total) return 1;
  const n = dirty.wallets.size + dirty.tokens.size + dirty.transfers.size
    + dirty.walletDeletes.size + dirty.tokenDeletes.size + dirty.transferDeletes.size;
  return n / total;
}

function deepMergeDefaults(raw) {
  const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
  s.keys = Object.assign({}, DEFAULT_SETTINGS.keys, raw?.keys || {});
  s.sources = Object.assign({}, DEFAULT_SETTINGS.sources, raw?.sources || {});
  s.scan = Object.assign({}, DEFAULT_SETTINGS.scan, raw?.scan || {});
  s.filters = Object.assign({}, DEFAULT_SETTINGS.filters, raw?.filters || {});
  s.notifications = Object.assign({}, DEFAULT_SETTINGS.notifications, raw?.notifications || {});
  s.notifications.web = Object.assign({}, DEFAULT_SETTINGS.notifications.web, raw?.notifications?.web || {});
  s.notifications.telegram = Object.assign({}, DEFAULT_SETTINGS.notifications.telegram, raw?.notifications?.telegram || {});
  return s;
}

/** 一次性迁移：把旧 db.json 导入 SQLite，成功后把 json 归档保留兜底 */
function migrateFromJson() {
  if (!fs.existsSync(DB_FILE)) return false;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('[store] 旧 db.json 读取失败，跳过迁移：', e.message);
    return false;
  }
  const legacy = Object.assign({}, EMPTY, raw);
  legacy.settings = deepMergeDefaults(raw.settings);
  legacy.stats = Object.assign({}, EMPTY.stats, raw.stats || {});
  legacy.transfers = Array.isArray(raw.transfers) ? raw.transfers : [];
  legacy.wallets = raw.wallets || {};
  legacy.tokens = raw.tokens || {};
  legacy.opportunities = Array.isArray(raw.opportunities) ? raw.opportunities : [];
  legacy.scanLog = Array.isArray(raw.scanLog) ? raw.scanLog : [];

  db.persist(legacy);
  const archive = DB_FILE + '.legacy-' + Date.now();
  try { fs.renameSync(DB_FILE, archive); console.log(`[store] 已从 db.json 迁移到 SQLite，旧文件归档为 ${path.basename(archive)}`); }
  catch { console.log('[store] 迁移完成，旧 db.json 已保留（可手动删除）'); }
  return true;
}

/** 判断 SQLite 是否已有数据（避免把空库覆盖成空、也避免重复迁移） */
function sqliteHasData() {
  return db.loadMeta('settings') !== undefined;
}

function load() {
  if (mem) return mem;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // 1. 启动完整性校验；损坏则自动从最近备份恢复
  try {
    const ok = db.integrityCheck();
    if (ok !== 'ok') {
      console.error(`[store] SQLite 完整性校验失败（${ok}），尝试从最近备份恢复…`);
      const r = db.restoreFromLatestBackup();
      if (r) console.error(`[store] 已从备份恢复：${path.basename(r.restoredFrom)}，损坏库保留为 ${path.basename(r.brokenKeptAs)}`);
      else console.error('[store] 无可用备份，将尝试用空库启动（历史数据可能丢失）');
    }
  } catch (e) {
    console.error('[store] 完整性校验异常：', e.message);
    try { db.restoreFromLatestBackup(); } catch { /* ignore */ }
  }

  // 2. SQLite 为空但存在旧 db.json → 一次性迁移
  if (!sqliteHasData()) {
    if (fs.existsSync(DB_FILE)) {
      migrateFromJson();
    } else {
      // 全新启动：写入默认 settings
      db.persist(Object.assign({}, EMPTY, { settings: deepMergeDefaults(), stats: { transfersSeen: 0, scans: 0, lastScanAt: null } }));
    }
  }

  // 3. 从 SQLite 加载到内存
  try {
    mem = {
      version: 1,
      settings: deepMergeDefaults(db.loadMeta('settings')),
      transfers: db.loadTransfers(),
      wallets: db.loadWallets(),
      tokens: db.loadTokens(),
      opportunities: db.loadOpportunities(),
      decisions: db.loadMeta('decisions') || {},
      scanLog: db.loadScanLog(),
      stats: Object.assign({}, EMPTY.stats, db.loadMeta('stats') || {}),
    };
  } catch (e) {
    console.error('[store] 从 SQLite 加载失败，使用空库：', e.message);
    mem = JSON.parse(JSON.stringify(EMPTY));
  }
  clearDirty(); // 刚从磁盘读出来的数据就是磁盘现状，无需回写
  return mem;
}

/**
 * 落盘：默认走增量（只写变化行）；批量重建或脏数据过多时自动降级为全量。
 * 两种路径都在单个事务内完成，崩溃都不会写坏主库。
 */
let lastFlush = null; // 供 /api/storage 展示写入效率

function flush(opts = {}) {
  if (!mem) return { mode: 'noop' };
  const t0 = Number(process.hrtime.bigint()) / 1e6;
  let res;
  try {
    const forceFull = opts.full || dirty.fullRebuild || dirtyRatio() > 0.3;
    if (forceFull) {
      db.persistFull(mem);
      clearDirty();
      res = { mode: 'full', rows: mem.transfers.length + Object.keys(mem.wallets).length + Object.keys(mem.tokens).length };
    } else {
    const byId = new Map();
    for (const t of mem.transfers) byId.set(t.id, t);

    const delta = { meta: null, opportunities: null, scanLog: null };
    delta.wallets = [...dirty.wallets].map((k) => mem.wallets[k]).filter(Boolean);
    delta.walletDeletes = [...dirty.walletDeletes].filter((k) => !mem.wallets[k]);
    delta.tokens = [...dirty.tokens].map((k) => mem.tokens[k]).filter(Boolean);
    delta.tokenDeletes = [...dirty.tokenDeletes].filter((k) => !mem.tokens[k]);
    delta.transfers = [...dirty.transfers].map((id) => byId.get(id)).filter(Boolean);
    delta.transferDeletes = [...dirty.transferDeletes].filter((id) => !byId.has(id));
    if (dirty.opportunities) delta.opportunities = mem.opportunities;
    if (dirty.scanLog) delta.scanLog = mem.scanLog;
    if (dirty.meta) delta.meta = { version: mem.version, settings: mem.settings, stats: mem.stats, decisions: mem.decisions };

    db.persistDelta(delta);
    const written = delta.wallets.length + delta.tokens.length + delta.transfers.length;
    clearDirty();
    res = { mode: 'delta', rows: written };
    }
  } catch (err) {
    console.error('[store] 写入失败，降级为全量重写：', err.message);
    try { db.persistFull(mem); clearDirty(); res = { mode: 'full-fallback' }; }
    catch (e2) { console.error('[store] 全量重写也失败：', e2.message); res = { mode: 'failed', error: e2.message }; }
  }
  res.ms = Number(((Number(process.hrtime.bigint()) / 1e6) - t0).toFixed(1));
  lastFlush = res;
  return res;
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; flush(); }, 400);
}

function raw() { return load(); }
function settings() { return load().settings; }

function log(entry) {
  const d = load();
  d.scanLog.unshift(Object.assign({ ts: new Date().toISOString() }, entry));
  if (d.scanLog.length > 300) d.scanLog.length = 300;
  dirty.scanLog = true;
  save();
}

// ---------- transfers ----------
function transferId(t) {
  const tok = t.tokenAddress || t.tokenSymbol || '';
  const extra = t.msgId || t.emitterChain || '';
  return `${t.source}:${t.txHash || ''}:${t.fromChain || ''}:${t.toChain || ''}${tok ? ':' + tok : ''}${extra ? ':' + extra : ''}`;
}

// 返回真正新增的记录列表（不是数量）——调用方必须只对新增记录做沉淀，
// 否则重复扫描会把钱包的桥次数、币种数等计数反复累加，数据虚高。
function addTransfers(list) {
  const d = load();
  const seen = new Set(d.transfers.map((t) => t.id || transferId(t)));
  const addedList = [];
  for (const t of list) {
    const id = transferId(t);
    if (seen.has(id)) continue;
    seen.add(id);
    t.id = id;
    t.addedAt = new Date().toISOString();
    d.transfers.push(t);
    addedList.push(t);
  }
  if (addedList.length) {
    for (const t of addedList) touchTransfer(t.id);
    d.transfers.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    const cap = d.settings.scan.maxTransfers || 8000;
    // 超上限时截掉最旧的：被截掉的行必须显式记录，否则磁盘里会残留
    if (d.transfers.length > cap) {
      for (const t of d.transfers.splice(cap)) dirty.transferDeletes.add(t.id);
    }
    d.stats.transfersSeen += addedList.length;
    touchMeta();
    save();
  }
  return addedList;
}

// ---------- wallets ----------
function upsertWallet(address, patch = {}) {
  if (!address) return null;
  const d = load();
  const key = String(address).toLowerCase();
  const w = d.wallets[key] || {
    address: String(address),
    firstSeen: new Date().toISOString(),
    tags: [],
    notes: '',
    starred: false,
    ignored: false,
    bridgeCount: 0,
    tokens: {},
    chains: {},
    sources: {},
    roundtrips: 0,
    dirs: {},
    score: 0,
  };
  Object.assign(w, patch);
  w.lastSeen = w.lastSeen || new Date().toISOString();
  d.wallets[key] = w;
  touchWallet(key);
  save();
  return w;
}

/** 删除钱包（server 层删地址时必须走这里，否则磁盘会残留） */
function removeWallet(address) {
  const d = load();
  const key = String(address || '').toLowerCase();
  if (!key || !d.wallets[key]) return false;
  delete d.wallets[key];
  dirty.wallets.delete(key);
  dirty.walletDeletes.add(key);
  save();
  return true;
}

// ---------- tokens ----------
function tokenKey(chain, address) {
  return `${chain}:${String(address || '').toLowerCase()}`;
}

function upsertToken(chain, address, patch = {}) {
  const d = load();
  const key = tokenKey(chain, address);
  const t = d.tokens[key] || {
    chain, address: String(address || '').toLowerCase(),
    firstSeen: new Date().toISOString(),
    bridges: 0,
    wallets: {},
    routes: {},
    starred: false,
    ignored: false,
    checkedAt: null,
    bestSpread: null,
  };
  Object.assign(t, patch);
  d.tokens[key] = t;
  touchToken(key);
  save();
  return t;
}

/** 删除代币 */
function removeToken(chain, address) {
  const d = load();
  const key = tokenKey(chain, address);
  if (!d.tokens[key]) return false;
  delete d.tokens[key];
  dirty.tokens.delete(key);
  dirty.tokenDeletes.add(key);
  save();
  return true;
}

// ---------- opportunities ----------
function addOpportunities(list) {
  const d = load();
  let added = 0;
  for (const o of list) {
    const idx = d.opportunities.findIndex((x) => x.symbol === o.symbol && x.buyChain === o.buyChain && x.sellChain === o.sellChain);
    if (idx >= 0) {
      d.opportunities[idx] = Object.assign(d.opportunities[idx], o, { hits: (d.opportunities[idx].hits || 0) + 1 });
    } else {
      d.opportunities.unshift(Object.assign({ hits: 1, ts: new Date().toISOString() }, o));
      added++;
    }
  }
  if (d.opportunities.length > 500) d.opportunities.length = 500;
  dirty.opportunities = true; // 表小（≤500 行）且无稳定主键，整表替换更划算
  save();
  return added;
}

// ---------- decisions（人工决策 / 素材沉淀） ----------
// 给「某条机会」挂一份人工决策记录，独立于机会对象本体——自动扫描会整表替换 opportunities，
// 但不会碰 decisions，因此人工标记（跟进/放弃/执行/结算 + 备注 + 盈亏日志）不会被扫描冲掉。
// key = symbol|buyChain|sellChain（规范化小写）。
const DECISION_STATUS = ['todo', 'watching', 'executed', 'closed', 'dropped'];
const DECISION_LABEL = { todo: '待定', watching: '已跟进', executed: '已执行', closed: '已结算', dropped: '已放弃' };

function decisionKey(symbol, buyChain, sellChain) {
  return `${String(symbol || '').toUpperCase()}|${String(buyChain || '').toLowerCase()}|${String(sellChain || '').toLowerCase()}`;
}

/** 创建 / 更新某机会的决策状态。patch 必须含 symbol/buyChain/sellChain（用于定位机会），
 *  可选 { status?, note? }。不存在则自动建一条。 */
function upsertDecision(patch = {}) {
  const d = load();
  const k = decisionKey(patch.symbol, patch.buyChain, patch.sellChain);
  const now = new Date().toISOString();
  const cur = d.decisions[k] || {
    key: k, symbol: patch.symbol, buyChain: patch.buyChain, sellChain: patch.sellChain,
    status: 'todo', note: '', journal: [], realizedPnlUsd: 0,
    createdAt: now, updatedAt: now,
  };
  if (patch.status) cur.status = patch.status;
  if (patch.note !== undefined) cur.note = String(patch.note);
  const snapshotProps = ['buyPrice', 'sellPrice', 'spreadPct', 'verdict', 'buyAddress', 'sellAddress', 'buyDex', 'sellDex', 'minLiquidityUsd'];
  for (const sp of snapshotProps) {
    if (patch[sp] !== undefined) cur[sp] = patch[sp];
  }
  cur.updatedAt = now;
  d.decisions[k] = cur;
  touchMeta();
  save();
  return cur;
}

/** 向某机会的盈亏/行动日志追加一条。patch 必须含 symbol/buyChain/sellChain；entry: { status?, text, pnlDeltaUsd? } */
function appendDecisionLog(patch = {}) {
  const d = load();
  const k = decisionKey(patch.symbol, patch.buyChain, patch.sellChain);
  const now = new Date().toISOString();
  const cur = d.decisions[k] || upsertDecision(patch);
  cur.journal = cur.journal || [];
  const delta = Number(patch.pnlDeltaUsd) || 0;
  cur.journal.unshift({
    ts: patch.ts || now,
    status: patch.status || cur.status,
    text: patch.text || '',
    pnlDeltaUsd: delta,
  });
  if (delta) cur.realizedPnlUsd = (cur.realizedPnlUsd || 0) + delta;
  if (cur.journal.length > 100) cur.journal.length = 100;
  cur.updatedAt = now;
  d.decisions[k] = cur;
  touchMeta();
  save();
  return cur;
}

/** 删除一条决策记录（key 形如 SYMBOL|buychain|sellchain；兼容大小写/空格差异，统一按 decisionKey 归一化） */
function removeDecision(key) {
  const d = load();
  const parts = String(key || '').split('|').map((p) => p.trim());
  const k = parts.length >= 3
    ? decisionKey(parts[0], parts[1], parts[2])
    : String(key || '').toUpperCase();
  if (!d.decisions[k]) return false;
  delete d.decisions[k];
  touchMeta();
  save();
  return true;
}

// ---------- 备份 / 存储状态 ----------
/** 手动触发一次一致性备份，返回备份文件路径 */
function backupNow() {
  if (!fs.existsSync(db.BACKUP_DIR)) fs.mkdirSync(db.BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(db.BACKUP_DIR, `radar-${stamp}.db`);
  db.backup(dest);
  pruneBackups();
  return dest;
}

/** 滚动保留最近 N 份备份 */
function pruneBackups(keep = 20) {
  const list = db.listBackups();
  for (const b of list.slice(keep)) {
    try { fs.unlinkSync(path.join(db.BACKUP_DIR, b.file)); } catch { /* ignore */ }
  }
}

function storageStatus() {
  const s = db.storageStatus();
  s.legacyJsonExists = fs.existsSync(DB_FILE);
  s.inMemory = {
    wallets: Object.keys(load().wallets).length,
    tokens: Object.keys(load().tokens).length,
    transfers: load().transfers.length,
    opportunities: load().opportunities.length,
  };
  // 写入效率：增量持久化后每次保存实际写了多少行、耗时多少（对比全量重写的万行级）
  s.lastFlush = lastFlush;
  s.dirty = {
    wallets: dirty.wallets.size,
    tokens: dirty.tokens.size,
    transfers: dirty.transfers.size,
    pending: dirty.fullRebuild,
  };
  return s;
}

/** 供测试/运维：强制全量重写一次（重建索引、收缩文件） */
function compact() {
  const r = flush({ full: true });
  return Object.assign({ checkpoint: db.checkpoint('TRUNCATE') }, r);
}

module.exports = {
  load, save, flush, raw, settings, log,
  addTransfers, upsertWallet, upsertToken, addOpportunities, tokenKey, DEFAULT_SETTINGS,
  removeWallet, removeToken,
  decisionKey, DECISION_STATUS, DECISION_LABEL,
  upsertDecision, appendDecisionLog, removeDecision,
  touchWallet, touchToken, touchTransfer, touchMeta, markFull,
  checkpoint: db.checkpoint,
  queryTransfers: db.queryTransfers,
  aggregateTransfers: db.aggregateTransfers,
  backupNow, pruneBackups, storageStatus, compact,
};
