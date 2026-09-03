'use strict';
/**
 * bench.js — 存储层基准测试
 *
 * 量化三个维度，用迁移前的 legacy JSON 做对照：
 *   1. 加载耗时：SQLite 全表读 vs JSON 全量 parse
 *   2. 写入耗时：persist() 全量重写 vs JSON 全量序列化
 *   3. 检索耗时：内存数组 filter vs SQL 索引查询
 *
 * 用法：node tools/bench.js
 */
process.env.__BENCH__ = '1';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'radar.db');

const hr = () => Number(process.hrtime.bigint()) / 1e6;
const fmt = (ms) => `${ms.toFixed(1)}ms`;
const line = (t) => console.log('\n' + '='.repeat(64) + `\n${t}\n` + '='.repeat(64));

function findLegacyJson() {
  return fs.readdirSync(DATA_DIR)
    .filter((f) => /^db\.(json|backup-.*\.json)(\.|$)/.test(f))
    .map((f) => ({ f, size: fs.statSync(path.join(DATA_DIR, f)).size }))
    .sort((a, b) => b.size - a.size)[0];
}

// ---------------------------------------------------------------- 1. 加载
line('1. 加载耗时（冷启动恢复全部数据到内存）');

const legacy = findLegacyJson();
let legacyObj = null;
if (legacy) {
  const p = path.join(DATA_DIR, legacy.f);
  let t0 = hr();
  const txt = fs.readFileSync(p, 'utf8');
  const tRead = hr() - t0;
  t0 = hr();
  legacyObj = JSON.parse(txt);
  const tParse = hr() - t0;
  console.log(`  [JSON ] ${legacy.f} (${(legacy.size / 1048576).toFixed(1)}MB)`);
  console.log(`            read=${fmt(tRead)}  parse=${fmt(tParse)}  合计=${fmt(tRead + tParse)}`);
  console.log(`            transfers=${(legacyObj.transfers || []).length}  wallets=${Object.keys(legacyObj.wallets || {}).length}  tokens=${Object.keys(legacyObj.tokens || {}).length}`);
}

const db = new DatabaseSync(DB_FILE, { readOnly: true });
db.exec('PRAGMA journal_mode = WAL');

let t0 = hr();
const rowsT = db.prepare('SELECT data FROM transfers ORDER BY ts DESC').all();
const transfers = rowsT.map((r) => JSON.parse(r.data));
const tTransfers = hr() - t0;

t0 = hr();
const rowsW = db.prepare('SELECT data FROM wallets').all();
const wallets = rowsW.map((r) => JSON.parse(r.data));
const tWallets = hr() - t0;

t0 = hr();
const rowsK = db.prepare('SELECT data FROM tokens').all();
const tokens = rowsK.map((r) => JSON.parse(r.data));
const tTokens = hr() - t0;

const tSqlTotal = tTransfers + tWallets + tTokens;
console.log(`  [SQLite] radar.db (${(fs.statSync(DB_FILE).size / 1048576).toFixed(1)}MB)`);
console.log(`            transfers=${fmt(tTransfers)}  wallets=${fmt(tWallets)}  tokens=${fmt(tTokens)}  合计=${fmt(tSqlTotal)}`);
console.log(`            transfers=${transfers.length}  wallets=${wallets.length}  tokens=${tokens.length}`);

// ---------------------------------------------------------------- 2. 写入
line('2. 写入耗时（一次 save 的持久化成本）');

// 模拟当前 persist()：DELETE 全表 + 全量重插
const tmpW = path.join(DATA_DIR, '__bench_full.db');
for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpW + ext); } catch { /* */ } }
function simPersistFull(d, label) {
  let t = 0;
  const tx = (fn) => { d.exec('BEGIN'); try { fn(); d.exec('COMMIT'); } catch (e) { d.exec('ROLLBACK'); throw e; } };
  const j = (o) => JSON.stringify(o ?? null);
  const start = hr();
  tx(() => {
    d.exec('DELETE FROM transfers');
    const ins = d.prepare('INSERT INTO transfers(id,tx_hash,ts,source,from_chain,to_chain,token_symbol,token_address,sender,receiver,amount_usd,added_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const x of transfers) {
      ins.run(x.id, x.txHash ?? null, x.timestamp ?? null, x.source ?? null,
        x.fromChain ?? null, x.toChain ?? null, x.tokenSymbol ?? null, x.tokenAddress ?? null,
        x.sender ?? null, x.receiver ?? null, x.amountUsd ?? null, x.addedAt ?? null, j(x));
    }
    d.exec('DELETE FROM wallets');
    const insW = d.prepare('INSERT INTO wallets(address,score,grade,last_seen,data) VALUES(?,?,?,?,?)');
    for (const w of wallets) insW.run(String(w.address).toLowerCase(), w.score ?? 0, w.grade ?? null, w.lastSeen ?? null, j(w));
    d.exec('DELETE FROM tokens');
    const insK = d.prepare('INSERT INTO tokens(key,chain,address,symbol,data) VALUES(?,?,?,?,?)');
    for (const k of tokens) insK.run(`${k.chain}:${String(k.address || '').toLowerCase()}`, k.chain, String(k.address || '').toLowerCase(), k.symbol ?? null, j(k));
  });
  t = hr() - start;
  console.log(`  [全量重写 ${label}] ${fmt(t)}  （DELETE ${transfers.length + wallets.length + tokens.length} 行 + 重插同等行数）`);
  return t;
}

