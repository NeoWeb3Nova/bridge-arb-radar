'use strict';
// 完整扫描性能测试：输出各阶段耗时与漏斗。
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const store = require('../lib/store');
const engine = require('../lib/engine');

async function main() {
  store.load();
  const settings = store.settings();
  console.log(`数据现状: transfers=${store.raw().transfers.length} wallets=${Object.keys(store.raw().wallets).length} tokens=${Object.keys(store.raw().tokens).length}`);
  console.log(`比价设置: priceLimit=${settings.scan?.priceLimit ?? 12} spread=${settings.scan?.spreadAlertPct ?? 1.5}% liquidity=$${settings.scan?.minLiquidityUsd ?? 5000}`);

  const t0 = Date.now();
  const report = await engine.runScan({ limit: 200, priceLimit: 12 });
  console.log(`\n扫描完成: total=${report.timings.totalMs}ms fetch=${report.timings.fetchMs}ms store=${report.timings.storeMs}ms price=${report.timings.priceMs}ms`);
  console.log(`新增 transfers=${report.added} wallets=${report.walletsNew} tokens=${report.tokensNew} opportunities=${report.opportunitiesNew}`);
  console.log(`gates: candidates=${report.gates.candidates} priced=${report.gates.priced} verified=${report.gates.verified} spread=${report.gates.spread} liquidity=${report.gates.liquidity} stored=${report.gates.stored}`);
  console.log('\n漏斗:');
  for (const s of report.funnel) {
    console.log(`  ${s.label}: ${s.in} → ${s.out} (${s.rate}%) ${s.skipped ? '[skipped]' : ''}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
