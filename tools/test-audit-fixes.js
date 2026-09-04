'use strict';
const path = require('path');
process.chdir(path.join(__dirname, '..'));

const ArbDetector = require('../lib/arb-detector');
const store = require('../lib/store');
const db = require('../lib/db');
const hyperlane = require('../lib/sources/hyperlane');
const securityChecker = require('../lib/security-checker');
const { createApiRoutes } = require('../lib/routes');
const { buildCsv, EXPORT_COLS } = require('../lib/routes/export-utils');

let passed = 0;
let failed = 0;

function ok(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== 1. ArbDetector 跨链对选择回归测试 ===');
  {
    const quotes = [
      { chain: 'bsc', priceUsd: 1.00, liquidityUsd: 10000, dex: 'pancake_low', verdict: 'official' },
      { chain: 'arbitrum', priceUsd: 1.05, liquidityUsd: 15000, dex: 'camelot', verdict: 'official' },
      { chain: 'bsc', priceUsd: 1.10, liquidityUsd: 20000, dex: 'pancake_high', verdict: 'official' },
    ];
    const best = ArbDetector.evaluateBestOpportunity({ symbol: 'TEST', quotes });
    ok('同链极值下能够正确发现跨链机会', !!best);
    ok('买入卖出链不同', best.buyChain !== best.sellChain);
    ok('选出的买入链为 bsc ($1.00)，卖出链为 arbitrum ($1.05) 或 反向', (best.buyChain === 'bsc' && best.sellChain === 'arbitrum') || (best.buyChain === 'arbitrum' && best.sellChain === 'bsc'));
    ok('价差正确计算为正数', best.spreadPct > 0);
  }

  console.log('\n=== 2. Hyperlane 32 字节地址规范化测试 ===');
  {
    const rawMsg = {
      origin_tx_hash: '\\x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      origin_domain_id: 1,
      destination_domain_id: 56,
      sender: '\\x000000000000000000000000a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      recipient: '\\x000000000000000000000000f1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4b5a6f1e2',
    };
    const norm = hyperlane.normalize(rawMsg);
    ok('sender 去除前导 24 个零并保留为 42 位 EVM 地址', norm.sender === '0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
    ok('recipient 去除前导 24 个零并保留为 42 位 EVM 地址', norm.receiver === '0xf1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4b5a6f1e2');
    ok('sender 符合 isEvmAddr 校验正则', /^0x[a-fA-F0-9]{40}$/.test(norm.sender));
  }

  console.log('\n=== 3. Transfer ID 多代币/多转账去重测试 ===');
  {
    store.load();
    const t1 = { source: 'layerzero', txHash: '0xabc' + Date.now(), fromChain: 'eth', toChain: 'bsc', tokenSymbol: 'USDC', tokenAddress: '0x111' };
    const t2 = { source: 'layerzero', txHash: t1.txHash, fromChain: 'eth', toChain: 'bsc', tokenSymbol: 'USDT', tokenAddress: '0x222' };
    const added = store.addTransfers([t1, t2]);
    ok('同一 txHash 下不同代币不会被误判为重复而丢弃', added.length === 2);
  }

  console.log('\n=== 4. CSV 导出与 roundtrips 类型测试 ===');
  {
    const sampleWallet = {
      address: '0x123',
      grade: 'A',
      score: 85,
      bridgeCount: 10,
      capitalCycles: 2,
      roundtrips: 3,
      chains: { eth: 1, bsc: 1 },
      tokens: { USDC: 2 },
      tags: ['manual-tag'],
      autoTags: ['职业套利者', '资金闭环'],
    };
    const csv = buildCsv([sampleWallet], EXPORT_COLS.wallets);
    ok('CSV 包含往返字段且为数字 3 而非 undefined', csv.includes(',3,'));
    ok('CSV 包含手动标签与自动标签', csv.includes('manual-tag') && csv.includes('职业套利者'));
  }

  console.log('\n=== 5. SQL 下推与检索测试 ===');
  {
    const wRes = db.queryWallets({ starred: '1', limit: 10 });
    ok('queryWallets starred 走 SQL 成功执行', typeof wRes.total === 'number' && Array.isArray(wRes.items));

    const tRes = db.queryTransfers({ unknown: '1', limit: 10 });
    ok('queryTransfers unknown 走 SQL 成功执行', typeof tRes.total === 'number' && Array.isArray(tRes.items));
  }

  console.log('\n=== 6. /api/decisions 历史决策保留与全局 PnL 测试 ===');
  {
    const api = createApiRoutes({
      isScanning: () => false,
      setScanning: () => {},
      scheduleScan: () => {},
      getNextScanAtMs: () => 0,
    });

    const initRes = await api['/api/decisions']({ query: { status: 'all' } });
    const initPnl = initRes.realizedPnlUsd || 0;

    // 写入一个不在 opportunities 中的历史决策
    store.upsertDecision({
      symbol: 'HISTORICAL_COIN',
      buyChain: 'ethereum',
      sellChain: 'polygon',
      status: 'closed',
      note: '历史套利单',
    });
    store.appendDecisionLog({
      symbol: 'HISTORICAL_COIN',
      buyChain: 'ethereum',
      sellChain: 'polygon',
      text: '已结算利润',
      status: 'closed',
      pnlDeltaUsd: 250,
    });

    const res = await api['/api/decisions']({ query: { status: 'all' } });
    ok('接口返回成功', res.ok === true);
    const histItem = res.items.find((x) => x.symbol === 'HISTORICAL_COIN');
    ok('历史决策不在 opportunities 中仍能从 /api/decisions 返回', !!histItem);
    ok('历史决策的 status 为 closed', histItem && histItem.status === 'closed');
    ok('全局已实现盈亏正确累加历史单利润 (+250)', res.realizedPnlUsd === initPnl + 250);

    // 清理测试数据
    store.removeDecision(store.decisionKey('HISTORICAL_COIN', 'ethereum', 'polygon'));
  }

  console.log('\n=== 7. 百分制打分模型测试 (钱包打分 & 机会打分) ===');
  {
    const scorer = require('../lib/wallet-scorer');
    const ArbDetector = require('../lib/arb-detector');

    // 1. 钱包打分百分制与评级校验
    const w = {
      address: '0xtest',
      bridgeCount: 35,
      chains: { eth: 1, arb: 1, base: 1 },
      tokens: { A: 1, B: 1, C: 1 },
      maxUsd: 15000,
      lastSeen: new Date().toISOString(),
      flows: [
        { from: 'base', to: 'eth', sym: 'PEPE', ts: new Date(Date.now() - 3600000).toISOString(), usd: 5000 },
        { from: 'eth', to: 'base', sym: 'USDC', ts: new Date().toISOString(), usd: 5400 }
      ]
    };
    scorer.scoreSingleWallet(w, 50);
    ok('钱包评分处于 0~100 范围内', w.score >= 0 && w.score <= 100);
    ok('钱包评级为 S/A/B/C/D 之一', ['S', 'A', 'B', 'C', 'D'].includes(w.grade));
    ok('钱包评分包含 5 维度细分 breakdown', !!w.scoreBreakdown && typeof w.scoreBreakdown.cycle === 'number');

    // 2. 套利机会综合评分校验
    const goodOpp = {
      spreadPct: 8.5,
      minLiquidityUsd: 65000,
      sellQuoteReserveUsd: 32000,
      buyChain: 'base',
      sellChain: 'arbitrum',
      minVolume24h: 25000,
      verdict: 'confirmed',
      poolSkewed: false,
    };
    const goodScore = ArbDetector.calculateOpportunityScore(goodOpp);
    ok('优质机会评分 >= 70 (A 或 S 级)', goodScore.qualityScore >= 70 && (goodScore.qualityGrade === 'A' || goodScore.qualityGrade === 'S'));

    // 3. 卖出池现金枯竭机会应受严惩
    const drainedOpp = {
      spreadPct: 55.0,
      minLiquidityUsd: 100000,
      sellQuoteReserveUsd: 88, // 仅 $88 现金
      poolSkewed: true,
      buyChain: 'bsc',
      sellChain: 'ethereum',
      verdict: 'suspicious',
    };
    const drainedScore = ArbDetector.calculateOpportunityScore(drainedOpp);
    ok('枯竭池机会综合评分受到严惩归入 D 级 (<= 25分)', drainedScore.qualityScore <= 25 && drainedScore.qualityGrade === 'D');
  }

  console.log('\n=== 7. GoPlus 智能合约貔貅与恶意税率检测测试 ===');
  {
    // 1. 空参数容错
    const emptySec = await securityChecker.checkTokenSecurity(null, null);
    ok('空链或空地址安全检查优雅兜底通过', emptySec.safe === true && !emptySec.isHoneypot);

    // 2. EVM 链真实可信代币体检 (BSC USDT)
    const bscUsdt = await securityChecker.checkTokenSecurity('bsc', '0x55d398326f99059fF775485246999027B3197955');
    ok('BSC USDT 代码体检判定为 safe', bscUsdt.safe === true);
    ok('BSC USDT 貔貅标记为 false', bscUsdt.isHoneypot === false);
    ok('BSC USDT 买卖税率均为 0%', bscUsdt.buyTax === 0 && bscUsdt.sellTax === 0);

    // 3. Solana SVM 真实可信代币体检 (Solana USDC)
    const solUsdc = await securityChecker.checkTokenSecurity('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    ok('Solana USDC 代码体检判定为 safe', solUsdc.safe === true);
    ok('Solana USDC 貔貅标记为 false', solUsdc.isHoneypot === false);

    // 4. 套利机会貔貅联动阻断测试
    const honeypotOpp = {
      symbol: 'FAKE_HONEY',
      buyChain: 'bsc',
      buyAddress: '0x1111111111111111111111111111111111111111',
      sellChain: 'ethereum',
      sellAddress: '0x2222222222222222222222222222222222222222',
      spreadPct: 45.0,
      minLiquidityUsd: 50000,
      sellQuoteReserveUsd: 25000,
      verdict: 'confirmed',
      suspicious: false,
      security: {
        safe: false,
        hasRisk: true,
        isHoneypot: true,
        riskLevel: 'danger',
        riskReason: '智能合约貔貅 (不可卖出)',
      }
    };
    const hpScore = ArbDetector.calculateOpportunityScore(honeypotOpp);
    ok('貔貅套利机会评分受到严厉扣分 (归入 D 级)', hpScore.qualityScore <= 25 && hpScore.qualityGrade === 'D');
    ok('貔貅套利机会评语包含高危貔貅警告', hpScore.scoreComment.includes('貔貅'));

    // 5. 恶意税率判定逻辑测试 (>= 30% 判貔貅)
    const highTaxOpp = {
      spreadPct: 15.0,
      minLiquidityUsd: 50000,
      sellQuoteReserveUsd: 25000,
      buyChain: 'arbitrum',
      sellChain: 'base',
      security: {
        safe: false,
        hasRisk: true,
        isHoneypot: true,
        riskLevel: 'danger',
        riskReason: '恶意卖出税率 (35%)',
      }
    };
    const highTaxScore = ArbDetector.calculateOpportunityScore(highTaxOpp);
    ok('高恶税机会自动定性为危险扣分并归入 D 级', highTaxScore.qualityScore <= 35 && highTaxScore.qualityGrade === 'D' && highTaxScore.scoreComment.includes('高危'));

    // 6. API 路由 /api/security/check 连通性测试
    const api = createApiRoutes({ isScanning: () => false, setScanning: () => {}, scheduleScan: () => {}, getNextScanAtMs: () => null });
    const missingRes = await api['/api/security/check']({ query: {} });
    ok('API 缺省参数返回错误提示', missingRes.ok === false);

    const apiSecRes = await api['/api/security/check']({ query: { chain: 'bsc', address: '0x55d398326f99059fF775485246999027B3197955' } });
    ok('API 正常查询代币安全返回 ok: true', apiSecRes.ok === true && apiSecRes.result.safe === true);
  }

  console.log(`\n============================`);
  console.log(`总计测试: ${passed + failed} | 通过: ${passed} | 失败: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().then(() => process.exit(0)).catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
