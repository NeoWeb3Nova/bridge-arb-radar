'use strict';
const assert=require('node:assert/strict');
let now=100000;Date.now=()=>now;
const net=require('../lib/net');
let calls=0,reply={ok:false,status:429,retryAfter:'120',json:{message:'rate limited'}};
net.request=async()=>{calls++;return reply};
const provider=require('../lib/lifi-readonly');
const address=provider.SETTLEMENT.base.address;
(async()=>{
let until;
await assert.rejects(provider.token(8453,address,{}),e=>{until=e.retryAt;return e.code==='RATE_LIMITED'&&until===now+120000});
await assert.rejects(provider.token(8453,address,{}),e=>e.code==='RATE_LIMITED');assert.equal(calls,1,'no requests during cooldown');
now=until+1;reply={ok:true,status:200,json:{address,chainId:8453,decimals:6}};
assert.equal((await provider.token(8453,address,{})).decimals,6);assert.equal(calls,2);
reply={ok:false,status:429,json:{message:'Rate limit exceeded, retry in 1 hour'}};
await assert.rejects(provider.token(8453,address,{}),e=>e.retryAt===now+3600000);
assert.equal(calls,3);
console.log('PASS: Retry-After, cooldown suppression, automatic recovery, one-hour message fallback');
})().catch(e=>{console.error(e);process.exitCode=1});
