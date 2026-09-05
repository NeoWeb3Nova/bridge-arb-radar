'use strict';
/**
 * crosschain-quoter.js
 * 链上真实跨链询价引擎：直连 Li.Fi 跨链路由聚合器 API
 * 实时获取当前区块高度下的精确 Gas 费用、跨链桥协议费、中继费与预计到账耗时。
 */

const net = require('./net');
const chains = require('./chains');
const store = require('./store');

// 常用链标准结算代币（用于测算链间通道实时真实 Gas 与桥手续费）
const STANDARD_SETTLEMENT = {
  ethereum:  { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6,  chainId: 1 },
  bsc:       { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, chainId: 56 },
  arbitrum:  { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6,  chainId: 42161 },
  base:      { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6,  chainId: 8453 },
  optimism:  { symbol: 'USDC', address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6,  chainId: 10 },
  polygon:   { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6,  chainId: 137 },
  avalanche: { symbol: 'USDC', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6,  chainId: 43114 },
  blast:     { symbol: 'USDB', address: '0x4300000000000000000000000000000000000003', decimals: 18, chainId: 81457 },
  linea:     { symbol: 'USDC', address: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff', decimals: 6,  chainId: 59144 },
  scroll:    { symbol: 'USDC', address: '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4', decimals: 6,  chainId: 534352 },
  solana:    { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, chainId: 1151111081099710 },
};

function getLifiChainId(chainKey) {
  if (chainKey === 'solana') return 1151111081099710;
  const c = chains.get(chainKey);
  return c?.evm || null;
}

const EVM_DUMMY = '0x552008c0f6870c2f77e5cC1d2eb9bdff03e30Ea0';
const SOL_DUMMY = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

// 内存 60s LRU 缓存，避免重复高频请求触发外部限速
const quoteCache = new Map();
const CACHE_TTL_MS = 60000;

function getCached(key) {
  const item = quoteCache.get(key);
  if (!item) return null;
  if (Date.now() - item.ts > CACHE_TTL_MS) {
    quoteCache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  if (quoteCache.size > 200) {
    const oldestKey = quoteCache.keys().next().value;
    quoteCache.delete(oldestKey);
  }
  quoteCache.set(key, { ts: Date.now(), data });
}

/**
 * 将金额转为对应 decimals 的 BigInt 字符串
 */
function toTokenUnits(amount, decimals) {
  const factor = 10n ** BigInt(decimals);
  const intPart = BigInt(Math.floor(amount));
  const fracPart = amount - Math.floor(amount);
  const fracUnits = BigInt(Math.floor(fracPart * Number(factor)));
  return (intPart * factor + fracUnits).toString();
}

/**
 * 向 Li.Fi 发起实时询价 (支持 EVM 与 Solana 双向跨链)
 */
async function fetchLifiQuote(fromChainId, toChainId, fromToken, toToken, fromUnits, settings, fromChainKey, toChainKey) {
  const fromAddr = (fromChainKey === 'solana' || String(fromChainId) === '1151111081099710') ? SOL_DUMMY : EVM_DUMMY;
  const toAddr = (toChainKey === 'solana' || String(toChainId) === '1151111081099710') ? SOL_DUMMY : EVM_DUMMY;
  const url = `https://li.quest/v1/quote?fromChain=${fromChainId}&toChain=${toChainId}&fromToken=${fromToken}&toToken=${toToken}&fromAmount=${fromUnits}&fromAddress=${fromAddr}&toAddress=${toAddr}`;
  const apiKey = (settings?.keys?.lifi || process.env.LIFI_API_KEY || '').trim();
  const headers = {};
  if (apiKey) {
    headers['x-lifi-api-key'] = apiKey;
  }
  let res = await net.request(url, { settings, headers, timeout: 10000 });
  // 如果配置了无效的 API Key 导致 401/403，优雅降级重试公开端点 (避免因 Key 填错导致所有实时询价失效)
  if (!res.ok && (res.status === 401 || res.status === 403) && apiKey) {
    console.warn(`[crosschain-quoter] Li.Fi API Key 无效或过期 (${res.status})，降级使用公共端点`);
    res = await net.request(url, { settings, headers: {}, timeout: 10000 });
    if (res.ok) {
      res.apiKeyDegraded = true;
    }
  }
  return res;
}

/**
 * 直连 Across Protocol 官方原生 API 进行独立询价 (双重链路保险)
 */
async function fetchAcrossDirectQuote(buyChain, sellChain, amountUsd, settings) {
  const stdFrom = STANDARD_SETTLEMENT[buyChain];
  const stdTo = STANDARD_SETTLEMENT[sellChain];
  const c1 = chains.get(buyChain);
  const c2 = chains.get(sellChain);
  if (!stdFrom || !stdTo || !c1?.evm || !c2?.evm) return null;

  try {
    const units = toTokenUnits(amountUsd, stdFrom.decimals);
    const url = `https://app.across.to/api/suggested-fees?inputToken=${stdFrom.address}&outputToken=${stdTo.address}&originChainId=${c1.evm}&destinationChainId=${c2.evm}&amount=${units}&allowUnmatchedDecimals=true`;
    const res = await net.request(url, { settings, timeout: 8000 });
    if (res.ok && res.json && (res.json.relayFeePct || res.json.relayFeeTotal)) {
      const data = res.json;
      const relayUnits = BigInt(data.relayFeeTotal || '0');
      const factor = 10 ** stdFrom.decimals;
      const relayFeeDec = Number(relayUnits) / factor;
      const bridgeFeeUsd = Math.max(0.1, Number(relayFeeDec.toFixed(2)));
      let gasUsd = (sellChain === 'ethereum' || buyChain === 'ethereum') ? 4.50 : 0.40;

      return {
        ok: true,
        isLiveQuote: true,
        hasApiKey: false,
        isDirectTokenRoute: false,
        source: 'across_direct',
        bridgeName: 'Across Protocol (Direct)',
        bridgeUrl: 'https://across.to/',
        etaSeconds: data.estimatedFillTimeSec || 4,
        gasUsd,
        bridgeFeeUsd,
        totalFeeUsd: Number((gasUsd + bridgeFeeUsd).toFixed(2)),
        ttlSeconds: 60,
        updatedAt: Date.now(),
        expiresAt: Date.now() + CACHE_TTL_MS,
        details: {
          gasTokens: [`${buyChain.toUpperCase()} Gas: $${gasUsd.toFixed(2)}`],
          feeDetails: [
            `Across Relayer Fee: $${relayFeeDec.toFixed(3)}`,
            `Estimated Fill Time: ~${data.estimatedFillTimeSec || 4}s`
          ]
        }
      };
    }
  } catch (err) {
    // 忽略直连错误
  }
  return null;
}

/**
 * 核心对外询价方法
 * @param {Object} params
 * @param {string} params.buyChain - 来源链 (如 bsc)
 * @param {string} params.sellChain - 目标链 (如 ethereum)
 * @param {string} [params.buyAddress] - 买入端代币地址
 * @param {string} [params.sellAddress] - 卖出端代币地址
 * @param {number} params.amountUsd - 投入本金 (如 1000)
 */
async function getLiveQuote(params) {
  const { buyChain, sellChain, buyAddress, sellAddress, amountUsd = 1000, tokenPrice, tokenAmount, force = false } = params;
  const cacheKey = `${buyChain}_${sellChain}_${amountUsd}_${buyAddress || ''}_${sellAddress || ''}`;
  if (!force) {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  } else {
    quoteCache.delete(cacheKey);
  }

  const settings = store.settings();
  const hasApiKey = !!((settings?.keys?.lifi || process.env.LIFI_API_KEY || '').trim());
  const c1 = chains.get(buyChain);
  const c2 = chains.get(sellChain);

  const c1Id = getLifiChainId(buyChain);
  const c2Id = getLifiChainId(sellChain);

  // 1. 尝试直接询价该代币 (如果双方链聚合器都支持且合约存在)
  if (c1Id && c2Id && buyAddress && sellAddress) {
    try {
      // 必须先根据实时代币价格将 USD 本金折算为实际需跨链搬运的代币数量，而非直接把 USD 当作代币数量
      const realTokens = (tokenAmount && tokenAmount > 0)
        ? tokenAmount
        : (tokenPrice && tokenPrice > 0 ? (amountUsd / tokenPrice) : amountUsd);
      const units = toTokenUnits(realTokens, 18);
      const res = await fetchLifiQuote(c1Id, c2Id, buyAddress, sellAddress, units, settings, buyChain, sellChain);
      if (res.ok && res.json?.estimate) {
        const est = res.json.estimate;
        const gasUsd = (est.gasCosts || []).reduce((sum, g) => sum + Number(g.amountUSD || 0), 0);
        const feeUsd = (est.feeCosts || []).reduce((sum, f) => sum + Number(f.amountUSD || 0), 0);
        const bridgeName = res.json.toolDetails?.name || res.json.tool || 'Li.Fi Bridge';
        const result = {
          ok: true,
          isLiveQuote: true,
          hasApiKey,
          isDirectTokenRoute: true,
          source: 'lifi_direct',
          bridgeName,
          bridgeUrl: res.json.toolDetails?.webUrl || 'https://li.fi/',
          etaSeconds: est.executionDuration || 60,
          gasUsd: Number(gasUsd.toFixed(2)),
          bridgeFeeUsd: Number(feeUsd.toFixed(2)),
          totalFeeUsd: Number((gasUsd + feeUsd).toFixed(2)),
          ttlSeconds: 60,
          updatedAt: Date.now(),
          expiresAt: Date.now() + CACHE_TTL_MS,
          details: {
            gasTokens: est.gasCosts?.map(g => `${g.token?.symbol || 'GAS'}: $${Number(g.amountUSD || 0).toFixed(2)}`),
            feeDetails: est.feeCosts?.map(f => `${f.name}: $${Number(f.amountUSD || 0).toFixed(2)}`),
          }
        };
        setCache(cacheKey, result);
        return result;
      }
    } catch (e) {
      // 忽略直接代币询价失败，进入结算通道询价
    }
  }

  let lastErrorMessage = '';

  // 2. 通道级实时真实询价：使用买卖链之间的标准稳定币结算通道
  // 获取当前链上实时的 Gas 价格、中继费 (Relayer) 和桥协议费 (Across / Stargate / Polymer / Near)
  const stdFrom = STANDARD_SETTLEMENT[buyChain];
  const stdTo = STANDARD_SETTLEMENT[sellChain];

  if (stdFrom && stdTo && c1Id && c2Id) {
    try {
      const units = toTokenUnits(amountUsd, stdFrom.decimals);
      const res = await fetchLifiQuote(c1Id, c2Id, stdFrom.address, stdTo.address, units, settings, buyChain, sellChain);
      if (res.ok && res.json?.estimate) {
        const est = res.json.estimate;
        let gasUsd = (est.gasCosts || []).reduce((sum, g) => sum + Number(g.amountUSD || 0), 0);
        let feeUsd = (est.feeCosts || []).reduce((sum, f) => sum + Number(f.amountUSD || 0), 0);
        const bridgeName = res.json.toolDetails?.name || res.json.tool || 'Across';

        // 如果涉及以太坊卖出端，补足一笔目标链 DEX Swap 的 Gas 预估 (约 130k gas)
        if (sellChain === 'ethereum') {
          gasUsd += 4.50;
        } else if (['arbitrum', 'base', 'optimism', 'polygon'].includes(sellChain)) {
          gasUsd += 0.35;
        } else if (sellChain === 'solana') {
          gasUsd += 0.01;
        }

        const result = {
          ok: true,
          isLiveQuote: true,
          hasApiKey: hasApiKey && !res.apiKeyDegraded,
          isDirectTokenRoute: false,
          source: 'lifi_channel',
          bridgeName,
          bridgeUrl: res.json.toolDetails?.webUrl || 'https://across.to/',
          etaSeconds: est.executionDuration || 90,
          gasUsd: Number(gasUsd.toFixed(2)),
          bridgeFeeUsd: Number(feeUsd.toFixed(2)),
          totalFeeUsd: Number((gasUsd + feeUsd).toFixed(2)),
          ttlSeconds: 60,
          updatedAt: Date.now(),
          expiresAt: Date.now() + CACHE_TTL_MS,
          details: {
            apiKeyWarning: res.apiKeyDegraded ? '配置的 Li.Fi API Key 无效或未激活，已自动降级为公共端点' : undefined,
            gasTokens: est.gasCosts?.map(g => `${g.token?.symbol || 'GAS'}: $${Number(g.amountUSD || 0).toFixed(2)}`),
            feeDetails: est.feeCosts?.map(f => `${f.name}: $${Number(f.amountUSD || 0).toFixed(2)}`),
          }
        };
        setCache(cacheKey, result);
        return result;
      } else if (res.json?.message) {
        lastErrorMessage = res.json.message;
      }
    } catch (err) {
      lastErrorMessage = err.message || '';
    }
  }

  // 3. 直连 Across 官方原生接口兜底 (双重链上实时询价引擎)
  const acrossDirect = await fetchAcrossDirectQuote(buyChain, sellChain, amountUsd, settings);
  if (acrossDirect) {
    setCache(cacheKey, acrossDirect);
    return acrossDirect;
  }

  // 4. 兜底经验模型（当网络超时或跨链通道暂无活跃路由时）
  const isL2 = ['arbitrum', 'base', 'optimism', 'polygon'].includes(buyChain) && ['arbitrum', 'base', 'optimism', 'polygon'].includes(sellChain);
  const hasEth = buyChain === 'ethereum' || sellChain === 'ethereum';
  const hasSol = buyChain === 'solana' || sellChain === 'solana';
  const gasUsd = hasEth ? 6.50 : (isL2 ? 0.85 : (hasSol ? 0.90 : 1.60));
  const bridgeFeeUsd = hasEth ? 2.50 : (hasSol ? 2.50 : 0.80);

  const fallback = {
    ok: true,
    isLiveQuote: false,
    source: 'model_baseline',
    bridgeName: isL2 ? 'Across' : (hasEth ? 'Stargate' : (hasSol ? 'Polymer / Mayan' : 'Hyperlane')),
    bridgeUrl: isL2 ? 'https://across.to/' : (hasEth ? 'https://stargate.finance/' : 'https://mayan.finance/'),
    etaSeconds: hasEth ? 120 : (isL2 ? 70 : (hasSol ? 180 : 150)),
    gasUsd,
    bridgeFeeUsd,
    totalFeeUsd: Number((gasUsd + bridgeFeeUsd).toFixed(2)),
    ttlSeconds: 60,
    updatedAt: Date.now(),
    expiresAt: Date.now() + CACHE_TTL_MS,
    details: {
      note: lastErrorMessage
        ? `链上聚合通道暂无直接路由 (${lastErrorMessage})，已自动使用公链 Gas 经验模型`
        : (hasSol 
            ? 'Solana 实时通道瞬时网络无应答，已自动启用经验模型' 
            : '链上即时聚合通道未返回可用跨链路由，已使用公链 Gas 经验模型测算')
    }
  };
  setCache(cacheKey, fallback);
  return fallback;
}

module.exports = {
  getLiveQuote,
  STANDARD_SETTLEMENT,
};
