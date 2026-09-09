'use strict';
// Offline only: replace net before loading the checker; no settings or database.
const assert = require('node:assert/strict');
const netPath = require.resolve('../lib/net');
let respond;
let calls = 0;
require.cache[netPath] = { id: netPath, filename: netPath, loaded: true, exports: {
  request: async (...args) => { calls++; return respond(...args); },
} };
const checkerPath = require.resolve('../lib/security-checker');
function fresh(response) {
  respond = response;
  delete require.cache[checkerPath];
  return require(checkerPath);
}
const address = '0x1111111111111111111111111111111111111111';
const clean = { buy_tax: '0', sell_tax: '0', is_honeypot: '0', cannot_sell_all: '0', cannot_buy: '0', is_open_source: '1', is_blacklisted: '0', transfer_pausable: '0' };
const response = item => ({ ok: true, json: { code: 1, result: { [address]: item } } });
function unknown(sec) {
  assert.equal(sec.safe, false);
  assert.equal(sec.unknown, true);
  assert.equal(sec.riskLevel, 'unknown');
  assert.equal(sec.buyTax, null);
  assert.equal(sec.sellTax, null);
  assert.notEqual(sec.isOpenSource, true);
  assert.doesNotMatch(sec.riskReason, /0%|通过|未检测到高危|未在链上检测到高危/);
}
(async () => {
  let checker = fresh(() => { throw new Error('offline'); });
  for (const [chain, addr] of [[null, null], ['bsc', ''], ['bsc', '  '], ['sui', address], ['unsupported', address]]) {
    unknown(await checker.checkTokenSecurity(chain, addr));
  }
  assert.equal(calls, 0);
  for (const chain of ['bsc', 'solana']) {
    for (const reply of [() => { throw new Error('offline'); }, () => null, () => ({ ok: false }), () => ({ ok: true, json: { code: 1, result: {} } }), () => response({})]) {
      checker = fresh(reply);
      unknown(await checker.checkTokenSecurity(chain, address));
    }
  }
  checker = fresh(() => response(clean));
  assert.equal((await checker.checkTokenSecurity('bsc', address)).safe, true);
  for (const invalid of [undefined, '', 'bad', '0junk', -1, Infinity, null]) {
    checker = fresh(() => response({ ...clean, buy_tax: invalid }));
    const sec = await checker.checkTokenSecurity('bsc', address);
    assert.equal(sec.safe, false);
    assert.equal(sec.buyTax, null);
    assert.equal(sec.unknown, true);
    assert.doesNotMatch(sec.riskReason, /0%|通过/);
  }
  checker = fresh(() => response({ is_honeypot: '1', sell_tax: '0.9' }));
  const danger = await checker.checkTokenSecurity('bsc', address);
  assert.equal(danger.riskLevel, 'danger');
  assert.equal(danger.isHoneypot, true);
  assert.equal(danger.sellTax, 0.9);
  assert.equal(danger.unknown, true);
  for (const item of [clean, { ...clean, buy_tax: '0.02' }, { is_honeypot: '1' }]) {
    checker = fresh(() => response(item));
    const opp = { buyChain: 'bsc', buyAddress: address, sellChain: 'bsc' };
    const sec = await checker.checkOpportunitySecurity(opp);
    assert.equal(sec.safe, false);
    assert.equal(sec.unknown, true);
    assert.equal(sec.hasRisk, true);
    assert.equal(sec.sellSecurity.riskLevel, 'unknown');
    assert.equal(sec.riskLevel, item.is_honeypot === '1' ? 'danger' : 'unknown');
    if (item.is_honeypot === '1') assert.equal(opp.verdict, 'fake');
    if (item.buy_tax === '0.02') assert.match(sec.riskReason, /含交易税/);
  }
  checker = fresh(() => response({ dex: [{ pair: address, pool_fee: '0.1' }] }));
  const trap = { buyChain: 'bsc', buyAddress: address, buyPairAddress: address };
  const trapSec = await checker.checkOpportunitySecurity(trap);
  assert.equal(trapSec.riskLevel, 'danger');
  assert.equal(trapSec.unknown, true);
  assert.equal(trapSec.isTrapPool, true);
  assert.equal(trap.poolFeeTrap, true);
  assert.equal(trap.buyPoolFee, 0.1);
  for (const item of [{ non_transferable: '1' }, { transfer_fee: { transfer_fee_basis_points: '50' } }, { non_transferable: '0', freezable: { status: '0' }, trusted_token: 1 }]) {
    checker = fresh(() => response(item));
    const sec = await checker.checkTokenSecurity('solana', address);
    assert.equal(sec.safe, false);
    assert.equal(sec.unknown, true);
    assert.equal(sec.buyTax, null);
    assert.equal(sec.isOpenSource, null);
    if (item.non_transferable === '1') assert.equal(sec.riskLevel, 'danger');
    if (item.transfer_fee) assert.match(sec.riskReason, /Transfer Fee/);
  }
  checker = fresh(() => response({ ...clean, buy_tax: '0.02' }));
  const warning = await checker.checkOpportunitySecurity({ buyChain: 'bsc', buyAddress: address, sellChain: 'bsc', sellAddress: address });
  assert.equal(warning.safe, false);
  assert.equal(warning.riskLevel, 'warning');
  assert.equal(warning.unknown, false);
  checker = fresh(() => response(clean));
  const both = await checker.checkOpportunitySecurity({ buyChain: 'bsc', buyAddress: address, sellChain: 'bsc', sellAddress: address });
  assert.equal(both.safe, true);
  assert.equal(both.unknown, false);
  const empty = await checker.checkOpportunitySecurity({});
  assert.equal(empty.riskLevel, 'unknown');
  assert.equal(empty.safe, false);
  // Existing display arithmetic does not throw, but misleadingly renders zero.
  assert.equal(((empty.buySecurity.buyTax || 0) * 100).toFixed(1), '0.0');
  console.log('PASS: offline fail-closed inputs, EVM/Solana failures, partial evidence, aggregation, null-tax arithmetic');
})().catch(error => { console.error(error); process.exitCode = 1; });
