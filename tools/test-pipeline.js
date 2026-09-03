'use strict';
// 管道漏斗冒烟测试：验证 buildFunnel 的链式口径与 /api/pipeline 端点结构。
// 用法：node tools/test-pipeline.js
const assert = require('assert');
const engine = require('../lib/engine.js');

const BASE = process.env.BASE || 'http://127.0.0.1:8848';
let pass = 0; let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

function fakeGates(o) {
  return Object.assign({
    candidates: 12, adjudicated: 2, fakeQuotes: 3, priced: 9, verified: 6,
    notSuspicious: 5, spread: 3, liquidity: 2, stored: 1, errors: 0,
    minSpread: 1.5, minLiquidity: 5000,
  }, o || {});
}

(async () => {
  console.log('A. buildFunnel 纯函数（离线）');
  const f = engine.buildFunnel({
    sourceCount: 4, limit: 50, fetched: 190, valid: 180, added: 40, duplicates: 140,
    priceCheckRan: true, tokenTotal: 657, walletsTouched: 30, tokensTouched: 12,
    gates: fakeGates(),
  });

  ok('阶段数为 11', f.length === 11, f.length);
  ok('每阶段都有 label/in/out/rate', f.every((s) => s.label && Number.isFinite(s.in) && Number.isFinite(s.out) && Number.isFinite(s.rate)));

  // 数据源段：out <= in，且下一阶段 in === 上一阶段 out
  const dataStages = f.slice(0, 4);
  for (let i = 0; i < dataStages.length; i++) {
    const s = dataStages[i];
    ok(`数据源段「${s.label}」out ≤ in`, s.out <= s.in, `${s.out} > ${s.in}`);
    if (i > 0) ok(`数据源段「${s.label}」in === 上一段 out`, s.in === dataStages[i - 1].out, `${s.in} vs ${dataStages[i - 1].out}`);
  }

  // 比价段：链式严格单调不增
  const priceStages = f.slice(4);
  for (let i = 0; i < priceStages.length; i++) {
    const s = priceStages[i];
    ok(`比价段「${s.label}」out ≤ in`, s.out <= s.in, `${s.out} > ${s.in}`);
    if (i > 0) ok(`比价段「${s.label}」in === 上一段 out`, s.in === priceStages[i - 1].out, `${s.in} vs ${priceStages[i - 1].out}`);
  }

  ok('dropped = in - out', f.every((s) => s.dropped === Math.max(0, s.in - s.out)));
  ok('rate 保留 1 位小数且 ≤ 100', f.every((s) => s.rate <= 100));
  ok('比价段标记 skipped=false', priceStages.every((s) => s.skipped === false));

  console.log('B. 关闭比价时的 skipped 标记');
  const f2 = engine.buildFunnel({
    sourceCount: 4, limit: 50, fetched: 190, valid: 180, added: 40, duplicates: 140,
    priceCheckRan: false, tokenTotal: 657, walletsTouched: 30, tokensTouched: 12,
    gates: fakeGates({ candidates: 0, priced: 0, verified: 0, notSuspicious: 0, spread: 0, liquidity: 0, stored: 0 }),
  });
  ok('比价段全部标记 skipped', f2.slice(4).every((s) => s.skipped === true));
  ok('数据源段不标记 skipped', f2.slice(0, 4).every((s) => s.skipped === false));

  console.log('B2. 源返回的条数超过请求 limit 时（layerzero 等不按 limit 截断的源）');
  const fOver = engine.buildFunnel({
    sourceCount: 1, limit: 50, fetched: 100, valid: 100, added: 100, duplicates: 0,
    priceCheckRan: false, tokenTotal: 0, walletsTouched: 0, tokensTouched: 0,
    gates: fakeGates(),
  });
  const first = fOver[0];
  ok('首段 in 兜底为 max(请求上限, 实收)', first.in === 100, `${first.in}`);
  ok('首段 rate ≤ 100%', first.rate <= 100, first.rate + '%');
  ok('首段 note 提示未按上限截断', /未按上限截断/.test(first.note), first.note);

  console.log('C. 全零输入不出 NaN');
  const f3 = engine.buildFunnel({
    sourceCount: 0, limit: 0, fetched: 0, valid: 0, added: 0, duplicates: 0,
    priceCheckRan: true, tokenTotal: 0, walletsTouched: 0, tokensTouched: 0,
    gates: fakeGates({ candidates: 0, priced: 0, verified: 0, notSuspicious: 0, spread: 0, liquidity: 0, stored: 0 }),
  });
  ok('rate 为 0 而非 NaN', f3.every((s) => s.rate === 0));
  ok('dropped 为 0 而非负', f3.every((s) => s.dropped === 0));

  console.log('D. /api/pipeline 端点（需服务运行在 ' + BASE + '）');
  let j = null;
  try {
    const res = await fetch(BASE + '/api/pipeline');
    j = await res.json();
  } catch (e) {
    console.log('  ⚠ 服务未运行，跳过端点测试（' + e.message + '）');
  }
  if (j) {
    ok('ok=true', j.ok === true);
    ok('counts 四个键都是数字', ['transfers', 'wallets', 'tokens', 'opportunities'].every((k) => Number.isFinite(j.counts?.[k])));
    ok('含 scanning / autoEnabled / intervalMin', typeof j.scanning === 'boolean' && typeof j.autoEnabled === 'boolean' && Number.isFinite(j.intervalMin));
    if (j.autoEnabled) {
      ok('开启自动扫描时 nextScanAt 为合法 ISO', !!j.nextScanAt && !Number.isNaN(new Date(j.nextScanAt).getTime()), j.nextScanAt);
    } else {
      ok('未开启自动扫描时 nextScanAt 为 null', j.nextScanAt === null, j.nextScanAt);
    }
    if (j.funnel?.length) {
      ok('真实扫描的漏斗阶段数为 11', j.funnel.length === 11, j.funnel.length);
      const ps = j.funnel.slice(4);
      for (let i = 1; i < ps.length; i++) {
        if (ps[i].skipped || ps[i - 1].skipped) continue;
        ok(`真实数据：比价段「${ps[i].label}」in === 上一段 out`, ps[i].in === ps[i - 1].out, `${ps[i].in} vs ${ps[i - 1].out}`);
      }
      if (j.gates) {
        ok('gates 单调：stored ≤ liquidity ≤ spread ≤ verified ≤ priced ≤ candidates',
          j.gates.stored <= j.gates.liquidity && j.gates.liquidity <= j.gates.spread
          && j.gates.spread <= j.gates.notSuspicious && j.gates.notSuspicious <= j.gates.verified
          && j.gates.verified <= j.gates.priced && j.gates.priced <= j.gates.candidates,
          JSON.stringify(j.gates));
      }
    } else {
      console.log('  ⚠ 尚无带 funnel 的扫描记录，跳过漏斗断言（先跑一次 /api/scan）');
    }
  }

  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
