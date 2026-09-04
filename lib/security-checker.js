'use strict';
/**
 * 跨链貔貅假币与恶意智能合约检测引擎
 * 接入 GoPlus Security Token Security 行业权威检测接口（免费免密钥）
 * 支持 EVM 全链（Ethereum, BSC, Arbitrum, Base, Optimism, Polygon 等）与 Solana SVM
 */

const net = require('./net');
const chains = require('./chains');

// 内存 TTL 缓存：2小时，避免同一合约在短时间内被频繁发起外部 API 请求
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const cache = new Map(); // key -> { timestamp, data }
const inFlight = new Map(); // key -> Promise

function cacheKey(chain, address) {
  return `${String(chain || '').toLowerCase()}:${String(address || '').trim().toLowerCase()}`;
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
 * 检测单个代币的合约安全性与貔貅特征
 * @param {string} chain 链名称 key
 * @param {string} address 代币合约地址或 mint
 * @param {Object} [settings] 系统网络配置
 * @returns {Promise<Object>} TokenSecurityDetail
 */
async function checkTokenSecurity(chain, address, settings = null) {
  if (!chain || !address) {
    return {
      safe: true,
      isHoneypot: false,
      buyTax: 0,
      sellTax: 0,
      cannotSellAll: false,
      isOpenSource: true,
      riskLevel: 'safe',
      riskReason: '原生代币或空地址免检',
      checkedAt: new Date().toISOString(),
    };
  }

  const k = cacheKey(chain, address);
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
        result = await checkSolanaToken(address, settings);
      } else if (chainInfo && chainInfo.evm) {
        result = await checkEvmToken(chainInfo.evm, address, settings);
      } else {
        // 不支持安全 API 的小众非 EVM 链，返回默认通过但标记未覆盖
        result = {
          safe: true,
          isHoneypot: false,
          buyTax: 0,
          sellTax: 0,
          cannotSellAll: false,
          isOpenSource: true,
          isBlacklisted: false,
          riskLevel: 'safe',
          riskReason: '未覆盖链 · 暂无代码安全审计源',
          checkedAt: new Date().toISOString(),
        };
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
 * 针对 EVM 链的 GoPlus 代币安全扫描
 */
async function checkEvmToken(chainId, address, settings) {
  const normAddr = address.toLowerCase();
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${normAddr}`;
  
  try {
    const res = await net.request(url, { settings, timeout: 8000 });
    if (!res.ok || !res.json || res.json.code !== 1 || !res.json.result) {
      return fallbackSafe('安全接口响应超时或无结果');
    }

    const item = res.json.result[normAddr] || res.json.result[address];
    if (!item) {
      return fallbackSafe('未在链上检测到高危貔貅记录');
    }

    const buyTax = parseFloat(item.buy_tax) || 0;
    const sellTax = parseFloat(item.sell_tax) || 0;
    const isHoneypotCode = item.is_honeypot === '1' || item.cannot_sell_all === '1' || item.cannot_buy === '1';
    const isMaliciousTax = sellTax >= 0.3 || buyTax >= 0.3; // 30% 以上税率直接定性为恶意貔貅
    const isHoneypot = isHoneypotCode || isMaliciousTax;
    const isOpenSource = item.is_open_source === '1';
    const isBlacklisted = item.is_blacklisted === '1';
    const cannotSellAll = item.cannot_sell_all === '1';
    const transferPausable = item.transfer_pausable === '1';

    let riskLevel = 'safe';
    let riskReason = '代码体检通过 · 0%税';

    if (isHoneypot) {
      riskLevel = 'danger';
      if (item.is_honeypot === '1') riskReason = '智能合约貔貅 (不可卖出)';
      else if (cannotSellAll) riskReason = '智能合约貔貅 (无法全部卖出)';
      else if (item.cannot_buy === '1') riskReason = '智能合约貔貅 (无法买入)';
      else if (sellTax >= 0.3) riskReason = `恶意卖出税率 (${(sellTax * 100).toFixed(0)}%)`;
      else if (buyTax >= 0.3) riskReason = `恶意买入税率 (${(buyTax * 100).toFixed(0)}%)`;
    } else if (buyTax > 0.1 || sellTax > 0.1) {
      riskLevel = 'warning';
      riskReason = `高摩擦交易税 (买 ${(buyTax * 100).toFixed(1)}% / 卖 ${(sellTax * 100).toFixed(1)}%)`;
    } else if (buyTax > 0 || sellTax > 0) {
      riskLevel = 'warning';
      riskReason = `含交易税 (买 ${(buyTax * 100).toFixed(1)}% / 卖 ${(sellTax * 100).toFixed(1)}%)`;
    } else if (isBlacklisted) {
      riskLevel = 'warning';
      riskReason = '合约包含黑名单机制 (地址可被封禁)';
    } else if (transferPausable) {
      riskLevel = 'warning';
      riskReason = '合约包含暂停转账机制 (Pausable)';
    } else if (!isOpenSource) {
      riskLevel = 'warning';
      riskReason = '合约未开源 · 需核对流动性池';
    }

    return {
      safe: riskLevel === 'safe',
      isHoneypot,
      buyTax,
      sellTax,
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
    return fallbackSafe(`安全体检网络异常: ${e.message}`);
  }
}

/**
 * 针对 Solana SVM 链的 GoPlus 代币安全扫描
 */
async function checkSolanaToken(address, settings) {
  const url = `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`;
  
  try {
    const res = await net.request(url, { settings, timeout: 8000 });
    if (!res.ok || !res.json || res.json.code !== 1 || !res.json.result) {
      return fallbackSafe('Solana 安全接口响应超时或无结果');
    }

    const item = res.json.result[address];
    if (!item) {
      return fallbackSafe('Solana 未检测到高危特征');
    }

    const nonTransferable = item.non_transferable === '1';
    const freezable = item.freezable?.status === '1';
    const isTrusted = item.trusted_token === 1;
    const hasTransferFee = item.transfer_fee && Object.keys(item.transfer_fee).length > 0;
    const isHoneypot = nonTransferable;

    let riskLevel = 'safe';
    let riskReason = 'Solana 代码体检通过 · 无交易税';

    if (nonTransferable) {
      riskLevel = 'danger';
      riskReason = 'Solana 貔貅 (Non-transferable 不可转移)';
    } else if (freezable && !isTrusted) {
      riskLevel = 'warning';
      riskReason = '保留冻结权限 (Freezable 未放弃权限)';
    } else if (hasTransferFee) {
      riskLevel = 'warning';
      riskReason = '存在 Token-2022 Transfer Fee 转账税';
    }

    return {
      safe: riskLevel === 'safe',
      isHoneypot,
      buyTax: 0,
      sellTax: 0,
      cannotSellAll: false,
      isOpenSource: true,
      freezable,
      isTrusted,
      riskLevel,
      riskReason,
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    return fallbackSafe(`Solana 安全体检网络异常: ${e.message}`);
  }
}

function fallbackSafe(reason) {
  return {
    safe: true,
    isHoneypot: false,
    buyTax: 0,
    sellTax: 0,
    cannotSellAll: false,
    isOpenSource: true,
    riskLevel: 'safe',
    riskReason: reason || '常规检测通过',
    checkedAt: new Date().toISOString(),
  };
}

/**
 * 对一个跨链套利机会进行买卖双端合约安全体检与貔貅裁决
 * @param {Object} opp 套利机会对象
 * @param {Object} [settings]
 * @returns {Promise<Object>} security 综合检查结果
 */
async function checkOpportunitySecurity(opp, settings = null) {
  if (!opp) return null;

  const [buySec, sellSec] = await Promise.all([
    opp.buyAddress ? checkTokenSecurity(opp.buyChain, opp.buyAddress, settings) : null,
    opp.sellAddress ? checkTokenSecurity(opp.sellChain, opp.sellAddress, settings) : null,
  ]);

  const isHoneypot = (buySec && buySec.isHoneypot) || (sellSec && sellSec.isHoneypot);
  const hasWarning = (buySec && buySec.riskLevel === 'warning') || (sellSec && sellSec.riskLevel === 'warning');
  const riskLevel = isHoneypot ? 'danger' : (hasWarning ? 'warning' : 'safe');

  let riskReason = '双端合约体检通过 · 0%税率';
  if (isHoneypot) {
    if (buySec?.isHoneypot && sellSec?.isHoneypot) {
      riskReason = `双端均含貔貅: 买[${buySec.riskReason}] / 卖[${sellSec.riskReason}]`;
    } else if (buySec?.isHoneypot) {
      riskReason = `买入端高危貔貅: ${buySec.riskReason}`;
    } else {
      riskReason = `卖出端高危貔貅: ${sellSec.riskReason}`;
    }
  } else if (hasWarning) {
    if (buySec?.riskLevel === 'warning' && sellSec?.riskLevel === 'warning') {
      riskReason = `买入[${buySec.riskReason}] | 卖出[${sellSec.riskReason}]`;
    } else if (buySec?.riskLevel === 'warning') {
      riskReason = `买入端: ${buySec.riskReason}`;
    } else {
      riskReason = `卖出端: ${sellSec.riskReason}`;
    }
  }

  const security = {
    safe: riskLevel === 'safe',
    hasRisk: isHoneypot || hasWarning,
    isHoneypot,
    riskLevel,
    riskReason,
    buySecurity: buySec,
    sellSecurity: sellSec,
    checkedAt: new Date().toISOString(),
  };

  // 如果检测到貔貅，强力阻断
  if (isHoneypot) {
    opp.verdict = 'fake';
    opp.suspicious = true;
  }

  opp.security = security;
  return security;
}

module.exports = {
  checkTokenSecurity,
  checkOpportunitySecurity,
  cacheKey,
};
