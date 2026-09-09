'use strict';
const assert = require('node:assert/strict');
const { toUnits, fromUnits, addressKey } = require('../lib/amounts');
const { parseQuote, SETTLEMENT } = require('../lib/lifi-readonly');
const { validateCycle } = require('../lib/cycle-validator');
const a = { chainId: 1, address: '0x1111111111111111111111111111111111111111', decimals: 18, symbol: 'T' };
const b = { chainId: 8453, address: '0x2222222222222222222222222222222222222222', decimals: 18, symbol: 'T' };
const params = { buyChain: 'ethereum', sellChain: 'base', buyAddress: a.address, sellAddress: b.address, amountUsd: 100 };
const tokens = [a,b,SETTLEMENT.ethereum,SETTLEMENT.base].map(t=>({...t,priceUSD:'1'}));
let count = 0;
function check(name, fn) { fn(); count++; console.log('PASS '+name); }
function payload(input, output = '100') {
  return {id:'quote',tool:'test',action:{fromChainId:input.from.chainId,toChainId:input.to.chainId,
    fromToken:input.from,toToken:input.to,fromAmount:input.amount},
    estimate:{toAmount:output,toAmountMin:output,gasCosts:[{amountUSD:'0.10'}],
      feeCosts:[{amountUSD:'3',included:true}],executionDuration:5}};
}
function provider(options={}) {
  let i=0;
  const outputs = ['200000000000000000000','190000000000000000000','110000000','108000000'];
  const seen=[];
  return {seen,token:async(chain,address)=>tokens.find(t=>t.chainId===chain&&addressKey(t.address)===addressKey(address)),
    quote:async input=>{
      seen.push(input);
      if(options.failAt===i++) throw Object.assign(new Error('no token route'),{code:'NO_ROUTE'});
      const q=payload(input,options.negative&&i===4?'95000000':outputs[i-1]);
      return parseQuote(q,input,0,0);
    }};
}
(async()=>{
check('base58 case preserved; EVM normalized',()=>{assert.equal(addressKey('AbCDef'), 'AbCDef');assert.equal(addressKey('0xAbCd'),'0xabcd')});
check('6/18 decimal conversion exact',()=>{assert.equal(toUnits('1.123456',6),'1123456');assert.equal(toUnits('0.000000000000000001',18),'1');assert.equal(fromUnits('1234567',6),'1.234567')});
check('invalid and over-precise amounts rejected',()=>{for(const x of ['-1','NaN','1e18','0','0.0000001'])assert.throws(()=>toUnits(x,6));});
const input={from:a,to:b,amount:'123'};
for(const mutation of [
 q=>q.action.toToken={...b,address:a.address},
 q=>q.action.fromAmount='124',
 q=>q.action.toToken={...b,decimals:6},
 q=>q.estimate.toAmountMin='101',
 q=>q.estimate.toAmountMin='0',
 q=>q.estimate.gasCosts=[],
 q=>q.estimate.gasCosts[0].amountUSD=null,
 q=>delete q.estimate.feeCosts[0].included,
 q=>q.estimate.executionDuration=undefined,
]){const q=payload(input);mutation(q);check('reject invalid quote '+(count+1),()=>assert.throws(()=>parseQuote(q,input,0)));}
const external=payload(input);external.estimate.feeCosts.push({amountUSD:'2',included:false});
check('included vs external fees separated',()=>{const q=parseQuote(external,input,0);assert.equal(q.includedFeeUsd,3);assert.equal(q.externalFeeUsd,2)});
let p=provider();let r=await validateCycle(params,{}, {provider:p,now:()=>0});
check('four legs and positive research signal, never executable',()=>{assert.equal(r.legs.length,4);assert.equal(r.status,'POSITIVE_INDICATION');assert.equal(r.executable,false);assert.equal(r.realizedPnlUsd,null);assert.ok(Math.abs(r.result.netUsd-6.6)<1e-8)});
check('minimum amounts chained without rounding',()=>{assert.equal(p.seen[1].amount,'200000000000000000000');assert.equal(p.seen[2].amount,'190000000000000000000');assert.equal(p.seen[3].amount,'110000000')});
r=await validateCycle(params,{}, {provider:provider({negative:true}),now:()=>0});
check('unprofitable roundtrip rejected',()=>assert.equal(r.status,'REJECTED'));
p=provider({failAt:1});r=await validateCycle(params,{}, {provider:p,now:()=>0});
check('bridge failure stops; no stablecoin fallback',()=>{assert.equal(r.status,'BLOCKED');assert.equal(r.legs.length,1);assert.equal(p.seen.length,2);assert.equal(r.blockers[0].stage,'bridge_asset')});
r=await validateCycle({...params,amountUsd:500},{},{provider:provider()});
check('$500 principal rejected to preserve fee reserve',()=>assert.equal(r.blockers[0].code,'BUDGET_LIMIT'));
let calls=0;r=await validateCycle(params,{}, {provider:provider(),now:()=>calls++?70000:0});
check('old quote window rejected',()=>assert.ok(r.blockers.some(b=>b.code==='QUOTE_WINDOW')));
console.log(count+' tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
