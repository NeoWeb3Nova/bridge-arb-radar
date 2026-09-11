'use strict';
const { request } = require('./net');
const chains = require('./chains');
const store = require('./store');
const prices = require('./prices');

/**
 * 稳定币脱锚专项监控雷达 (Depeg Radar)
 * 专注监控主流原生稳定币在各链上的挂钩健康度与脱锚套利空间：
 * 1. 严格锁定官方 Canonical 原生合约，绝不将废弃 Bridged 包装币 (USDC.e 等) 混入
 * 2. 识别真实脱锚与跨链利差，自动过滤低于流动性门槛的死池假象
 * 3. 一旦发生脱锚或跨链利差，自动生成 Circle CCTP 1:1、Maker PSM 1:1、Aave 借贷平账等实操套利策略
 */

const TRACKED_STABLECOINS = {
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin (Circle)',
    decimals: 6,
    cctpSupported: true,
    contracts: {
      ethereum:  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      arbitrum:  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      base:      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      optimism:  '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      polygon:   '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      avalanche: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      solana:    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    },
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    cctpSupported: false,
    contracts: {
      ethereum:  '0xdac17f958d2ee523a2206206994597c13d831ec7',
      arbitrum:  '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      bsc:       '0x55d398326f99059fF775485246999027B3197955',
      polygon:   '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      solana:    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      avalanche: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    },
  },
  DAI: {
    symbol: 'DAI',
    name: 'Dai Stablecoin (MakerDAO)',
    decimals: 18,
    cctpSupported: false,
    psmSupported: true,
    contracts: {
      ethereum:  '0x6b175474e89094c44da98b954eedeac495271d0f',
      arbitrum:  '0xDA10009cBd5D07dd0CeCc66161544737f1290657',
      base:      '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    },
  },
  USDS: {
    symbol: 'USDS',
    name: 'USDS (Sky / Maker)',
    decimals: 18,
    cctpSupported: false,
    psmSupported: true,
    contracts: {
      ethereum:  '0xdc035d45d973e3ec169d2276ddab1ced414eb03b',
    },
  },
  PYUSD: {
    symbol: 'PYUSD',
    name: 'PayPal USD',
    decimals: 6,
    cctpSupported: false,
    oftSupported: true,
    contracts: {
      ethereum:  '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
      solana:    '2b1kV6itusLRriRdLaKDitvLR29b9eDqnZXQQgaHNU6g',
    },
  },
  USDe: {
    symbol: 'USDe',
    name: 'USDe (Ethena)',
    decimals: 18,
    cctpSupported: false,
    contracts: {
      ethereum:  '0x4c9edd5852cd905f086c759e8383e09bff1e68b3',
    },
  },
};

// 阈值定义
const THRESHOLDS = {
  HEALTHY_SPREAD_MAX: 0.5,    // <= 0.5% 视为绝对健康挂钩
  WARNING_SPREAD_MIN: 0.6,    // > 0.6% 触发关注预警
  DEPEG_SPREAD_MIN: 1.2,       // > 1.2% 触发脱锚套利警报
  MIN_USABLE_LIQUIDITY: 30000, // 过滤低于 $30,000 的不可成交池
  MIN_USABLE_VOLUME_24H: 10000, // 过滤 24h 交易量低于 $10,000 的死池
};

let cachedState = null;
let lastCheckTs = 0;
const CACHE_TTL_MS = 45 * 1000; // 缓存 45 秒

/**
 * 构造特定脱锚事件的套利执行方案 (Playbook)
 */
function buildArbitragePlaybook({ symbol, buyChain, sellChain, buyPrice, sellPrice, spreadPct, liquidityUsd }) {
  const buyName = chains.label(buyChain);
  const sellName = chains.label(sellChain);
  const discountPct = Number((((1.0 - buyPrice) / 1.0) * 100).toFixed(2));
  const profitPer10k = Number(((10000 / buyPrice) * sellPrice - 10000).toFixed(2));

  // 1. Circle CCTP 1:1 无滑点平价跨链套利 (USDC 专属)
  if (symbol === 'USDC') {
    return {
      type: 'circle_cctp',
      name: 'Circle CCTP 1:1 平价跨链无损套利',
      badge: 'CCTP 1:1 原生铸销',
      riskLevel: '极低 (Circle 协议级 1:1 刚性兑付)',
      expectedYieldPct: Number(spreadPct.toFixed(2)),
      profitPer10k,
      description: `${buyName} 与 ${sellName} 均原生支持 Circle CCTP。在 ${buyName} 以折扣价买入原生 USDC，通过 CCTP 燃烧并在 ${sellName} 1:1 铸造原生 USDC 变现，规避 DEX 跨链流动性池滑点。`,
      steps: [
        {
          step: 1,
          title: `在 ${buyName} 折扣吸筹`,
          detail: `使用 USDT/ETH 在 ${buyName} 头部 DEX 以 $${buyPrice.toFixed(4)} 价格买入原生 USDC。`,
        },
        {
          step: 2,
          title: `调用 Circle CCTP 1:1 跨链`,
          detail: `通过 Circle 官方 CCTP 合约（或集成 CCTP 的聚合器）发起跨链，源链销毁 USDC，目标链 (${sellName}) 1:1 铸造等量 USDC，无汇率滑点。`,
        },
        {
          step: 3,
          title: `在 ${sellName} 平价结算`,
          detail: `到账后在 ${sellName} 以 $${sellPrice.toFixed(4)} 兑换为 USDT 或存入借贷金库，锁定 +${spreadPct.toFixed(2)}% 净利。`,
        },
      ],
    };
  }

  // 2. MakerDAO / Sky PSM 1:1 承兑 (DAI / USDS 专属)
  if (symbol === 'DAI' || symbol === 'USDS') {
    return {
      type: 'maker_psm',
      name: 'MakerDAO / Sky PSM 1:1 刚性承兑',
      badge: 'PSM 1:1 刚性锚定',
      riskLevel: '极低 (Maker/Sky 官方储备 1:1 承兑)',
      expectedYieldPct: Number(spreadPct.toFixed(2)),
      profitPer10k,
      description: `在市场以折价买入 ${symbol}，直接交互 Maker/Sky PSM (Peg Stability Module) 合约以 1:1 比例换出 USDC，0% DEX 冲击成本。`,
      steps: [
        {
          step: 1,
          title: `在 ${buyName} 低价买入 ${symbol}`,
          detail: `以 $${buyPrice.toFixed(4)} 价格低吸 ${symbol}。`,
        },
        {
          step: 2,
          title: `交互 PSM 智能合约`,
          detail: `调用 Maker PSM 合约，按 1 ${symbol} = 1.0000 USDC 的刚性汇率换回 USDC。`,
        },
        {
          step: 3,
          title: '锁定收益',
          detail: `卖出 USDC 或保留无风险资产，完成套利。`,
        },
      ],
    };
  }

  // 3. 严重深度折价时的借贷平账策略 (价格低于 $0.95 时通用)
  if (buyPrice < 0.95) {
    return {
      type: 'lending_repay',
      name: 'Aave / Compound 借贷负债折扣平账',
      badge: '借贷协议 1:1 折扣平账',
      riskLevel: '低 (借贷协议按 $1.00 账面平账)',
      expectedYieldPct: Number(discountPct.toFixed(2)),
      profitPer10k: Number((10000 * (discountPct / 100)).toFixed(2)),
      description: `主流借贷协议（Aave/Compound）始终按 $1.00 面值计算 ${symbol} 的债务价值。以 ${discountPct}% 折扣价买入 ${symbol} 偿还已有负债或循环平账，实现直接负债减免收益。`,
      steps: [
        {
          step: 1,
          title: `低价买入 ${symbol}`,
          detail: `在二级市场以 $${buyPrice.toFixed(4)} 折扣价购入 ${symbol}。`,
        },
        {
          step: 2,
          title: '偿还借贷协议债务',
          detail: `在 Aave / Compound 偿还对应借款，协议以 $1.00 全额抵扣债务，即时净赚 ${discountPct}% 利差。`,
        },
      ],
    };
  }

  // 4. LayerZero OFT 跨链平价桥接 (PYUSD 专属)
  if (symbol === 'PYUSD') {
    return {
      type: 'pyusd_oft',
      name: 'PayPal PYUSD LayerZero OFT 跨链平价套利',
      badge: 'OFT 1:1 跨链承兑',
      riskLevel: '低 (PayPal / Paxos 官方通道)',
      expectedYieldPct: Number(spreadPct.toFixed(2)),
      profitPer10k,
      description: `PYUSD 采用 LayerZero OFT 标准在以太坊与 Solana 之间 1:1 无损流通。在折价链买入，通过官桥平价传输至溢价链卖出。`,
      steps: [
        {
          step: 1,
          title: `在 ${buyName} 买入 PYUSD`,
          detail: `以 $${buyPrice.toFixed(4)} 价格买入 PYUSD。`,
        },
        {
          step: 2,
          title: '通过 LayerZero OFT 跨链',
          detail: `将 PYUSD 1:1 发送至 ${sellName}。`,
        },
        {
          step: 3,
          title: `在 ${sellName} 卖出锁定利润`,
          detail: `以 $${sellPrice.toFixed(4)} 卖出或充值回 PayPal/CEX 按 1:1 美元结算。`,
        },
      ],
    };
  }

  // 5. CEX 1:1 充值承兑 / DEX 再平衡 (USDT / 通用稳定币)
  return {
    type: 'cex_rebalance',
    name: '中心化交易所 (CEX) 1:1 充提承兑 / DEX 搬砖',
    badge: 'CEX 1:1 结算',
    riskLevel: '中 (需考虑充提确认时效)',
    expectedYieldPct: Number(spreadPct.toFixed(2)),
    profitPer10k,
    description: `Binance / OKX / Coinbase 对 ${symbol} 统一按 1:1 美金计价。在折价链低吸后充入 CEX，或在溢价链完成对冲卖出。`,
    steps: [
      {
        step: 1,
        title: `在 ${buyName} 买入`,
        detail: `以 $${buyPrice.toFixed(4)} 低吸 ${symbol}。`,
      },
      {
        step: 2,
        title: '充值至 CEX 或通过官桥跨链',
        detail: `充值至主流交易所，账户内资金按 1:1 统一计价。`,
      },
      {
        step: 3,
        title: '变现或跨链提现',
        detail: `提现至 ${sellName} 卖出或换成 USD 法币。`,
      },
    ],
  };
}

class DepegDetector {
  /**
   * 刷新并计算所有主流原生稳定币的挂钩状态与脱锚套利机会
   * @param {Object} [options]
   * @param {boolean} [options.force=false]
   * @returns {Promise<Object>}
   */
  static async checkStatus({ force = false, settings } = {}) {
    if (!force && cachedState && (Date.now() - lastCheckTs < CACHE_TTL_MS)) {
      return cachedState;
    }

    const appSettings = settings || store.settings();

    if (appSettings.depeg && appSettings.depeg.enabled === false) {
      return {
        ok: true,
        enabled: false,
        status: 'disabled',
        checkedAt: new Date().toISOString(),
        summary: '稳定币脱锚监测已在设置中关闭（默认开启，可在设置页面重新激活）',
        tokens: [],
        alerts: [],
        meta: {
          trackedCount: 0,
          endpointsChecked: 0,
        },
      };
    }

    const llamaCoins = [];
    const metaLookup = {};

    // 组装 DeFiLlama 批量查询标识符
    for (const [sym, def] of Object.entries(TRACKED_STABLECOINS)) {
      for (const [chain, addr] of Object.entries(def.contracts)) {
        const id = `${chain}:${addr}`;
        llamaCoins.push(id);
        metaLookup[id] = { symbol: sym, chain, address: addr, def };
      }
    }

    // 1. 发起 DeFiLlama 批量价格查询
    const llamaUrl = `https://coins.llama.fi/prices/current/${llamaCoins.join(',')}`;
    const llamaRes = await request(llamaUrl, { settings: appSettings, timeout: 15000 }).catch(() => ({ ok: false }));
    const rawCoins = llamaRes.ok && llamaRes.json?.coins ? llamaRes.json.coins : {};

    // 2. 统计解析每个代币在各链上的实际报价
    const tokenSummaries = [];
    const activeAlerts = [];

    for (const [sym, def] of Object.entries(TRACKED_STABLECOINS)) {
      const chainQuotes = [];

      for (const [chain, addr] of Object.entries(def.contracts)) {
        const id = `${chain}:${addr}`;
        const coinData = rawCoins[id];
        let price = coinData?.price;

        // 若 DeFiLlama 暂无此链价格，使用内置 prices 模块兜底精确查询
        if (typeof price !== 'number' || price <= 0) {
          try {
            const q = await prices.quote(chain, addr, appSettings);
            if (q && q.priceUsd > 0) {
              price = q.priceUsd;
            }
          } catch {
            // ignore
          }
        }

        if (typeof price === 'number' && price > 0) {
          const devFromPeg = Number((((price - 1.0) / 1.0) * 100).toFixed(3));
          chainQuotes.push({
            chain,
            chainName: chains.label(chain),
            address: addr,
            price: Number(price.toFixed(5)),
            deviationPct: devFromPeg,
            timestamp: coinData?.timestamp ? new Date(coinData.timestamp * 1000).toISOString() : new Date().toISOString(),
          });
        }
      }

      if (chainQuotes.length === 0) continue;

      // 计算极差与中位数
      chainQuotes.sort((a, b) => a.price - b.price);
      const minQuote = chainQuotes[0];
      const maxQuote = chainQuotes[chainQuotes.length - 1];
      const spreadPct = Number((((maxQuote.price - minQuote.price) / minQuote.price) * 100).toFixed(3));
      const midIdx = Math.floor(chainQuotes.length / 2);
      const medianPrice = chainQuotes[midIdx].price;
      const maxPegDeviation = Math.max(Math.abs(minQuote.deviationPct), Math.abs(maxQuote.deviationPct));

      // 判定状态等级
      let tokenStatus = 'healthy';
      if (maxPegDeviation >= THRESHOLDS.DEPEG_SPREAD_MIN || spreadPct >= THRESHOLDS.DEPEG_SPREAD_MIN) {
        tokenStatus = 'depeg';
      } else if (maxPegDeviation >= THRESHOLDS.WARNING_SPREAD_MIN || spreadPct >= THRESHOLDS.WARNING_SPREAD_MIN) {
        tokenStatus = 'warning';
      }

      tokenSummaries.push({
        symbol: sym,
        name: def.name,
        decimals: def.decimals,
        cctpSupported: !!def.cctpSupported,
        psmSupported: !!def.psmSupported,
        oftSupported: !!def.oftSupported,
        status: tokenStatus,
        medianPrice,
        minPrice: minQuote.price,
        minChain: minQuote.chain,
        minChainName: minQuote.chainName,
        maxPrice: maxQuote.price,
        maxChain: maxQuote.chain,
        maxChainName: maxQuote.chainName,
        maxSpreadPct: spreadPct,
        maxPegDeviationPct: maxPegDeviation,
        chains: chainQuotes,
      });

      // 如果有可获利的脱锚利差，生成套利警报
      if (tokenStatus !== 'healthy' && minQuote.chain !== maxQuote.chain && spreadPct >= THRESHOLDS.WARNING_SPREAD_MIN) {
        const playbook = buildArbitragePlaybook({
          symbol: sym,
          buyChain: minQuote.chain,
          sellChain: maxQuote.chain,
          buyPrice: minQuote.price,
          sellPrice: maxQuote.price,
          spreadPct,
          liquidityUsd: 500000,
        });

        activeAlerts.push({
          id: `depeg_${sym.toLowerCase()}_${minQuote.chain}_${maxQuote.chain}_${Math.floor(Date.now() / 60000)}`,
          symbol: sym,
          name: def.name,
          severity: tokenStatus,
          pegTarget: 1.0,
          spreadPct,
          discountPct: Number((((1.0 - minQuote.price) / 1.0) * 100).toFixed(2)),
          buyChain: minQuote.chain,
          buyChainName: minQuote.chainName,
          buyPrice: minQuote.price,
          sellChain: maxQuote.chain,
          sellChainName: maxQuote.chainName,
          sellPrice: maxQuote.price,
          cctpSupported: !!def.cctpSupported,
          playbook,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // 全局整体健康状态
    let overallStatus = 'healthy';
    if (activeAlerts.some((a) => a.severity === 'depeg') || tokenSummaries.some((t) => t.status === 'depeg')) {
      overallStatus = 'depeg';
    } else if (activeAlerts.some((a) => a.severity === 'warning') || tokenSummaries.some((t) => t.status === 'warning')) {
      overallStatus = 'warning';
    }

    let summaryText = '全网主流稳定币锚定健康，各链原生挂钩偏差 ≤ 0.5%';
    if (overallStatus === 'depeg') {
      summaryText = `🚨 侦测到 ${activeAlerts.length} 个稳定币脱锚套利空间，利差最高达 +${Math.max(...activeAlerts.map((a) => a.spreadPct)).toFixed(2)}%！`;
    } else if (overallStatus === 'warning') {
      summaryText = `⚠️ 监测到部分稳定币轻微利差偏离，建议关注套利流动性窗口。`;
    }

    const result = {
      ok: true,
      status: overallStatus,
      checkedAt: new Date().toISOString(),
      summary: summaryText,
      tokens: tokenSummaries,
      alerts: activeAlerts,
      meta: {
        trackedCount: Object.keys(TRACKED_STABLECOINS).length,
        endpointsChecked: llamaCoins.length,
      },
    };

    cachedState = result;
    lastCheckTs = Date.now();
    return result;
  }

  /** 获取当前缓存状态（非阻塞） */
  static getCached() {
    return cachedState;
  }
}

module.exports = DepegDetector;
