'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..');
(async () => {
  try {
    const r = await fetch('http://127.0.0.1:8848/api/lab/state', { signal: AbortSignal.timeout(2000) });
    if (r.ok && (await r.json()).ok) { console.log('Already running: http://127.0.0.1:8848/lab.html'); return; }
    throw new Error('Port 8848 is occupied by another server; stop it before starting this version.');
  } catch (e) { if (e.message.includes('occupied')) throw e; }
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const log = fs.openSync(path.join(root, 'data', 'local-paper-server.log'), 'a');
  const child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root, detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, HOST: '127.0.0.1', PORT: '8848', RADAR_LIFI_DIRECT: '1', RADAR_NO_EXTERNAL_NOTIFICATIONS: '1' },
  });
  child.unref();
  fs.closeSync(log);
  fs.writeFileSync(path.join(root, 'data', 'local-paper-server.pid'), String(child.pid));
  console.log('Started PID ' + child.pid + ': http://127.0.0.1:8848/lab.html');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
