'use strict';
/**
 * 跨链貔貅假币、恶意智能合约与交易池高费率陷阱检测引擎
 * 1. 接入 GoPlus Security 行业权威检测接口（代币合约 Buy/Sell Tax、貔貅、冻结、黑名单）
 * 2. 深入解析 DEX Liquidity Pool Swap Fee（如 Uniswap V4 10%/65% 陷阱费率、UniV3/V2 费率）
 * 3. 接入 GeckoTerminal API 链上池费穿透兜底，杜绝 DEX Screener 隐藏 V4 费率引发的虚假套利
 * 支持 EVM 全链（Ethereum, BSC, Arbitrum, Base, Optimism, Polygon 等）与 Solana SVM
 */

const net = require('./net');
const chains = require('./chains');

// GeckoTerminal 网络映射
const GECKO_NETWORKS = {
  ethereum: 'eth',
  bsc: 'bsc',
  polygon: 'polygon_pos',
  avalanche: 'avax',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  base: 'base',
  solana: 'solana',
  linea: 'linea',
  blast: 'blast',
  scroll: 'scroll',
  mantle: 'mantle',
  zksync: 'zksync',
  fantom: 'ftm',
  celo: 'celo',
  cronos: 'cro',
  metis: 'metis',
  moonbeam: 'moonbeam',
  sonic: 'sonic',
  berachain: 'berachain',
  unichain: 'unichain',
};

// 内存 TTL 缓存：2小时，避免同一合约在短时间内被频繁发起外部 API 请求
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const cache = new Map(); // key -> { timestamp, data }
const inFlight = new Map(); // key -> Promise
const geckoPoolCache = new Map(); // key -> { timestamp, data }

function cacheKey(chain, address, pairAddress = null) {
  const p = pairAddress ? `:${String(pairAddress).trim().toLowerCase()}` : '';
  return `${String(chain || '').toLowerCase()}:${String(address || '').trim().toLowerCase()}${p}`;
}

function extractPairFromUrl(url) {
  if (!url) return null;
  const parts = url.trim().split('?')[0].split('/');
  return parts[parts.length - 1] || null;
}

/**
 * 跨链穿透查询 GeckoTerminal 获得具体流动性池的真实 Swap 手续费
 */
