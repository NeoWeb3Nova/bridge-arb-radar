'use strict';
// 诊断脚本：逐候选打印 checkToken 的完整闸门判定，定位「官方验证过了、离群过滤却全灭」的原因。
// persist=false，不写库，可反复跑。
// 用法：node tools/diag-price-gates.js [候选数]
const store = require('../lib/store');
const engine = require('../lib/engine');

const N = Number(process.argv[2] || 6);

(async () => {
  store.load();
  const settings = store.settings();
  const minSpread = Number(settings.scan?.spreadAlertPct) || 1.5;
  const minLiq = Number(settings.scan?.minLiquidityUsd) || 5000;
  const maxHeur = Number(settings.scan?.maxHeuristicSpreadPct) || 25;
  console.log(`阈值：价差 ≥ ${minSpread}% · 流动性 ≥ $${minLiq} · 未验证启发式上限 ${maxHeur}%`);
  console.log(`候选数：${N}\n`);

  const cands = engine.pickCandidates(N);
  for (const t of cands) {
    const sym = t.symbol || '?';
    let r;
    try {
      r = await engine.checkToken(t, settings, false);
    } catch (e) {
      console.log(`— ${sym}：checkToken 抛错 ${e.message}`);
      continue;
    }
    const b = r.best;
    console.log(`=== ${sym}（${t.chain || '-'}） 官方地址 ${r.resolved?.verifiedCount || 0} 个 / ambiguous=${!!r.resolved?.ambiguous} / 裁决=${r.adjudicated}`);
    for (const q of r.quotes || []) {
      console.log(`    ${String(q.chain).padEnd(10)} px=${String(q.priceUsd).padEnd(14)} liq=${String(Math.round(q.liquidityUsd || 0)).padEnd(10)} verdict=${q.verdict} heuristic=${!!q.heuristic}`);
    }
    if (!b) {
      console.log('    → 无 best（可用报价不足 2 条链）\n');
      continue;
    }
    const gates = [
      ['verified', b.verified === true],
      ['!suspicious', !b.suspicious],
      [`spread>=${minSpread}%`, b.spreadPct >= minSpread],
      [`liq>=$${minLiq}`, b.minLiquidityUsd >= minLiq],
    ];
    console.log(`    best: ${b.buyChainName}(${b.buyPrice}) → ${b.sellChainName}(${b.sellPrice}) = ${b.spreadPct}% · 最小流动性 $${Math.round(b.minLiquidityUsd)} · heuristic=${b.heuristic} verified=${b.verified} suspicious=${b.suspicious}`);
    console.log('    闸门：' + gates.map(([k, v]) => `${k}=${v ? '✓' : '✗'}`).join('  '));
    // 定位 suspicious 的真实来源
    if (b.suspicious) {
      const reason = b.spreadPct > 100
        ? `价差 ${b.spreadPct}% > 100%（硬性可疑线）`
        : `含未验证报价，且价差 ${b.spreadPct}% > 启发式上限 ${maxHeur}%`;
      console.log(`    ⚠ suspicious 来源：${reason}`);
    }
    console.log();
  }
  process.exit(0);
})().catch((e) => { console.error('诊断异常：', e); process.exit(1); });
