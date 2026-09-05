'use strict';
const db = require('../lib/db');
const store = require('../lib/store');
const securityChecker = require('../lib/security-checker');
const ArbDetector = require('../lib/arb-detector');

async function main() {
  const settings = store.settings();
  const d = db.open();
  const rows = d.prepare('SELECT rowid, data FROM opportunities').all();
  console.log(`Found ${rows.length} stored opportunities in radar.db...`);

  const updatedOpps = [];
  for (const r of rows) {
    const opp = JSON.parse(r.data);
    console.log(`Inspecting ${opp.symbol}: ${opp.buyChain} -> ${opp.sellChain}...`);
    try {
      await securityChecker.checkOpportunitySecurity(opp, settings);
      const sc = ArbDetector.calculateOpportunityScore(opp);
      opp.qualityScore = sc.qualityScore;
      opp.qualityGrade = sc.qualityGrade;
      opp.scoreComment = sc.scoreComment;
      console.log(`  => buyPoolFee: ${opp.buyPoolFee}, sellPoolFee: ${opp.sellPoolFee}, isTrap: ${opp.poolFeeTrap}, score: ${opp.qualityScore}(${opp.qualityGrade})`);
    } catch (e) {
      console.warn(`  Warning on ${opp.symbol}:`, e.message);
    }
    updatedOpps.push(opp);
  }

  d.exec('BEGIN');
  try {
    d.exec('DELETE FROM opportunities');
    const ins = d.prepare('INSERT INTO opportunities(symbol,buy_chain,sell_chain,spread_pct,suspicious,ts,data) VALUES(?,?,?,?,?,?,?)');
    for (const o of updatedOpps) {
      ins.run(
        o.symbol ?? null,
        o.buyChain ?? null,
        o.sellChain ?? null,
        o.spreadPct ?? null,
        o.suspicious ? 1 : 0,
        o.ts ?? null,
        JSON.stringify(o)
      );
    }
    d.exec('COMMIT');
    console.log(`\nSuccessfully updated all ${updatedOpps.length} opportunities in radar.db!`);
  } catch (err) {
    d.exec('ROLLBACK');
    console.error('Failed to commit opportunities:', err);
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