async function fetchGeckoPoolFee(chain, pairAddress, settings) {
  if (!chain || !pairAddress) return null;
  const gtNet = GECKO_NETWORKS[chain] || chain;
  const normPair = String(pairAddress).trim().toLowerCase();
  const k = `${gtNet}:${normPair}`;
  const c = geckoPoolCache.get(k);
  if (c && Date.now() - c.timestamp < 24 * 3600 * 1000) return c.data;

  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/${gtNet}/pools/${encodeURIComponent(normPair)}`;
    const res = await net.request(url, { settings, timeout: 6000 });
    if (!res.ok || !res.json?.data?.attributes) return null;
    const attr = res.json.data.attributes;
    let feeRate = null;
    if (attr.pool_fee_percentage != null && attr.pool_fee_percentage !== '') {
      feeRate = parseFloat(attr.pool_fee_percentage) / 100;
    } else if (attr.name) {
      const m = attr.name.match(/\s(\d+(?:\.\d+)?)\s*%/);
      if (m) feeRate = parseFloat(m[1]) / 100;
    }
    const out = {
      feeRate: (typeof feeRate === 'number' && !isNaN(feeRate)) ? feeRate : null,
      poolName: attr.name || null,
      dex: res.json.data.relationships?.dex?.data?.id || null,
    };
    if (geckoPoolCache.size > 2000) {
      geckoPoolCache.delete(geckoPoolCache.keys().next().value);
    }
    geckoPoolCache.set(k, { timestamp: Date.now(), data: out });
    return out;
  } catch {
    return null;
  }
}

/**
 * 获取或设置缓存
 */
function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  // 控制缓存上限在 5000 个地址以内
  if (cache.size > 5000) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, { timestamp: Date.now(), data });
}

/**
 * 检测单个代币的合约安全性、貔貅特征与具体流动性池手续费
 * @param {string} chain 链名称 key
 * @param {string} address 代币合约地址或 mint
 * @param {Object} [settings] 系统网络配置
 * @param {string} [pairAddress] 交易池地址 (可选，用于提取精确 Pool Swap Fee)
 * @returns {Promise<Object>} TokenSecurityDetail
 */
async function checkTokenSecurity(chain, address, settings = null, pairAddress = null) {
  if (typeof chain !== 'string' || !chain.trim() || typeof address !== 'string' || !address.trim()) {
    return fallbackUnknown('链或地址缺失 · 无法核验安全性');
  }

  const k = cacheKey(chain, address, pairAddress);
  const cached = getCached(k);
  if (cached) return cached;

  if (inFlight.has(k)) {
    return inFlight.get(k);
  }

  const promise = (async () => {
    try {
      const chainInfo = chains.get(chain);
      let result = null;

      if (chain === 'solana') {
        result = await checkSolanaToken(address, settings, pairAddress);
      } else if (chainInfo && chainInfo.evm) {
        result = await checkEvmToken(chainInfo.evm, address, settings, pairAddress, chain);
      } else {
        result = fallbackUnknown('未覆盖链 · 暂无代码安全审计源');
      }

      setCached(k, result);
      return result;
    } finally {
      inFlight.delete(k);
    }
  })();

  inFlight.set(k, promise);
  return promise;
}

/**
 * 针对 EVM 链的 GoPlus 代币安全与池子费率扫描
 */
async function checkEvmToken(chainId, address, settings, pairAddress = null, chainKey = null) {
  const normAddr = address.toLowerCase();
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${normAddr}`;
  
  try {
    const res = await net.request(url, { settings, timeout: 8000 });
    if (!res.ok || !res.json || res.json.code !== 1 || !res.json.result) {
      return fallbackUnknown('安全接口响应超时或无结果');
    }

    const item = res.json.result[normAddr] || res.json.result[address];
    if (!item) {
      return fallbackUnknown('安全接口缺少代币结果');
    }

    const buyTax = parseTax(item.buy_tax);
    const sellTax = parseTax(item.sell_tax);
    const unknown = buyTax === null || sellTax === null ||
      ['is_honeypot', 'cannot_sell_all', 'cannot_buy', 'is_open_source', 'is_blacklisted', 'transfer_pausable']
        .some(key => item[key] !== '0' && item[key] !== '1');
    const isHoneypotCode = item.is_honeypot === '1' || item.cannot_sell_all === '1' || item.cannot_buy === '1';
    const isMaliciousTax = sellTax >= 0.3 || buyTax >= 0.3; // 30% 以上税率直接定性为恶意貔貅
    let isHoneypot = isHoneypotCode || isMaliciousTax;
    const isOpenSource = item.is_open_source === '1' ? true : item.is_open_source === '0' ? false : null;
    const isBlacklisted = item.is_blacklisted === '1';
    const cannotSellAll = item.cannot_sell_all === '1';
    const transferPausable = item.transfer_pausable === '1';

    // 智能解析交易池 Swap 手续费 (Pool Fee)
    const normPair = pairAddress ? String(pairAddress).trim().toLowerCase() : null;
    let poolFee = null;
    let poolType = null;
    const dexList = Array.isArray(item.dex) ? item.dex : [];

    if (normPair) {
      const matchedDex = dexList.find((d) => d.pair && d.pair.toLowerCase() === normPair);
      if (matchedDex) {
        if (matchedDex.pool_fee !== undefined && matchedDex.pool_fee !== '') {
          const pf = parseFloat(matchedDex.pool_fee);
          if (!isNaN(pf)) poolFee = pf;
        }
        poolType = matchedDex.liquidity_type || matchedDex.name || null;
      }
    }

    // 若 GoPlus dex 未命中或未提供 pool_fee，但提供了 pairAddress，通过 GeckoTerminal 补充核查
    if (poolFee === null && normPair && chainKey) {
      const gt = await fetchGeckoPoolFee(chainKey, normPair, settings).catch(() => null);
      if (gt && typeof gt.feeRate === 'number') {
        poolFee = gt.feeRate;
        if (!poolType && gt.dex) poolType = gt.dex;
      }
    }

    // 兜底：若池子类型明确为 V2 架构且无单独设费，标准 V2 费率为 0.3%
    if (poolFee === null && poolType && /v2/i.test(poolType)) {
      poolFee = 0.003;
    }

    const poolFeePct = (poolFee != null) ? Number((poolFee * 100).toFixed(2)) : null;
    const isTrapPool = poolFee != null && poolFee >= 0.05; // 5% 及以上为陷阱/高摩擦池
    const isHighFeePool = poolFee != null && poolFee > 0.01; // 1% 及以上为高费率池
    const trapPoolsCount = dexList.filter(d => parseFloat(d.pool_fee) >= 0.05).length;

    let riskLevel = 'safe';
    let riskReason = '代码体检通过 · 0%税';

    if (isHoneypot) {
      riskLevel = 'danger';
      if (item.is_honeypot === '1') riskReason = '智能合约貔貅 (不可卖出)';
      else if (cannotSellAll) riskReason = '智能合约貔貅 (无法全部卖出)';
      else if (item.cannot_buy === '1') riskReason = '智能合约貔貅 (无法买入)';
      else if (sellTax >= 0.3) riskReason = `恶意卖出税率 (${(sellTax * 100).toFixed(0)}%)`;
      else if (buyTax >= 0.3) riskReason = `恶意买入税率 (${(buyTax * 100).toFixed(0)}%)`;
    } else if (poolFee != null && poolFee >= 0.3) {
      // 30% 以上的池手续费直接判定为致命陷阱池
      riskLevel = 'danger';
      isHoneypot = true;
      riskReason = `致命高费率陷阱池 (Swap费 ${(poolFee * 100).toFixed(1)}%)，极大概率套利黑洞`;
    } else if (poolFee != null && poolFee >= 0.05) {
      // 5% ~ 30% 的池手续费属于高危陷阱
      riskLevel = 'danger';
      riskReason = `高费率交易池 (Swap费 ${(poolFee * 100).toFixed(1)}%)，注意扣除池子手续费`;
    } else if (buyTax > 0.1 || sellTax > 0.1) {
      riskLevel = 'warning';
      riskReason = `高摩擦交易税 (买 ${formatTax(buyTax)} / 卖 ${formatTax(sellTax)})`;
    } else if (poolFee != null && poolFee > 0.01) {
      riskLevel = 'warning';
      riskReason = `较高交易池费率 (${(poolFee * 100).toFixed(2)}%)`;
    } else if (buyTax > 0 || sellTax > 0) {
      riskLevel = 'warning';
      riskReason = `含交易税 (买 ${formatTax(buyTax)} / 卖 ${formatTax(sellTax)})`;
    } else if (isBlacklisted) {
      riskLevel = 'warning';
      riskReason = '合约包含黑名单机制 (地址可被封禁)';
    } else if (transferPausable) {
      riskLevel = 'warning';
      riskReason = '合约包含暂停转账机制 (Pausable)';
    } else if (isOpenSource === false) {
      riskLevel = 'warning';
      riskReason = '合约未开源 · 需核对流动性池';
    } else if (poolFee != null) {
      riskReason = `代码体检通过 · 0%税 (池费 ${(poolFee * 100).toFixed(2)}%)`;
    }

    if (unknown) {
      riskReason = (riskLevel === 'safe' ? '' : `${riskReason}；`) + '安全数据不完整 · 未知项待核验';
      if (riskLevel !== 'danger') riskLevel = 'unknown';
    }

    return {
      safe: !unknown && riskLevel === 'safe',
      unknown,
      isHoneypot,
      buyTax,
      sellTax,
      poolFee,
      poolFeePct,
      poolType,
      isTrapPool,
      isHighFeePool,
      trapPoolsCount,
      cannotSellAll,
      isOpenSource,
      isBlacklisted,
      isProxy: item.is_proxy === '1',
      transferPausable,
      riskLevel,
      riskReason,
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    return fallbackUnknown(`安全体检网络异常: ${e.message}`);
  }
}

/**
 * 针对 Solana SVM 链的 GoPlus 代币安全与池子费率扫描
 */
async function checkSolanaToken(address, settings, pairAddress = null) {
  const url = `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`;
  
  try {
    const res = await net.request(url, { settings, timeout: 8000 });
    if (!res.ok || !res.json || res.json.code !== 1 || !res.json.result) {
      return fallbackUnknown('Solana 安全接口响应超时或无结果');
    }

    const item = res.json.result[address];
    if (!item) {
      return fallbackUnknown('Solana 安全接口缺少代币结果');
    }

    const nonTransferable = item.non_transferable === '1';
    const freezable = item.freezable?.status === '1';
    const isTrusted = item.trusted_token === 1;
    const hasTransferFee = item.transfer_fee && Object.keys(item.transfer_fee).length > 0;
    const isHoneypot = nonTransferable;

    let poolFee = null;
    let poolType = null;
    if (pairAddress) {
      const gt = await fetchGeckoPoolFee('solana', pairAddress, settings).catch(() => null);
      if (gt && typeof gt.feeRate === 'number') {
        poolFee = gt.feeRate;
        poolType = gt.dex || null;
      }
    }

    const poolFeePct = (poolFee != null) ? Number((poolFee * 100).toFixed(2)) : null;
    const isTrapPool = poolFee != null && poolFee >= 0.05;
    const isHighFeePool = poolFee != null && poolFee > 0.01;

    let riskLevel = 'safe';
    let riskReason = 'Solana 代码体检通过 · 无交易税';

    if (nonTransferable) {
      riskLevel = 'danger';
      riskReason = 'Solana 貔貅 (Non-transferable 不可转移)';
    } else if (poolFee != null && poolFee >= 0.05) {
      riskLevel = 'danger';
      riskReason = `高费率交易池 (Swap费 ${(poolFee * 100).toFixed(1)}%)，注意扣除池子手续费`;
    } else if (freezable && !isTrusted) {
      riskLevel = 'warning';
      riskReason = '保留冻结权限 (Freezable 未放弃权限)';
    } else if (hasTransferFee) {
      riskLevel = 'warning';
      riskReason = '存在 Token-2022 Transfer Fee 转账税';
    } else if (poolFee != null && poolFee > 0.01) {
      riskLevel = 'warning';
      riskReason = `较高交易池费率 (${(poolFee * 100).toFixed(2)}%)`;
    } else if (poolFee != null) {
      riskReason = `Solana 代码体检通过 · 0%税 (池费 ${(poolFee * 100).toFixed(2)}%)`;
    }

    // ponytail: 尚未解析 SVM 税率及开源证据；实现核验前保持 unknown。
    riskReason = (riskLevel === 'safe' ? '' : `${riskReason}；`) + 'Solana 税率及开源状态未核验';
    if (riskLevel !== 'danger') riskLevel = 'unknown';
    return {
      safe: false,
      unknown: true,
      isHoneypot,
      buyTax: null,
      sellTax: null,
      poolFee,
      poolFeePct,
      poolType,
      isTrapPool,
      isHighFeePool,
      cannotSellAll: false,
      isOpenSource: null,
      freezable,
      isTrusted,
      riskLevel,
      riskReason,
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    return fallbackUnknown(`Solana 安全体检网络异常: ${e.message}`);
  }
}

function parseTax(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') return null;
  const tax = Number(value);
  return Number.isFinite(tax) && tax >= 0 && tax <= 1 ? tax : null;
}

function formatTax(tax) {
  return tax === null ? '未知' : `${(tax * 100).toFixed(1)}%`;
}

function fallbackUnknown(reason) {
  return {
    safe: false,
    unknown: true,
    isHoneypot: null,
    buyTax: null,
    sellTax: null,
    poolFee: null,
    poolFeePct: null,
    poolType: null,
    isTrapPool: false,
    isHighFeePool: false,
    cannotSellAll: null,
    isOpenSource: null,
    riskLevel: 'unknown',
    riskReason: reason || '安全性未核验',
    checkedAt: new Date().toISOString(),
  };
}

/**
 * 对一个跨链套利机会进行买卖双端合约安全体检、貔貅裁决与交易池手续费核验
 * @param {Object} opp 套利机会对象
 * @param {Object} [settings]
 * @returns {Promise<Object>} security 综合检查结果
 */
async function checkOpportunitySecurity(opp, settings = null) {
  if (!opp) return null;

  const buyPair = opp.buyPairAddress || extractPairFromUrl(opp.buyUrl);
  const sellPair = opp.sellPairAddress || extractPairFromUrl(opp.sellUrl);

  const [buySec, sellSec] = await Promise.all([
    checkTokenSecurity(opp.buyChain, opp.buyAddress, settings, buyPair),
    checkTokenSecurity(opp.sellChain, opp.sellAddress, settings, sellPair),
  ]);

  const isHoneypot = Boolean((buySec && buySec.isHoneypot) || (sellSec && sellSec.isHoneypot));
  const isTrapPool = Boolean((buySec && buySec.isTrapPool) || (sellSec && sellSec.isTrapPool));
  const hasWarning = Boolean(
    (buySec && buySec.riskLevel === 'warning') ||
    (sellSec && sellSec.riskLevel === 'warning') ||
    (buySec && buySec.isHighFeePool) ||
    (sellSec && sellSec.isHighFeePool)
  );
  const unknown = [buySec, sellSec].some(sec => !sec || sec.unknown || sec.riskLevel === 'unknown' ||
    (sec.safe !== true && !['warning', 'danger'].includes(sec.riskLevel)));
  const hasDanger = isHoneypot || isTrapPool || [buySec, sellSec].some(sec => sec?.riskLevel === 'danger');
  const safe = buySec?.safe === true && sellSec?.safe === true && !unknown && !hasDanger && !hasWarning;
  const riskLevel = hasDanger ? 'danger' : unknown ? 'unknown' : hasWarning ? 'warning' : safe ? 'safe' : 'unknown';

  let riskReason = '双端合约体检通过';
  if (isHoneypot) {
    if (buySec?.isHoneypot && sellSec?.isHoneypot) {
      riskReason = `双端均含貔貅/陷阱: 买[${buySec.riskReason}] / 卖[${sellSec.riskReason}]`;
    } else if (buySec?.isHoneypot) {
      riskReason = `买入端高危: ${buySec.riskReason}`;
    } else {
      riskReason = `卖出端高危: ${sellSec.riskReason}`;
    }
  } else if (isTrapPool) {
    const maxFee = Math.max(buySec?.poolFee || 0, sellSec?.poolFee || 0);
    riskReason = `交易池高费率预警 (Swap费率 ${(maxFee * 100).toFixed(1)}%)，注意扣除池子手续费`;
  } else if (hasWarning) {
    if (buySec?.riskLevel === 'warning' && sellSec?.riskLevel === 'warning') {
      riskReason = `买入[${buySec.riskReason}] | 卖出[${sellSec.riskReason}]`;
    } else if (buySec?.riskLevel === 'warning') {
      riskReason = `买入端: ${buySec.riskReason}`;
    } else {
      riskReason = `卖出端: ${sellSec.riskReason}`;
    }
  }

  if (unknown || hasDanger) {
    riskReason = `买入[${buySec.riskReason}] | 卖出[${sellSec.riskReason}]`;
  }

  // 绑定池费数据到机会上
  opp.buyPairAddress = buyPair;
  opp.sellPairAddress = sellPair;
  opp.buyPoolFee = buySec?.poolFee ?? null;
  opp.sellPoolFee = sellSec?.poolFee ?? null;
  opp.buyPoolType = buySec?.poolType ?? null;
  opp.sellPoolType = sellSec?.poolType ?? null;

  const security = {
    safe,
    unknown,
    hasRisk: !safe,
    isHoneypot,
    isTrapPool,
    riskLevel,
    riskReason,
    buySecurity: buySec,
    sellSecurity: sellSec,
    checkedAt: new Date().toISOString(),
  };

  // 如果检测到貔貅，强力阻断标记为 fake
  if (isHoneypot) {
    opp.verdict = 'fake';
    opp.suspicious = true;
  } else if (isTrapPool) {
    // 高费率陷阱池标记为 suspicious
    opp.suspicious = true;
    opp.poolFeeTrap = true;
    if (opp.verdict !== 'fake') opp.verdict = 'suspicious';
    const maxFee = Math.max(buySec?.poolFee || 0, sellSec?.poolFee || 0);
    opp.collisionReason = `交易池手续费高达 ${(maxFee * 100).toFixed(1)}%（DEX Screener 隐藏此费率），往返摩擦过大`;
  }

  opp.security = security;
  return security;
}

module.exports = {
  checkTokenSecurity,
  checkOpportunitySecurity,
  fetchGeckoPoolFee,
  extractPairFromUrl,
  cacheKey,
};
