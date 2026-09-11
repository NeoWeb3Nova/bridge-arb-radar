'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WINDOW_MS = 2 * 60 * 60 * 1000;
const QUOTE_LIMIT = 60; // Local conservative budget for unauthenticated public requests
const KEY_QUOTE_LIMIT = 12000; // 100 RPM * 120 min for authenticated LI.FI API keys
function createGovernor({ file, now = Date.now, transport, maxActive = 4, maxQueue = 100, maxWaitMs = 15000, quoteLimit = QUOTE_LIMIT, windowMs = WINDOW_MS, policy } = {}) {
  let saved = {};
  if (file) try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  let paused = saved.paused === true, active = 0, timer;
  let quoteTimes = (saved.quoteTimes || []).filter(t => Number.isFinite(t) && t > now()-windowMs);
  const hosts = new Map(), queue = [], inflight = new Map();
  const counters = { sent:0, joined:0, blocked:0, limited:0 };
  const cooldowns = saved.cooldowns || {};
  function persist() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), {recursive:true});
    fs.writeFileSync(file+'.tmp', JSON.stringify({paused,quoteTimes,cooldowns}));
    fs.renameSync(file+'.tmp',file);
  }
  function hostState(url) {
    const host = new URL(url).hostname;
    if (!hosts.has(host)) {
      const defaults = /geckoterminal|coingecko/.test(host) ? {gap:2100,concurrency:1} :
        host === 'li.quest' ? {gap:1000,concurrency:2} : {gap:500,concurrency:2};
      hosts.set(host,{host,active:0,nextAt:0,sent:0,cooldownUntil:Number(cooldowns[host])||0,...(policy?.(host)||defaults)});
    }
    return hosts.get(host);
  }
  function quoteBudget() {
    quoteTimes = quoteTimes.filter(t => t > now()-windowMs);
    const limit = typeof quoteLimit === 'function' ? quoteLimit() : quoteLimit;
    return {limit,used:quoteTimes.length,remaining:Math.max(0,limit-quoteTimes.length),windowMs,resetAt:quoteTimes.length ? quoteTimes[0]+windowMs : null};
  }
  function failure(code, error, retryAt) {
    counters.blocked++;
    return {ok:false,status:code==='RATE_LIMITED'||code==='LOCAL_QUOTE_BUDGET'?429:0,json:null,text:'',code,error,
      ...(retryAt?{retryAt,retryAfter:String(Math.max(1,Math.ceil((retryAt-now())/1000)))}:{})};
  }
  function isQuote(url) { const u=new URL(url);return u.hostname==='li.quest'&&/\/quote$/.test(u.pathname); }
  function cooldownTime(result) {
    const dates = [];
    const raw = result.retryAfter;
    if (raw != null && String(raw).trim() !== '') {
      const seconds=Number(raw);
      if(Number.isFinite(seconds))dates.push(now()+Math.max(0,seconds)*1000);
      else if(Number.isFinite(Date.parse(raw)))dates.push(Date.parse(raw));
    }
    if(result.rateLimitReset != null && Number.isFinite(Number(result.rateLimitReset)))dates.push(now()+Math.max(0,Number(result.rateLimitReset))*1000);
    const hint=String(result.json?.message||result.error||'').match(/retry in\s+(\d+)\s*(second|minute|hour)/i);
    if(hint)dates.push(now()+Number(hint[1])*({second:1000,minute:60000,hour:3600000}[hint[2].toLowerCase()]));
    return Math.max(now()+1000,...(dates.length?dates:[now()+60000]));
  }
  function blockReason(task) {
    if(paused)return failure('REQUESTS_PAUSED','全部外部请求已暂停；本地数据显示继续更新');
    if(task.host.cooldownUntil>now())return failure('RATE_LIMITED','服务商限流，所有页面和后台任务共同等待恢复',task.host.cooldownUntil);
    const budget=task.quote?quoteBudget():null;
    if(budget?.remaining===0)return failure('LOCAL_QUOTE_BUDGET','本机两小时报价预算已用完',budget.resetAt);
    if(now()-task.createdAt>=maxWaitMs)return failure('REQUEST_QUEUE_TIMEOUT','请求排队超时，请稍后重试');
    return null;
  }
  function pump() {
    clearTimeout(timer);timer=null;
    let nextWake = Infinity;
    for(let i=0;i<queue.length;) {
      const task=queue[i], denied=blockReason(task);
      if(denied){queue.splice(i,1);task.resolve(denied);continue;}
      nextWake=Math.min(nextWake,task.createdAt+maxWaitMs);
      if(active>=maxActive||task.host.active>=task.host.concurrency){i++;continue;}
      if(task.host.nextAt>now()){nextWake=Math.min(nextWake,task.host.nextAt);i++;continue;}
      queue.splice(i,1);
      if(task.quote) {
        quoteTimes.push(now());
        try { persist(); } catch {
          quoteTimes.pop();task.resolve(failure('BUDGET_STORAGE_ERROR','额度记录保存失败，已停止本次报价请求'));continue;
        }
      }
      active++;task.host.active++;task.host.nextAt=now()+task.host.gap;
      counters.sent++;task.host.sent++;
      Promise.resolve().then(()=>transport(task.url,task.opts)).catch(e=>({ok:false,status:0,json:null,text:'',error:e.message})).then(result=>{
        const rpcError=result.json?.error;
        if(result.status===429||rpcError?.code===429||rpcError?.code===-32005||/rate.?limit|too many requests/i.test(rpcError?.message||'')) {
          task.host.cooldownUntil=Math.max(task.host.cooldownUntil,cooldownTime(result));cooldowns[task.host.host]=task.host.cooldownUntil;counters.limited++;
          try { persist(); } catch { /* in-memory cooldown still prevents requests */ }
          result={...result,ok:false,status:429,retryAt:task.host.cooldownUntil,retryAfter:String(Math.ceil((task.host.cooldownUntil-now())/1000))};
        } else if(result.rateLimitRemaining === '0' && result.rateLimitReset != null) {
          task.host.cooldownUntil=cooldownTime(result);cooldowns[task.host.host]=task.host.cooldownUntil;
          try { persist(); } catch {}
        }
        task.resolve(result);
      }).finally(()=>{active--;task.host.active--;pump();});
    }
    if(queue.length&&Number.isFinite(nextWake))timer=setTimeout(pump,Math.max(1,nextWake-now()));
  }
  function request(url, opts={}) {
    const method=(opts.method||'GET').toUpperCase();
    // Only read-only calls are coalesced. Headers/settings are hashed, never exposed in diagnostics.
    const rpc=opts.body && typeof opts.body==='object' && /^(eth_call|eth_getBalance|eth_getCode|eth_getLogs|eth_blockNumber|eth_chainId|eth_getTransactionReceipt)$/.test(opts.body.method);
    const share=method==='GET'||(method==='POST'&&rpc);
    const key=share?crypto.createHash('sha256').update(JSON.stringify([url,method,opts.body,opts.headers,opts.settings,opts.timeout])).digest('hex'):null;
    if(key&&inflight.has(key)){counters.joined++;return inflight.get(key).then(r=>structuredClone(r));}
    const task={url,opts,host:hostState(url),quote:isQuote(url),createdAt:now()};
    const denied=blockReason(task);if(denied)return Promise.resolve(denied);
    if(queue.length>=maxQueue)return Promise.resolve(failure('REQUEST_QUEUE_FULL','外部请求队列已满，请稍后重试'));
    const promise=new Promise(resolve=>{task.resolve=resolve;queue.push(task);});
    if(key)inflight.set(key,promise);
    promise.finally(()=>{if(key)inflight.delete(key);});
    pump();
    return promise.then(r=>structuredClone(r));
  }
  function snapshot() {
    for (const host of Object.keys(cooldowns)) if (cooldowns[host] > now()) hostState('https://' + host);
    const providers=[...hosts.values()].map(h=>({name:h.host==='li.quest'?'LI.FI':/dexscreener/.test(h.host)?'DexScreener':/geckoterminal/.test(h.host)?'GeckoTerminal':/coingecko/.test(h.host)?'CoinGecko':/goplus/.test(h.host)?'GoPlus':'其他数据服务 / RPC',active:h.active,sent:h.sent,intervalMs:h.gap,cooldownUntil:h.cooldownUntil>now()?h.cooldownUntil:null}));
    return {paused,active,queued:queue.length,maxActive,maxQueue,quoteBudget:quoteBudget(),counters:{...counters},providers};
  }
  return {request,snapshot,quoteBudget,isPaused:()=>paused,
    cooldownUntil:host=>Math.max(hosts.get(host)?.cooldownUntil||0,Number(cooldowns[host])||0),
    setPaused(value){const before=paused;paused=value===true;try{persist();}catch(e){paused=before;throw e;}pump();return snapshot();}};
}
module.exports={createGovernor,WINDOW_MS,QUOTE_LIMIT,KEY_QUOTE_LIMIT};
