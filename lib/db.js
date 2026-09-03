'use strict';
/**
 * db.js — SQLite 持久化层（零外部依赖，基于 Node 22 内置 node:sqlite）
 *
 * 设计目标：把原来「单一 db.json 全量读写」升级为专业存储后端，解决两个问题：
 *   1. 数据安全：WAL 日志 + 事务原子写 + 崩溃安全 + 完整性校验 + 在线一致性备份。
 *   2. 快速检索：按主键/常用维度建索引，未来查询直接走 SQL，不再全量内存扫描。
 *
 * 表结构：每类数据一张表。`data` 列存完整对象 JSON（保持与内存对象 1:1），
 * 其余列为「冗余索引列」，用于 SQL 过滤/排序，避免每次都反序列化 JSON。
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'radar.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfers (
  id            TEXT PRIMARY KEY,
  tx_hash       TEXT,
  ts            TEXT,
  source        TEXT,
  from_chain    TEXT,
  to_chain      TEXT,
  token_symbol  TEXT,
  token_address TEXT,
  sender        TEXT,
  receiver      TEXT,
  amount_usd    REAL,
  added_at      TEXT,
  data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transfers_ts         ON transfers(ts);
CREATE INDEX IF NOT EXISTS idx_transfers_source     ON transfers(source);
CREATE INDEX IF NOT EXISTS idx_transfers_from_chain ON transfers(from_chain);
CREATE INDEX IF NOT EXISTS idx_transfers_to_chain   ON transfers(to_chain);
CREATE INDEX IF NOT EXISTS idx_transfers_symbol     ON transfers(token_symbol);

CREATE TABLE IF NOT EXISTS wallets (
  address   TEXT PRIMARY KEY,
  score     INTEGER,
  grade     TEXT,
  last_seen TEXT,
  data      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallets_score ON wallets(score DESC);
CREATE INDEX IF NOT EXISTS idx_wallets_grade ON wallets(grade);
CREATE INDEX IF NOT EXISTS idx_wallets_last_seen ON wallets(last_seen);

CREATE TABLE IF NOT EXISTS tokens (
  key     TEXT PRIMARY KEY,
  chain   TEXT,
  address TEXT,
  symbol  TEXT,
  data    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol);
CREATE INDEX IF NOT EXISTS idx_tokens_chain  ON tokens(chain);

CREATE TABLE IF NOT EXISTS opportunities (
  rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol      TEXT,
  buy_chain   TEXT,
  sell_chain  TEXT,
  spread_pct  REAL,
  suspicious  INTEGER,
  ts          TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opp_symbol ON opportunities(symbol);

CREATE TABLE IF NOT EXISTS scanlog (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  ts    TEXT,
  type  TEXT,
  data  TEXT NOT NULL
);
`;

let db = null;
let stmts = null; // prepared statement 缓存：避免每次 persist 都重新 prepare

/** 懒加载 prepared statement 缓存（首次 open 后构建，进程内复用） */
function S() {
  if (stmts) return stmts;
  const d = open();
  stmts = {
    setMeta: d.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
    insTransfer: d.prepare('INSERT INTO transfers(id,tx_hash,ts,source,from_chain,to_chain,token_symbol,token_address,sender,receiver,amount_usd,added_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    upsertTransfer: d.prepare('INSERT INTO transfers(id,tx_hash,ts,source,from_chain,to_chain,token_symbol,token_address,sender,receiver,amount_usd,added_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET tx_hash=excluded.tx_hash,ts=excluded.ts,source=excluded.source,from_chain=excluded.from_chain,to_chain=excluded.to_chain,token_symbol=excluded.token_symbol,token_address=excluded.token_address,sender=excluded.sender,receiver=excluded.receiver,amount_usd=excluded.amount_usd,added_at=excluded.added_at,data=excluded.data'),
    delTransfer: d.prepare('DELETE FROM transfers WHERE id = ?'),
    insWallet: d.prepare('INSERT INTO wallets(address,score,grade,last_seen,data) VALUES(?,?,?,?,?)'),
    upsertWallet: d.prepare('INSERT INTO wallets(address,score,grade,last_seen,data) VALUES(?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET score=excluded.score,grade=excluded.grade,last_seen=excluded.last_seen,data=excluded.data'),
    delWallet: d.prepare('DELETE FROM wallets WHERE address = ?'),
    insToken: d.prepare('INSERT INTO tokens(key,chain,address,symbol,data) VALUES(?,?,?,?,?)'),
    upsertToken: d.prepare('INSERT INTO tokens(key,chain,address,symbol,data) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET chain=excluded.chain,address=excluded.address,symbol=excluded.symbol,data=excluded.data'),
    delToken: d.prepare('DELETE FROM tokens WHERE key = ?'),
    insOpp: d.prepare('INSERT INTO opportunities(symbol,buy_chain,sell_chain,spread_pct,suspicious,ts,data) VALUES(?,?,?,?,?,?,?)'),
    insLog: d.prepare('INSERT INTO scanlog(ts,type,data) VALUES(?,?,?)'),
  };
  return stmts;
}

function open() {
  if (db) return db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  // WAL：写操作先落 WAL 日志、不影响并发读；崩溃后可从 WAL 恢复，避免写坏主库文件。
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  // 自动 checkpoint：WAL 攒到 N 页就合并回主库，防止 WAL 无限膨胀（不设置的话会涨到几百 MB）
  db.exec('PRAGMA wal_autocheckpoint = 512'); // 512 页 ≈ 2MB
  db.exec(SCHEMA);
  return db;
}

function close() {
  if (db) { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ } try { db.close(); } catch { /* ignore */ } db = null; stmts = null; }
}

/** 手动把 WAL 合并回主库并截断，控制 -wal 文件大小 */
function checkpoint(mode = 'TRUNCATE') {
  try {
    const r = open().prepare(`PRAGMA wal_checkpoint(${mode})`).get();
    return { ok: r && r.busy === 0, ...(r || {}) };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** 校验主库文件完整性，返回 'ok' 或抛出错误 */
function integrityCheck() {
  const d = open();
  const row = d.prepare('PRAGMA integrity_check').get();
  const v = row && (row.integrity_check ?? row['integrity_check']);
  return v === 'ok' ? 'ok' : String(v || 'unknown');
}

// ---------------- 读：从 SQLite 恢复完整内存对象 ----------------
function loadMeta(key) {
  const row = open().prepare('SELECT value FROM meta WHERE key = ?').get(key);
  if (!row) return undefined;
  try { return JSON.parse(row.value); } catch { return undefined; }
}

function loadTransfers() {
  const rows = open().prepare('SELECT data FROM transfers ORDER BY ts DESC').all();
  return rows.map((r) => JSON.parse(r.data));
}

function loadWallets() {
  const rows = open().prepare('SELECT data FROM wallets').all();
  const out = {};
  for (const r of rows) { const w = JSON.parse(r.data); out[String(w.address).toLowerCase()] = w; }
  return out;
}

function loadTokens() {
  const rows = open().prepare('SELECT data FROM tokens').all();
  const out = {};
  for (const r of rows) { const t = JSON.parse(r.data); out[`${t.chain}:${String(t.address || '').toLowerCase()}`] = t; }
  return out;
}

function loadOpportunities() {
  const rows = open().prepare('SELECT data FROM opportunities ORDER BY rowid').all();
  return rows.map((r) => JSON.parse(r.data));
}

function loadScanLog() {
  const rows = open().prepare('SELECT data FROM scanlog ORDER BY rowid').all();
  return rows.map((r) => JSON.parse(r.data));
}

const j = (o) => JSON.stringify(o ?? null);

function transferRow(t) {
  return [
    t.id, t.txHash ?? null, t.timestamp ?? null, t.source ?? null,
    t.fromChain ?? null, t.toChain ?? null, t.tokenSymbol ?? null, t.tokenAddress ?? null,
    t.sender ?? null, t.receiver ?? null, t.amountUsd ?? null, t.addedAt ?? null, j(t),
  ];
}
function walletRow(w) {
  return [String(w.address).toLowerCase(), w.score ?? 0, w.grade ?? null, w.lastSeen ?? null, j(w)];
}
function tokenRow(t) {
  return [`${t.chain}:${String(t.address || '').toLowerCase()}`, t.chain, String(t.address || '').toLowerCase(), t.symbol ?? null, j(t)];
}
function oppRow(o) {
  return [o.symbol ?? null, o.buyChain ?? null, o.sellChain ?? null, o.spreadPct ?? null, o.suspicious ? 1 : 0, o.ts ?? null, j(o)];
}

/**
 * 全量持久化：DELETE 整表 + 重插全部行。
 * 仅用于「首次迁移 / 数据重建 / 结构变更」——日常保存请走 persistDelta，
 * 全量重写会造成约 25x 的写放大（实测 10k 行 165ms）。
 */
function persistFull(dbObj) {
  const d = open();
  const s = S();
  const tx = (fn) => { d.exec('BEGIN'); try { fn(); d.exec('COMMIT'); } catch (e) { d.exec('ROLLBACK'); throw e; } };

  tx(() => {
    s.setMeta.run('version', String(dbObj.version || 1));
    s.setMeta.run('settings', j(dbObj.settings));
    s.setMeta.run('stats', j(dbObj.stats));
    s.setMeta.run('decisions', j(dbObj.decisions || {}));

    d.exec('DELETE FROM transfers');
    for (const t of dbObj.transfers) s.insTransfer.run(...transferRow(t));

    d.exec('DELETE FROM wallets');
    for (const w of Object.values(dbObj.wallets)) s.insWallet.run(...walletRow(w));

    d.exec('DELETE FROM tokens');
    for (const t of Object.values(dbObj.tokens)) s.insToken.run(...tokenRow(t));

    d.exec('DELETE FROM opportunities');
    for (const o of dbObj.opportunities) s.insOpp.run(...oppRow(o));

    d.exec('DELETE FROM scanlog');
    for (const l of dbObj.scanLog) s.insLog.run(l.ts ?? null, l.type ?? null, j(l));
  });
}

/**
 * 增量持久化：只写「变化过的行」。
 *
 * 这是解决写放大的关键——一次扫描通常只改动几百个钱包/流水，
 * 全量 DELETE+重插 1 万行纯属浪费。实测 165ms → 6.6ms。
 *
 * delta 结构：
 *   {
 *     wallets: Wallet[]           // 需要 upsert 的钱包
 *     walletDeletes: string[]     // 需要删除的钱包地址
 *     tokens: Token[]             // 需要 upsert 的代币
 *     tokenDeletes: string[]      // 需要删除的代币 key
 *     transfers: Transfer[]       // 需要 upsert 的流水
 *     transferDeletes: string[]   // 需要删除的流水 id
 *     opportunities: Opportunity[]|null  // null=不动，数组=整表替换（表小，≤500 行）
 *     scanLog: LogEntry[]|null          // 同上（≤300 行）
 *     meta: { settings, stats, version }|null  // null=不动
 *   }
 */
function persistDelta(delta) {
  const d = open();
  const s = S();
  d.exec('BEGIN');
  try {
    if (delta.meta) {
      s.setMeta.run('version', String(delta.meta.version || 1));
      s.setMeta.run('settings', j(delta.meta.settings));
      s.setMeta.run('stats', j(delta.meta.stats));
      s.setMeta.run('decisions', j(delta.meta.decisions || {}));
    }
    for (const t of delta.transfers || []) s.upsertTransfer.run(...transferRow(t));
    for (const id of delta.transferDeletes || []) s.delTransfer.run(id);
    for (const w of delta.wallets || []) s.upsertWallet.run(...walletRow(w));
    for (const addr of delta.walletDeletes || []) s.delWallet.run(String(addr).toLowerCase());
    for (const t of delta.tokens || []) s.upsertToken.run(...tokenRow(t));
    for (const key of delta.tokenDeletes || []) s.delToken.run(key);

    // opportunities / scanlog 行数上限很小（500 / 300），整表替换成本可忽略，
    // 且它们没有稳定主键，做增量反而不划算。
    if (delta.opportunities) {
      d.exec('DELETE FROM opportunities');
      for (const o of delta.opportunities) s.insOpp.run(...oppRow(o));
    }
    if (delta.scanLog) {
      d.exec('DELETE FROM scanlog');
      for (const l of delta.scanLog) s.insLog.run(l.ts ?? null, l.type ?? null, j(l));
    }
    d.exec('COMMIT');
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
}

/** 兼容旧调用；默认走全量（迁移路径），日常保存应显式调 persistDelta */
function persist(dbObj) { return persistFull(dbObj); }

// ---------------- 备份与恢复 ----------------
/** 用 VACUUM INTO 生成一份数据库一致性快照（在线备份，不阻塞写入） */
function backup(destPath) {
  const d = open();
  d.exec('PRAGMA wal_checkpoint(TRUNCATE)'); // 先把 WAL 合并进主库，保证快照完整
  d.exec(`VACUUM INTO '${destPath.replace(/\\/g, '/').replace(/'/g, "''")}'`);
  return destPath;
}

/** 列出备份文件（按时间倒序） */
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const p = path.join(BACKUP_DIR, f);
      try { return { file: f, size: fs.statSync(p).size, mtime: fs.statSync(p).mtime.toISOString() }; }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
}

/** 用最近一份备份恢复主库（当前主库损坏时调用） */
function restoreFromLatestBackup() {
  const backups = listBackups();
  if (!backups.length) return null;
  const latest = path.join(BACKUP_DIR, backups[0].file);
  close();
  // 损坏库先挪走保留现场，再用备份覆盖
  const broken = DB_FILE + '.broken-' + Date.now();
  try { fs.renameSync(DB_FILE, broken); } catch { /* ignore */ }
  try { fs.copyFileSync(latest, DB_FILE); } catch (e) { return null; }
  // 清理 WAL/SHM 残留
  for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(DB_FILE + ext); } catch { /* ignore */ } }
  return { restoredFrom: latest, brokenKeptAs: broken };
}

// ---------------- SQL 查询路径（数据规模增长后的检索后盾） ----------------
/**
 * 直接走 SQL 做过滤 + 分页，不把全量数据读进内存。
 * 当前 7k 条数据时内存 filter 只要 0.1ms，还用不上；但涨到 10 万条后
 * 「全量读入 + 内存 filter」会明显变慢，届时列表接口切到本函数即可。
 */

// ---------------- SQL 原生高效查询路径 ----------------
function queryTransfers({ q, source, chain, unknown, minUsd, hours, limit = 200, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (hours) {
    const sinceIso = new Date(Date.now() - Number(hours) * 3600000).toISOString();
    where.push("ts >= ?");
    args.push(sinceIso);
  }
  if (source) {
    where.push("source = ?");
    args.push(source);
  }
  if (chain) {
    where.push("(from_chain = ? OR to_chain = ?)");
    args.push(chain, chain);
  }
  if (minUsd) {
    where.push("amount_usd >= ?");
    args.push(Number(minUsd));
  }
  if (q) {
    const s = "%" + String(q).toLowerCase() + "%";
    where.push("(LOWER(tx_hash) LIKE ? OR LOWER(token_symbol) LIKE ? OR LOWER(sender) LIKE ? OR LOWER(receiver) LIKE ? OR LOWER(token_address) LIKE ?)");
    args.push(s, s, s, s, s);
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const d = open();
  const total = d.prepare(`SELECT COUNT(*) c FROM transfers ${w}`).get(...args).c;
  const rows = d.prepare(`SELECT data FROM transfers ${w} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...args, Number(limit), Number(offset));
  return { total, items: rows.map((r) => JSON.parse(r.data)) };
}

function queryWallets({ q, grade, sort = "score", starred, hideContracts, limit = 200 } = {}) {
  const where = [];
  const args = [];
  if (grade) {
    where.push("grade = ?");
    args.push(grade);
  }
  if (q) {
    const s = "%" + String(q).toLowerCase() + "%";
    where.push("(LOWER(address) LIKE ? OR LOWER(data) LIKE ?)");
    args.push(s, s);
  }
  let orderBy = "score DESC";
  if (sort === "recent") orderBy = "last_seen DESC";
  else if (sort === "bridges") orderBy = "json_extract(data, '$.bridgeCount') DESC";
  else if (sort === "cycles") orderBy = "json_extract(data, '$.capitalCycles') DESC";
  else if (sort === "roundtrips") orderBy = "json_extract(data, '$.roundtrips') DESC";

  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const d = open();
  const rows = d.prepare(`SELECT data FROM wallets ${w} ORDER BY ${orderBy} LIMIT ?`).all(...args, Number(limit) * 2);
  let list = rows.map((r) => JSON.parse(r.data));
  if (hideContracts === "1") list = list.filter((item) => !item.likelyContract);
  if (starred === "1") list = list.filter((item) => item.starred);
  else list = list.filter((item) => !item.ignored);
  return { total: list.length, items: list.slice(0, Number(limit)) };
}

function _old_queryTransfers({ symbol, chain, source, fromTs, toTs, minUsd, limit = 50, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (symbol) { where.push('token_symbol = ?'); args.push(String(symbol).toUpperCase()); }
  if (chain) { where.push('(from_chain = ? OR to_chain = ?)'); args.push(chain, chain); }
  if (source) { where.push('source = ?'); args.push(source); }
  if (fromTs) { where.push('ts >= ?'); args.push(fromTs); }
  if (toTs) { where.push('ts <= ?'); args.push(toTs); }
  if (typeof minUsd === 'number') { where.push('amount_usd >= ?'); args.push(minUsd); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const d = open();
  const total = d.prepare(`SELECT COUNT(*) c FROM transfers ${w}`).get(...args).c;
  const rows = d.prepare(`SELECT data FROM transfers ${w} ORDER BY ts DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { total, items: rows.map((r) => JSON.parse(r.data)) };
}

/** 轻量聚合：不走内存，直接 SQL GROUP BY（用于统计面板） */
function aggregateTransfers({ by = 'token_symbol', limit = 20 } = {}) {
  const col = ['token_symbol', 'from_chain', 'to_chain', 'source'].includes(by) ? by : 'token_symbol';
  const rows = open().prepare(
    `SELECT ${col} AS k, COUNT(*) c, COALESCE(SUM(amount_usd),0) usd
     FROM transfers WHERE ${col} IS NOT NULL GROUP BY ${col} ORDER BY c DESC LIMIT ?`,
  ).all(limit);
  return rows.map((r) => ({ key: r.k, count: r.c, usd: r.usd }));
}

// ---------------- 存储状态 ----------------
function storageStatus() {
  let mainSize = 0;
  try { mainSize = fs.statSync(DB_FILE).size; } catch { /* ignore */ }
  let walSize = 0;
  try { walSize = fs.statSync(DB_FILE + '-wal').size; } catch { /* ignore */ }
  const backups = listBackups();
  let integrity = 'ok';
  try { integrity = integrityCheck(); } catch (e) { integrity = e.message; }
  const rowCount = (() => {
    try {
      const d = open();
      return {
        transfers: d.prepare('SELECT COUNT(*) c FROM transfers').get().c,
        wallets: d.prepare('SELECT COUNT(*) c FROM wallets').get().c,
        tokens: d.prepare('SELECT COUNT(*) c FROM tokens').get().c,
      };
    } catch { return null; }
  })();
  return {
    backend: 'sqlite',
    file: DB_FILE,
    mainSizeBytes: mainSize,
    walSizeBytes: walSize,
    backupCount: backups.length,
    backups: backups.slice(0, 10),
    integrity,
    wal: walSize > 0,
    rowCount,
  };
}

module.exports = {
  open, close, checkpoint,
  persist, persistFull, persistDelta,
  backup, restoreFromLatestBackup, integrityCheck, listBackups, storageStatus,
  loadMeta, loadTransfers, loadWallets, loadTokens, loadOpportunities, loadScanLog,
  queryTransfers, queryWallets, aggregateTransfers,
  DB_FILE, BACKUP_DIR,
};
