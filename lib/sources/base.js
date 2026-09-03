'use strict';
const { request } = require('../net');

/**
 * BaseBridgeAdapter - 所有跨链桥数据源适配器的抽象基类
 * 规范生命周期、统一错误捕获、代理支持与超时容错
 */
class BaseBridgeAdapter {
  /**
   * @param {Object} spec
   * @param {string} spec.id
   * @param {string} spec.name
   * @param {string} spec.siteUrl
   * @param {boolean} [spec.needsKey=false]
   * @param {string} [spec.keyName]
   * @param {string} [spec.note]
   */
  constructor(spec) {
    this.id = spec.id;
    this.name = spec.name;
    this.siteUrl = spec.siteUrl;
    this.needsKey = Boolean(spec.needsKey);
    this.keyName = spec.keyName || spec.id;
    this.note = spec.note || '';
  }

  /**
   * 检查配置中是否有当前适配器运行所需的凭证
   * @param {Object} settings
   * @returns {boolean}
   */
  hasCredentials(settings) {
    if (!this.needsKey) return true;
    const key = settings?.keys?.[this.keyName];
    return typeof key === 'string' && key.trim().length > 0;
  }

  /**
   * 模板方法：执行抓取并捕获顶级异常
   * @param {Object} ctx
   * @returns {Promise<{ok: boolean, transfers: Array, error?: string, partialError?: string}>}
   */
  async fetch(ctx) {
    if (this.needsKey && !this.hasCredentials(ctx.settings)) {
      return {
        ok: false,
        error: `缺少 API Key (${this.keyName})，请在设置中配置`,
        transfers: [],
      };
    }

    try {
      return await this._fetchTransfers(ctx);
    } catch (err) {
      return {
        ok: false,
        error: `${this.name} 抓取异常: ${err.message || String(err)}`,
        transfers: [],
      };
    }
  }

  /**
   * 兼容旧接口：直接调用 fetchTransfers
   */
  async fetchTransfers(ctx) {
    return this.fetch(ctx);
  }

  /**
   * 子类必须实现的核心抓取逻辑
   * @protected
   */
  async _fetchTransfers(ctx) {
    throw new Error(`[${this.name}] _fetchTransfers 尚未实现`);
  }

  /**
   * 帮助方法：将外部原始记录安全清洗为规范 transfer 契约
   * @protected
   */
  normalize(raw) {
    throw new Error(`[${this.name}] normalize 尚未实现`);
  }
}

module.exports = BaseBridgeAdapter;
