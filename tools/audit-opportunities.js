'use strict';
// Read-only production DB access; only the separate evidence file is written.
const fs=require('fs'),path=require('path');
const {DatabaseSync}=require('node:sqlite');
const {validateCycle}=require('../lib/cycle-validator');
const {SETTLEMENT}=require('../lib/lifi-readonly');
const root=path.join(__dirname,'..');
const d=new DatabaseSync(path.join(root,'data/radar.db'),{readOnly:true});
const settings=JSON.parse(d.prepare("SELECT value FROM meta WHERE key='settings'").get().value);
if(process.env.RADAR_AUDIT_DIRECT === '1') settings.useProxy=false;
const opportunities=d.prepare('SELECT data FROM opportunities').all().map(r=>JSON.parse(r.data));
const scans=d.prepare("SELECT data FROM scanlog WHERE type='scan' ORDER BY rowid DESC LIMIT 20").all().map(r=>JSON.parse(r.data).report);
const report={createdAt:new Date().toISOString(),budgetUsd:500,counts:{tokens:d.prepare('SELECT count(*) n FROM tokens').get().n,opportunities:opportunities.length},scans:scans.map(s=>({startedAt:s.startedAt,sources:s.sources,gates:s.gates,timings:s.timings})),results:[]};d.close();
const limit=Number(process.argv[2]||opportunities.length),amountUsd=Number(process.argv[3]||100);
const candidates=opportunities.filter(o=>SETTLEMENT[o.buyChain]&&SETTLEMENT[o.sellChain]).sort((a,b)=>Number([a.buyChain,a.sellChain].includes('ethereum'))-Number([b.buyChain,b.sellChain].includes('ethereum'))).slice(0,limit);
(async()=>{for(const o of candidates){const r=await validateCycle({...o,amountUsd},settings);report.results.push(r);fs.writeFileSync(path.join(root,'data/cycle-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({symbol:o.symbol,route:o.buyChain+'>'+o.sellChain,status:r.status,legs:r.legs.length,netUsd:r.result?.netUsd,blockers:r.blockers}));}console.log('Evidence: data/cycle-audit.json');process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
