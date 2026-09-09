'use strict';
const assert=require('node:assert/strict');
const store=require('../lib/store');
const prices=require('../lib/prices');
const security=require('../lib/security-checker');
const quoter=require('../lib/crosschain-quoter');
store.settings=()=>({});prices.quote=async()=>null;
security.checkTokenSecurity=async()=>({riskLevel:'unknown'});
quoter.getLiveQuote=async()=>({ok:false,isLiveQuote:false,source:'unavailable',totalFeeUsd:null});
const routes=require('../lib/routes').createApiRoutes({isScanning:()=>false,setScanning:()=>{},scheduleScan:()=>{},getNextScanAtMs:()=>0});
const ctx={query:{},req:{method:'POST'},body:{buyChain:'base',sellChain:'arbitrum',buyAddress:'0x1',sellAddress:'0x2',snapshotBuyPrice:1,snapshotSellPrice:2,amountUsd:100}};
(async()=>{
let r=await routes['/api/opportunity/live'](ctx);assert.equal(r.live,null);assert.equal(r.simulation,null);assert.equal(r.status,'UNAVAILABLE');assert.equal(r.bridge.ok,false);
prices.quote=async chain=>({priceUsd:chain==='base'?1:1.1,liquidityUsd:100000});
r=await routes['/api/opportunity/live']({...ctx,body:{...ctx.body,snapshotSellPrice:1.1}});
assert.equal(r.status,'UNAVAILABLE');assert.equal(r.simulation.executable,false);assert.equal(r.simulation.evidence,'display_price_model');assert.equal(r.bridge.ok,false);
console.log('PASS: stale snapshots cannot become live prices; incomplete routes cannot become ACTIVE');
})().catch(e=>{console.error(e);process.exitCode=1});