const dFull = new DatabaseSync(tmpW);
dFull.exec('PRAGMA journal_mode = WAL');
dFull.exec('PRAGMA synchronous = NORMAL');
dFull.exec(`CREATE TABLE transfers(id TEXT PRIMARY KEY,tx_hash TEXT,ts TEXT,source TEXT,from_chain TEXT,to_chain TEXT,token_symbol TEXT,token_address TEXT,sender TEXT,receiver TEXT,amount_usd REAL,added_at TEXT,data TEXT NOT NULL);
CREATE INDEX i1 ON transfers(ts); CREATE INDEX i2 ON transfers(source); CREATE INDEX i3 ON transfers(from_chain); CREATE INDEX i4 ON transfers(to_chain); CREATE INDEX i5 ON transfers(token_symbol);
CREATE TABLE wallets(address TEXT PRIMARY KEY,score INTEGER,grade TEXT,last_seen TEXT,data TEXT NOT NULL); CREATE INDEX i6 ON wallets(score DESC); CREATE INDEX i7 ON wallets(grade); CREATE INDEX i8 ON wallets(last_seen);
CREATE TABLE tokens(key TEXT PRIMARY KEY,chain TEXT,address TEXT,symbol TEXT,data TEXT NOT NULL); CREATE INDEX i9 ON tokens(symbol); CREATE INDEX i10 ON tokens(chain);`);
const tFull = simPersistFull(dFull, '当前实现');

// 模拟增量：只 upsert N 条变更（模拟一次扫描改了 200 个钱包 + 新增 300 条流水）
function simPersistDelta(d, nWallets, nTransfers) {
  const j = (o) => JSON.stringify(o ?? null);
  const sampleW = wallets.slice(0, nWallets);
  const sampleT = transfers.slice(0, nTransfers);
  const start = hr();
  d.exec('BEGIN');
  const insW = d.prepare('INSERT INTO wallets(address,score,grade,last_seen,data) VALUES(?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET score=excluded.score,grade=excluded.grade,last_seen=excluded.last_seen,data=excluded.data');
  for (const w of sampleW) insW.run(String(w.address).toLowerCase(), w.score ?? 0, w.grade ?? null, w.lastSeen ?? null, j(w));
  const insT = d.prepare('INSERT INTO transfers(id,tx_hash,ts,source,from_chain,to_chain,token_symbol,token_address,sender,receiver,amount_usd,added_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data');
  for (const x of sampleT) {
    insT.run(x.id, x.txHash ?? null, x.timestamp ?? null, x.source ?? null,
      x.fromChain ?? null, x.toChain ?? null, x.tokenSymbol ?? null, x.tokenAddress ?? null,
      x.sender ?? null, x.receiver ?? null, x.amountUsd ?? null, x.addedAt ?? null, j(x));
  }
  d.exec('COMMIT');
  const t = hr() - start;
  console.log(`  [增量 upsert] ${fmt(t)}  （只写变化的 ${nWallets} 钱包 + ${nTransfers} 流水）`);
  return t;
}
const tDelta = simPersistDelta(dFull, 200, 300);

console.log(`\n  → 一次典型扫描的写放大倍率：${(tFull / tDelta).toFixed(1)}x`);
console.log(`  → 每 5 分钟扫描一次，全量重写一天累计耗时约 ${((tFull * 288) / 1000 / 60).toFixed(1)} 分钟，增量约 ${((tDelta * 288) / 1000).toFixed(1)} 秒`);

try { dFull.close(); } catch { /* */ }

