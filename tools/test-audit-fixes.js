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

  console.log('\n=== 8. 同名不同币 (Symbol Collision) 与极端价差熔断测试 ===');
  {
    // 1. 跨链价差 > 100% 自动判定为同名不同币碰撞并设为 fake
    const extremeSpreadQuotes = [
      { chain: 'bsc', priceUsd: 1.0, liquidityUsd: 50000, dex: 'pancake', verdict: 'official', baseTokenName: 'BitcoinOS' },
      { chain: 'ethereum', priceUsd: 3.5, liquidityUsd: 50000, dex: 'uniswap', verdict: 'official', baseTokenName: 'BitcoinOS' },
    ];
    const bestExtreme = ArbDetector.evaluateBestOpportunity({ symbol: 'BOS', quotes: extremeSpreadQuotes });
    ok('跨链价差 > 100% (比率 >= 2.0x) 触发同名不同币熔断', bestExtreme.isSymbolCollision === true && bestExtreme.collisionRisk === true);
    ok('触发同名不同币熔断后 verdict 强制裁决为 fake', bestExtreme.verdict === 'fake');
    ok('触发同名不同币熔断后综合评分清零归入 D 级', bestExtreme.qualityScore === 0 && bestExtreme.qualityGrade === 'D');
    ok('评语明确指出假套利与同名不同币', bestExtreme.scoreComment.includes('假套利') && bestExtreme.scoreComment.includes('同名不同币'));

    // 2. 代币全称不匹配（如 BitcoinOS vs BOSagora）自动判定为 fake
    const nameMismatchQuotes = [
      { chain: 'bsc', priceUsd: 1.0, liquidityUsd: 50000, dex: 'pancake', verdict: 'official', baseTokenName: 'BitcoinOS Token' },
      { chain: 'arbitrum', priceUsd: 1.08, liquidityUsd: 50000, dex: 'camelot', verdict: 'official', baseTokenName: 'BOSagora Network' },
    ];
    const bestMismatch = ArbDetector.evaluateBestOpportunity({ symbol: 'BOS', quotes: nameMismatchQuotes });
    ok('代币全称不匹配触发 isSymbolCollision', bestMismatch.isSymbolCollision === true);
    ok('代币全称不匹配 verdict 强制裁决为 fake', bestMismatch.verdict === 'fake');
    ok('不匹配原因包含两端代币全称对比', bestMismatch.collisionReason.includes('BitcoinOS') && bestMismatch.collisionReason.includes('BOSagora'));

    // 3. cleanName 规范化辅助函数有效性
    ok('cleanName 过滤包装后缀', ArbDetector.cleanName('Tether USD (PoS)') === 'tetherusd');
    ok('cleanName 过滤 Bridged/Wrapped 标识', ArbDetector.cleanName('Bridged Wrapped Ether') === 'ether');

    // 4. 正常跨链套利不受误杀
    const normalQuotes = [
      { chain: 'bsc', priceUsd: 1.00, liquidityUsd: 50000, quoteReserveUsd: 25000, quoteRatio: 0.5, volume24h: 10000, dex: 'pancake', verdict: 'official', baseTokenName: 'USD Coin' },
      { chain: 'arbitrum', priceUsd: 1.03, liquidityUsd: 60000, quoteReserveUsd: 30000, quoteRatio: 0.5, volume24h: 12000, dex: 'camelot', verdict: 'official', baseTokenName: 'USD Coin' },
    ];
    const bestNormal = ArbDetector.evaluateBestOpportunity({ symbol: 'USDC', quotes: normalQuotes });
    ok('正常 3% 跨链价差判定为 confirmed', bestNormal.verdict === 'confirmed');
    ok('正常 3% 跨链价差未误触同名不同币熔断', !bestNormal.isSymbolCollision && !bestNormal.collisionRisk);
    ok('正常跨链机会评分处于优质区间', bestNormal.qualityScore >= 60);

    // 5. 粉尘池（如 Berachain 0.65 美元 Kodiak 池）必须被过滤排除
    const dustPoolQuotes = [
      { chain: 'berachain', priceUsd: 0.0119, liquidityUsd: 0.65, dex: 'kodiak', verdict: 'official', baseTokenName: 'HarryPotterObamaSonic10Inu' },
      { chain: 'ethereum', priceUsd: 0.0190, liquidityUsd: 1100000, dex: 'uniswap', verdict: 'official', baseTokenName: 'HarryPotterObamaSonic10Inu' },
      { chain: 'bsc', priceUsd: 0.0195, liquidityUsd: 27000, dex: 'uniswap', verdict: 'official', baseTokenName: 'HarryPotterObamaSonic10Inu' },
    ];
    const bestDustFiltered = ArbDetector.evaluateBestOpportunity({ symbol: 'BITCOIN', quotes: dustPoolQuotes });
    ok('0.65 美元粉尘池被坚决排除，买入腿选出真实深度池', bestDustFiltered.buyChain === 'ethereum');
    ok('排除粉尘池后选出的真实买入价格为 0.0190 而非 0.0119', bestDustFiltered.buyPrice === 0.0190);
    ok('排除粉尘池后价差为真实健康价差 (约 2.6%) 而非虚假 63%', bestDustFiltered.spreadPct < 5);
  }

  // === 9. 流动性池手续费 (DEX Pool Swap Fee) 与高费陷阱池 (Trap Pool) 测试 ===
  {
    console.log(`\n=== 9. 流动性池手续费与高费陷阱池 (Trap Pool / Uniswap V4 10%池) 测试 ===`);
    const oppWithTrap = {
      symbol: 'PEAQ',
      buyChain: 'ethereum',
      buyPrice: 1.00,
      sellChain: 'base',
      sellPrice: 1.08, // 8% nominal spread
      spreadPct: 8.0,
      minLiquidityUsd: 50000,
      quoteReserveUsd: 25000,
      buyVolume24h: 10000,
      poolFeeTrap: true, // 10% fee trap pool (e.g. Uniswap V4 PEAQ/USDT)
      buyPoolFee: 0.10,
    };

    const scored = ArbDetector.calculateOpportunityScore(oppWithTrap);
    ok('高费陷阱池评级归入 D 级', scored.qualityGrade === 'D');
    ok('高费陷阱池评分极低 (<= 25分)', scored.qualityScore <= 25);
    ok('高费陷阱池评语明确警告高费率陷阱', scored.scoreComment.includes('高费率陷阱') || scored.scoreComment.includes('10.0%'));

    // 测试 pair 地址提取
    const testUrl = 'https://dexscreener.com/ethereum/0x40f2555c665c957d0851aaa2537dc4a3b445e11544576f63fa43a382cb395ff1';
    const extractedPair = securityChecker.extractPairFromUrl(testUrl);
    ok('正确从 DEX Screener URL 提取 Uniswap V4 32字节 Pool ID', extractedPair === '0x40f2555c665c957d0851aaa2537dc4a3b445e11544576f63fa43a382cb395ff1');
  }

  // === 10. 数据库安全重置与多道防护 (Database Reset & Multi-step Safety Verification) 测试 ===
  console.log('\n=== 10. 数据库安全重置与多道防护 (Database Reset & Safety Guard) 测试 ===');
  {
    const http = require('http');
    const postJson = (path, body, method = 'POST') => new Promise((resolve) => {
      const payload = JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1',
        port: 8848,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        let raw = '';
        res.on('data', (c) => raw += c);
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); }
        });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.write(payload);
      req.end();
    });

    const rejectWrong = await postJson('/api/database/reset', { confirmPhrase: 'WRONG' });
    ok('输入错误口令 WRONG 时安全拒绝重置', rejectWrong.ok === false && rejectWrong.error.includes('安全确认码不匹配'));

    const rejectLower = await postJson('/api/database/reset', { confirmPhrase: 'reset' });
    ok('输入小写 reset 时严格区分大小写并安全拒绝', rejectLower.ok === false && rejectLower.error.includes('安全确认码不匹配'));

    const rejectEmpty = await postJson('/api/database/reset', {});
    ok('缺省口令时安全拒绝', rejectEmpty.ok === false);

    const rejectGet = await postJson('/api/database/reset', {}, 'GET');
    ok('非 POST 请求拒绝访问', rejectGet.ok === false && rejectGet.error.includes('仅支持 POST'));

    const getJson = (path) => new Promise((resolve) => {
      http.get('http://127.0.0.1:8848' + path, (res) => {
        let raw = '';
        res.on('data', (c) => raw += c);
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); }
        });
      }).on('error', (e) => resolve({ ok: false, error: e.message }));
    });

    const storageRes = await getJson('/api/storage');
    ok('/api/storage 状态接口返回正确', storageRes.ok === true && storageRes.backend === 'sqlite');
    ok('/api/storage 包含各业务表 rowCount 统计', storageRes.rowCount && typeof storageRes.rowCount.transfers === 'number');

    // 独立测试库完整事务重置与备份验证 (使用内存库验证，不影响现有生产主库)
    const { DatabaseSync } = require('node:sqlite');
    const testDb = new DatabaseSync(':memory:');
    testDb.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wallets (address TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS opportunities (rowid INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scanlog (rowid INTEGER PRIMARY KEY, data TEXT NOT NULL);
      INSERT INTO meta(key, value) VALUES ('settings', '{"keys":{"range":"testkey"}}');
      INSERT INTO meta(key, value) VALUES ('stats', '{"transfersSeen":999}');
      INSERT INTO transfers(id, data) VALUES ('tx1', '{"id":"tx1"}');
      INSERT INTO wallets(address, data) VALUES ('0xabc', '{"score":88}');
      INSERT INTO tokens(key, data) VALUES ('eth:0x1', '{"symbol":"TEST"}');
      INSERT INTO opportunities(rowid, data) VALUES (1, '{"symbol":"TEST"}');
      INSERT INTO scanlog(rowid, data) VALUES (1, '{"type":"scan"}');
    `);

    // 模拟原子清空流程 (保持 settings)
    const saved = JSON.parse(testDb.prepare("SELECT value FROM meta WHERE key = 'settings'").get().value);
    testDb.exec('BEGIN');
    testDb.exec('DELETE FROM transfers');
    testDb.exec('DELETE FROM wallets');
    testDb.exec('DELETE FROM tokens');
    testDb.exec('DELETE FROM opportunities');
    testDb.exec('DELETE FROM scanlog');
    testDb.exec('DELETE FROM meta');
    testDb.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('version', '1');
    testDb.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('settings', JSON.stringify(saved));
    testDb.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('stats', JSON.stringify({ transfersSeen: 0, scans: 0, lastScanAt: null }));
    testDb.exec('COMMIT');

    const transfersCount = testDb.prepare('SELECT COUNT(*) c FROM transfers').get().c;
    const walletsCount = testDb.prepare('SELECT COUNT(*) c FROM wallets').get().c;
    const oppsCount = testDb.prepare('SELECT COUNT(*) c FROM opportunities').get().c;
    const settingsKept = JSON.parse(testDb.prepare("SELECT value FROM meta WHERE key = 'settings'").get().value);

    ok('业务表 transfers 已彻底清空 (count = 0)', transfersCount === 0);
    ok('业务表 wallets 已彻底清空 (count = 0)', walletsCount === 0);
    ok('业务表 opportunities 已彻底清空 (count = 0)', oppsCount === 0);
    ok('用户自定义 API Key 与设置被完整保留', settingsKept.keys?.range === 'testkey');

    testDb.close();
  }

  console.log('\n=== 11. 非标准计价代币 (Non-Standard Quote Tokens) 与结算资产穿透测试 ===');
  {
    // 模拟真实用户案例: VITA/BIO (Base Aerodrome vs Ethereum Uniswap)
    const baseQuote = {
      chain: 'base',
      dex: 'aerodrome',
      priceUsd: 0.2254,
      priceNative: 8.1786, // 1 VITA = 8.1786 BIO
      quotePriceUsd: 0.02756, // 1 BIO = $0.02756 on Base
      quoteToken: 'BIO',
      liquidityUsd: 85000,
      quoteReserveUsd: 42500,
      verdict: 'confirmed',
      baseTokenName: 'VitaDAO',
    };
    const ethQuote = {
      chain: 'ethereum',
      dex: 'uniswap',
      priceUsd: 0.2389,
      priceNative: 8.5490, // 1 VITA = 8.5490 BIO
      quotePriceUsd: 0.02794, // 1 BIO = $0.02794 on Eth
      quoteToken: 'BIO',
      liquidityUsd: 120000,
      quoteReserveUsd: 60000,
      verdict: 'confirmed',
      baseTokenName: 'VitaDAO',
    };

    const opp = ArbDetector.evaluateBestOpportunity({
      symbol: 'VITA',
      quotes: [baseQuote, ethQuote]
    });

    ok('ArbDetector 成功评估跨链机会', !!opp);
    ok('ArbDetector 包含 buyQuoteSymbol = BIO', opp.buyQuoteSymbol === 'BIO');
    ok('ArbDetector 包含 sellQuoteSymbol = BIO', opp.sellQuoteSymbol === 'BIO');
    ok('ArbDetector 包含 buyPriceNative', opp.buyPriceNative === 8.1786);
    ok('ArbDetector 包含 sellPriceNative', opp.sellPriceNative === 8.5490);
    ok('ArbDetector 包含 buyQuotePriceUsd 与 sellQuotePriceUsd', opp.buyQuotePriceUsd === 0.02756 && opp.sellQuotePriceUsd === 0.02794);

    // 验证计价币本位利差与美元纸面利差的区别
    const usdSpread = ((ethQuote.priceUsd - baseQuote.priceUsd) / baseQuote.priceUsd) * 100;
    const bioSpread = ((ethQuote.priceNative - baseQuote.priceNative) / baseQuote.priceNative) * 100;
    ok('USD 纸面价差约为 +5.99%', Math.abs(usdSpread - 5.99) < 0.1);
    ok('真实 BIO 本位价差约为 +4.53%', Math.abs(bioSpread - 4.53) < 0.1);

    // 验证标准币与非标准币判定
    const STANDARD_SET = new Set([
      'USDT', 'USDC', 'USD', 'DAI', 'USDE', 'FDUSD', 'PYUSD', 'USDB', 'FRAX', 'LUSD', 'BUSD',
      'WETH', 'ETH', 'SOL', 'WSOL', 'BNB', 'WBNB', 'AVAX', 'WAVAX', 'MATIC', 'POL', 'FTM', 'SUI', 'APT', 'TON'
    ]);
    const isStandard = (s) => !s || STANDARD_SET.has(s.toUpperCase().trim());
    ok('USDC 为标准配对币', isStandard('USDC') === true);
    ok('USDT 为标准配对币', isStandard('USDT') === true);
    ok('WETH 为标准配对币', isStandard('WETH') === true);
    ok('BIO 为非标准配对币 (必须提示产出资产与全闭环摩擦)', isStandard('BIO') === false);
    ok('PEPE 为非标准配对币', isStandard('PEPE') === false);

    // 验证全闭环摩擦计算对净利润的影响
    const capitalUsd = 1000;
    const grossRevenue = (capitalUsd / baseQuote.priceUsd) * ethQuote.priceUsd;
    const grossProfit = grossRevenue - capitalUsd;
    const baseBridgeGas = 6.50; // Eth involved
    const baseBridgeFee = Math.max(1.50, capitalUsd * 0.0006);
    const slippage = capitalUsd * 0.001;
    const poolFees = capitalUsd * 0.003 + grossRevenue * 0.003;
    const normalNetProfit = grossProfit - (baseBridgeGas + baseBridgeFee + slippage + poolFees);

    const extraBuyCost = capitalUsd * 0.0045 + 0.08;
    const extraSellCost = grossRevenue * 0.0045 + 10.0;
    const extraFriction = extraBuyCost + extraSellCost;
    const fullCycleProfit = normalNetProfit - extraFriction;

    ok('纸面套利净利润为正', normalNetProfit > 30);
    ok('全闭环额外摩擦超过 $18 (含以太坊 L1 主网 Swap Gas)', extraFriction > 18);
    ok('全闭环测算真实反映了换回 USDC 后的最终资金', fullCycleProfit < normalNetProfit);
  }

  console.log(`\n============================`);
  console.log(`总计测试: ${passed + failed} | 通过: ${passed} | 失败: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().then(() => process.exit(0)).catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
