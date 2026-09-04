'use strict';
const db = require('../lib/db');
const net = require('../lib/net');
const store = require('../lib/store');
const ArbDetector = require('../lib/arb-detector');
const securityChecker = require('../lib/security-checker');

function extractPairMetrics(p) {
  if (!p) return null;
  const totalLiqUsd = Number(p.liquidity?.usd) || 0;
  const priceUsd = Number(p.priceUsd) || 0;
  const priceNative = Number(p.priceNative) || 0;
  const baseTokens = Number(p.liquidity?.base) || 0;
  const quoteTokens = Number(p.liquidity?.quote) || 0;
  const quotePriceUsd = (priceNative > 0 && priceUsd > 0) ? (priceUsd / priceNative) : 1;
  const baseReserveUsd = Number((baseTokens * priceUsd).toFixed(2));
  const quoteReserveUsd = Number((quoteTokens * quotePriceUsd).toFixed(2));
  const quoteRatio = (baseReserveUsd + quoteReserveUsd > 0)
    ? Number((quoteReserveUsd / (baseReserveUsd + quoteReserveUsd)).toFixed(4))
    : 0.5;
  return {
    liqUsd: totalLiqUsd,
    baseTokens,
    quoteTokens,
    baseReserveUsd,
    quoteReserveUsd,
    quoteRatio,
    quoteSymbol: p.quoteToken?.symbol || null,
    baseSymbol: p.baseToken?.symbol || null,
    vol24h: Number(Number(p.volume?.h24 || 0).toFixed(2)),
    vol6h: Number(Number(p.volume?.h6 || 0).toFixed(2)),
    txns24h: (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0),
  };
}

async function main() {
  const settings = store.settings();
  const d = db.open();
  const rows = d.prepare('SELECT rowid, data FROM opportunities').all();
  console.log(`Found ${rows.length} opportunities to check/enrich...`);

  const updatedOpps = [];

  for (const r of rows) {
    const opp = JSON.parse(r.data);
    console.log(`Enriching ${opp.symbol}: Buy=${opp.buyChain}, Sell=${opp.sellChain}...`);

    let buyMetrics = null;
    let sellMetrics = null;

    // Fetch Buy Chain Liquidity & Volume
    if (opp.buyAddress && opp.buyChain) {
      try {
        const res = await net.request(`https://api.dexscreener.com/latest/dex/tokens/${opp.buyAddress}`, { settings });
        if (res.ok && res.json?.pairs) {
          const p = res.json.pairs.find(x => x.chainId === opp.buyChain && (Number(x.liquidity?.usd) || 0) > 0);
          buyMetrics = extractPairMetrics(p);
        }
      } catch (e) {
        console.error(`  Error fetching buy metrics for ${opp.symbol}:`, e.message);
      }
    }

    // Fetch Sell Chain Liquidity & Volume
    if (opp.sellAddress && opp.sellChain) {
      try {
        const res = await net.request(`https://api.dexscreener.com/latest/dex/tokens/${opp.sellAddress}`, { settings });
        if (res.ok && res.json?.pairs) {
          const p = res.json.pairs.find(x => x.chainId === opp.sellChain && (Number(x.liquidity?.usd) || 0) > 0);
          sellMetrics = extractPairMetrics(p);
        }
      } catch (e) {
        console.error(`  Error fetching sell metrics for ${opp.symbol}:`, e.message);
      }
    }

    if (buyMetrics) {
      opp.buyLiquidityUsd = buyMetrics.liqUsd;
      opp.buyVolume24h = buyMetrics.vol24h;
      opp.buyVolume6h = buyMetrics.vol6h;
      opp.buyTxns24h = buyMetrics.txns24h;
      opp.buyBaseReserveUsd = buyMetrics.baseReserveUsd;
      opp.buyQuoteReserveUsd = buyMetrics.quoteReserveUsd;
      opp.buyQuoteSymbol = buyMetrics.quoteSymbol;
      opp.buyQuoteRatio = buyMetrics.quoteRatio;
    }

    if (sellMetrics) {
      opp.sellLiquidityUsd = sellMetrics.liqUsd;
      opp.sellVolume24h = sellMetrics.vol24h;
      opp.sellVolume6h = sellMetrics.vol6h;
      opp.sellTxns24h = sellMetrics.txns24h;
      opp.sellBaseReserveUsd = sellMetrics.baseReserveUsd;
      opp.sellQuoteReserveUsd = sellMetrics.quoteReserveUsd;
      opp.sellQuoteSymbol = sellMetrics.quoteSymbol;
      opp.sellQuoteRatio = sellMetrics.quoteRatio;
    }

    const buyLiq = opp.buyLiquidityUsd || opp.minLiquidityUsd || 10000;
    const sellLiq = opp.sellLiquidityUsd || opp.minLiquidityUsd || 10000;
    opp.minLiquidityUsd = Number(Math.min(buyLiq, sellLiq).toFixed(2));

    const buyVol24h = opp.buyVolume24h || 0;
    const sellVol24h = opp.sellVolume24h || 0;
    opp.minVolume24h = Number(Math.min(buyVol24h, sellVol24h).toFixed(2));

    const buyVol6h = opp.buyVolume6h || 0;
    const sellVol6h = opp.sellVolume6h || 0;
    opp.minVolume6h = Number(Math.min(buyVol6h, sellVol6h).toFixed(2));

    // 卖出池现金储备枯竭检测
    const sellCashDrain = (opp.sellQuoteReserveUsd !== undefined && opp.sellQuoteReserveUsd < 500) ||
                          (opp.sellQuoteRatio !== undefined && opp.sellQuoteRatio < 0.05);
    opp.poolSkewed = sellCashDrain;
    if (sellCashDrain) {
      opp.suspicious = true;
      if (opp.sellQuoteReserveUsd < 150) {
        opp.verdict = 'fake';
      } else if (opp.verdict === 'confirmed') {
        opp.verdict = 'suspicious';
      }
    }

    // 执行代币合约貔貅与恶意税率体检
    await securityChecker.checkOpportunitySecurity(opp, settings).catch(() => null);

    const scoreRes = ArbDetector.calculateOpportunityScore(opp);
    opp.qualityScore = scoreRes.qualityScore;
    opp.qualityGrade = scoreRes.qualityGrade;
    opp.scoreComment = scoreRes.scoreComment;

    console.log(`  -> ${opp.symbol}: Score=${opp.qualityScore}(${opp.qualityGrade}) | buyLiq=$${opp.buyLiquidityUsd} | sellLiq=$${opp.sellLiquidityUsd} (quoteCash=$${opp.sellQuoteReserveUsd} ${opp.sellQuoteSymbol || ''}) | skewed=${opp.poolSkewed}`);
    updatedOpps.push(opp);
  }

  // Persist updated opportunities to db
  d.exec('BEGIN');
  try {
    d.exec('DELETE FROM opportunities');
    const ins = d.prepare('INSERT INTO opportunities(symbol,buy_chain,sell_chain,spread_pct,suspicious,ts,data) VALUES(?,?,?,?,?,?,?)');
    for (const o of updatedOpps) {
      ins.run(o.symbol ?? null, o.buyChain ?? null, o.sellChain ?? null, o.spreadPct ?? null, o.suspicious ? 1 : 0, o.ts ?? null, JSON.stringify(o));
    }
    d.exec('COMMIT');
    console.log(`Successfully updated ${updatedOpps.length} opportunities in radar.db!`);
  } catch (err) {
    d.exec('ROLLBACK');
    console.error('Failed to commit opportunities:', err);
  }
}

main().catch(console.error);
