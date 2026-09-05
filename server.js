'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const store = require('./lib/store');
const engine = require('./lib/engine');
const resolver = require('./lib/resolver');
const events = require('./lib/events');
const { createApiRoutes } = require('./lib/routes');

const PORT = Number(process.env.PORT || 8848);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

let scanTimer = null;
let scanning = false;
let nextScanAtMs = 0;

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20MB 上限

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy(new Error('Payload too large'));
        return reject(new Error('请求体超出限制 (最大 20MB)'));
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if ((!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR && file !== path.join(PUBLIC_DIR, 'index.html')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500');
  });
  stream.pipe(res);
}

// ---------------- 调度 ----------------
function scheduleScan() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  const s = store.settings();
  if (!s.scan?.autoEnabled) { nextScanAtMs = 0; return; }
  const mins = Math.max(1, Number(s.scan.intervalMin) || 5);
  nextScanAtMs = Date.now() + mins * 60000;
  scanTimer = setInterval(async () => {
    nextScanAtMs = Date.now() + mins * 60000;
    if (scanning) return;
    scanning = true;
    try { await engine.runScan({}); } catch (e) { console.error('[scan]', e.message); } finally { scanning = false; }
  }, mins * 60000);
  scanTimer.unref?.();
}

// ---------------- 路由装配 ----------------
const api = createApiRoutes({
  isScanning: () => scanning,
  setScanning: (val) => { scanning = Boolean(val); },
  scheduleScan,
  getNextScanAtMs: () => nextScanAtMs,
});

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
    if (pathname === '/api/events') {
      return events.addClient(req, res);
    }
    if (pathname.startsWith('/api/')) {
      const handler = api[pathname];
      if (!handler) return json(res, 404, { ok: false, error: '未知接口 ' + pathname });
      const query = Object.fromEntries(url.searchParams.entries());
      const body = req.method === 'POST' ? await readBody(req) : {};
      const out = await handler({ query, body, req }, req);
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

  try { store.checkpoint('TRUNCATE'); } catch { /* ignore */ }

  const st = store.storageStatus();
  const displayHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log(`\n  Bridge Arb Radar 已启动:  http://${displayHost}:${PORT}\n  数据目录: ${path.join(__dirname, 'data')}`);
  console.log(`  存储后端: SQLite（${st.mainSizeBytes > 0 ? (st.mainSizeBytes / 1048576).toFixed(1) + ' MB' : '空库'}，完整性 ${st.integrity}，备份 ${st.backupCount} 份）`);
  if (st.backupCount === 0) {
    try { const b = store.backupNow(); console.log(`  已生成首份备份：${path.basename(b)}`); } catch (e) { console.error('[backup] 首份备份失败：', e.message); }
  }

  if (store.settings().scan?.autoEnabled) {
    console.log(`  自动扫描：每 ${store.settings().scan.intervalMin} 分钟一次`);
  }
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

function shutdown(sig) {
  console.log(`\n[server] 收到 ${sig}，正在优雅关闭…`);
  try { store.flush(); } catch (e) { console.error('[server] flush 失败：', e.message); }
  try { require('./lib/db').close(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
