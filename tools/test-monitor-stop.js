'use strict';
const assert=require('node:assert/strict');
const {validateCycle}=require('../lib/cycle-validator');
const {SETTLEMENT}=require('../lib/lifi-readonly');
const address=n=>'0x'+String(n).repeat(40);
(async()=>{
 let running=true,requests=0;
 const provider={
  token:async(chainId,a)=>({chainId,address:a,decimals:6,priceUSD:1,symbol:'TEST'}),
  quote:async({from,to,amount})=>{requests++;running=false;return {from,to,fromAmount:amount,toAmount:'100000000',toAmountMin:'100000000',requestedAt:Date.now(),gasUsd:0,externalFeeUsd:0,includedFeeUsd:0,etaSeconds:1};},
 };
 const params={buyChain:'base',sellChain:'arbitrum',buyAddress:address(1),sellAddress:address(2),amountUsd:100};
 const result=await validateCycle(params,{}, {provider,shouldContinue:()=>running});
 assert.equal(requests,1);assert.equal(result.legs.length,1);assert.equal(result.blockers[0].code,'MONITOR_STOPPED');
 requests=0;await validateCycle(params,{}, {provider,shouldContinue:()=>false});assert.equal(requests,0);
 console.log('PASS stopping before validation and during a quote prevents subsequent quote legs');
})().catch(e=>{console.error(e);process.exitCode=1});
