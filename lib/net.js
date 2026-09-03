'use strict';
// 代理感知的 HTTP 客户端。
// Node 内置 fetch 不会读 HTTP_PROXY/HTTPS_PROXY，而本机访问 DexScreener / Etherscan 等
// 境外接口必须走 http://127.0.0.1:10808，因此这里自己实现 CONNECT 隧道，无第三方依赖。
const http = require('http');
const https = require('https');
const tls = require('tls');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function proxyFor(target, settings) {
  if (!settings || settings.useProxy === false) return null;
  const raw = (settings.proxyUrl || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '').trim();
  if (!raw) return null;
  try {
    const p = new URL(raw);
    if (target.hostname === '127.0.0.1' || target.hostname === 'localhost') return null;
    return { host: p.hostname, port: Number(p.port || 80), auth: p.username ? `${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}` : null };
  } catch {
    return null;
  }
}

function connectTunnel(proxy, target, timeout) {
  return new Promise((resolve, reject) => {
    const headers = { Host: `${target.hostname}:${target.port || 443}`, 'Proxy-Connection': 'keep-alive' };
    if (proxy.auth) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(proxy.auth).toString('base64');
    const req = http.request({ host: proxy.host, port: proxy.port, method: 'CONNECT', path: headers.Host, headers, timeout });
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error('proxy CONNECT ' + res.statusCode));
        return;
      }
      resolve(socket);
    });
    req.once('timeout', () => { req.destroy(new Error('proxy connect timeout')); });
    req.once('error', reject);
    req.end();
  });
}

/**
 * 发起请求，返回 { ok, status, json, text }。永不抛异常，失败时 ok=false 并带 error 字段。
 */
async function request(url, opts = {}) {
  const settings = opts.settings || {};
  const timeout = opts.timeout || 20000;
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const method = (opts.method || 'GET').toUpperCase();
  const headers = Object.assign({ 'User-Agent': UA, Accept: 'application/json, text/plain, */*' }, opts.headers || {});
  let body = opts.body;
  if (body && typeof body !== 'string') {
    body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  if (body) headers['Content-Length'] = Buffer.byteLength(body);

  try {
    const proxy = proxyFor(target, settings);
    let payload;
    if (proxy && isHttps) {
      const tunnel = await connectTunnel(proxy, { hostname: target.hostname, port: target.port || 443 }, timeout);
      const tlsSock = tls.connect({ socket: tunnel, servername: target.hostname, rejectUnauthorized: settings.rejectUnauthorized !== false });
      await new Promise((res, rej) => { tlsSock.once('secureConnect', res); tlsSock.once('error', rej); setTimeout(() => rej(new Error('tls timeout')), timeout).unref?.(); });
      payload = await send(http, { createConnection: () => tlsSock, host: target.hostname, port: 443, path: target.pathname + target.search, method, headers, timeout }, body);
    } else if (proxy && !isHttps) {
      // 明文经代理：直接把完整 URL 交给代理服务器
      payload = await send(http, { host: proxy.host, port: proxy.port, path: url, method, headers: Object.assign({ Host: target.host }, headers), timeout }, body);
    } else {
      payload = await send(isHttps ? https : http, { host: target.hostname, port: target.port || (isHttps ? 443 : 80), path: target.pathname + target.search, method, headers, timeout }, body);
    }
    let json = null;
    try { json = JSON.parse(payload.text); } catch { json = null; }
    return { ok: payload.status >= 200 && payload.status < 300, status: payload.status, text: payload.text, json };
  } catch (err) {
    return { ok: false, status: 0, text: '', json: null, error: err.message };
  }
}

function send(mod, options, body) {
  return new Promise((resolve, reject) => {
    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('timeout', () => req.destroy(new Error('request timeout')));
    req.once('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getJSON(url, opts = {}) {
  const r = await request(url, opts);
  if (!r.ok) throw Object.assign(new Error(r.error || ('HTTP ' + r.status)), { status: r.status, text: r.text });
  if (r.json === null) throw new Error('响应不是 JSON：' + r.text.slice(0, 120));
  return r.json;
}

module.exports = { request, getJSON, UA };