// JSON 全量序列化对照
if (legacyObj) {
  const start = hr();
  const s = JSON.stringify(legacyObj);
  const tSer = hr() - start;
  const p = path.join(DATA_DIR, '__bench.json');
  const s2 = hr();
  fs.writeFileSync(p, s);
  const tWrite = hr() - s2;
  console.log(`  [JSON 全量序列化] serialize=${fmt(tSer)}  write=${fmt(tWrite)}  合计=${fmt(tSer + tWrite)}（无事务、崩溃即损坏）`);
  try { fs.unlinkSync(p); } catch { /* */ }
}

// ---------------------------------------------------------------- 3. 检索
line('3. 检索耗时（内存 filter vs SQL 索引）');

const N = 200;
function bench(label, fn) {
  const t = hr();
  let r;
  for (let i = 0; i < N; i++) r = fn();
  const per = (hr() - t) / N;
  console.log(`  ${label.padEnd(46)} ${fmt(per)}  (命中 ${Array.isArray(r) ? r.length : r})`);
  return per;
}

// 找出流水里真实存在的 symbol / chain 做检索键
const symCount = new Map();
const chainCount = new Map();
for (const t of transfers) {
  if (t.tokenSymbol) symCount.set(t.tokenSymbol, (symCount.get(t.tokenSymbol) || 0) + 1);
  if (t.fromChain) chainCount.set(t.fromChain, (chainCount.get(t.fromChain) || 0) + 1);
}
const topSym = [...symCount.entries()].sort((a, b) => b[1] - a[1])[0];
const topChain = [...chainCount.entries()].sort((a, b) => b[1] - a[1])[0];
console.log(`  检索键：symbol=${topSym ? topSym[0] : 'N/A'}（${topSym ? topSym[1] : 0} 条）  chain=${topChain ? topChain[0] : 'N/A'}（${topChain ? topChain[1] : 0} 条）\n`);

const qBySymMem = db.prepare('SELECT COUNT(*) c FROM transfers WHERE token_symbol = ?');
const qBySymSql = db.prepare('SELECT id FROM transfers WHERE token_symbol = ?');
const qByChainSql = db.prepare('SELECT COUNT(*) c FROM transfers WHERE from_chain = ?');
const qTopSql = db.prepare('SELECT id,ts FROM transfers ORDER BY ts DESC LIMIT 50');

bench('按 symbol 过滤 — 内存数组 filter', () => transfers.filter((t) => t.tokenSymbol === topSym[0]));
bench('按 symbol 过滤 — SQL 索引 COUNT', () => qBySymMem.get(topSym[0]).c);
bench('按 symbol 过滤 — SQL 索引取行', () => qBySymSql.all(topSym[0]));
bench('按链过滤 — 内存数组 filter', () => transfers.filter((t) => t.fromChain === topChain[0]));
bench('按链过滤 — SQL 索引 COUNT', () => qByChainSql.get(topChain[0]).c);
bench('最新 50 条 — 内存 slice', () => transfers.slice(0, 50));
bench('最新 50 条 — SQL ORDER BY ts LIMIT', () => qTopSql.all());

// 钱包排序（评分榜）
const qScoreSql = db.prepare('SELECT address,score FROM wallets ORDER BY score DESC LIMIT 50');
bench('钱包评分 Top50 — 内存 sort', () => [...wallets].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 50));
bench('钱包评分 Top50 — SQL 索引排序', () => qScoreSql.all());

// ---------------------------------------------------------------- 4. 规模外推
line('4. 规模外推（按当前单条成本线性估算）');
const perRowWrite = tFull / (transfers.length + wallets.length + tokens.length);
console.log(`  当前 ${transfers.length} 条流水，单次全量重写 ${fmt(tFull)}`);
for (const n of [50000, 200000, 1000000]) {
  console.log(`    若流水涨到 ${n.toString().padStart(7)} 条 → 单次全量重写约 ${(perRowWrite * n / 1000).toFixed(1)}s（每 5 分钟一次将不可用）`);
}

// ---------------------------------------------------------------- 5. WAL
line('5. WAL 文件现状');
const walP = DB_FILE + '-wal';
if (fs.existsSync(walP)) {
  const sz = fs.statSync(walP).size;
  console.log(`  WAL 大小：${(sz / 1048576).toFixed(1)}MB（主库 ${(fs.statSync(DB_FILE).size / 1048576).toFixed(1)}MB）`);
  console.log(`  ${sz > 10 * 1048576 ? '⚠ WAL 过大，未及时 checkpoint：读性能下降、磁盘占用翻倍' : '✓ WAL 大小正常'}`);
}

try { db.close(); } catch { /* */ }
for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpW + ext); } catch { /* */ } }
console.log('\n基准测试完成。\n');
