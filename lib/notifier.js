'use strict';
const net = require('./net');
const store = require('./store');

// 防止相同套利路线在短时间内重复刷屏轰炸
// key: `${symbol}:${buyChain}:${sellChain}` -> { lastNotifiedAt, lastSpread }
const recentNotified = new Map();
const COOLDOWN_MS = 30 * 60 * 1000; // 30 分钟去重冷却

function usdCompact(n) {
  const num = Number(n) || 0;
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toFixed(2);
}

/**
 * 发送一条 Telegram 消息
 */
async function sendTelegramMessage({ botToken, chatId, text, settings }) {
  if (!botToken || !chatId) {
    return { ok: false, error: '缺少 Telegram Bot Token 或 Chat ID' };
  }
  const s = settings || store.settings();
  const url = `https://api.telegram.org/bot${botToken.trim()}/sendMessage`;
  const res = await net.request(url, {
    method: 'POST',
    settings: s,
    timeout: 15000,
    body: {
      chat_id: chatId.trim(),
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    },
  });

  if (res.ok && res.json && res.json.ok) {
    return { ok: true, result: res.json.result };
  }
  const errDesc = res.json?.description || res.error || `HTTP 错误 ${res.status}`;
  return { ok: false, error: errDesc };
}

/**
 * 格式化套利机会的 Telegram 消息文本 (HTML 格式)
 */
function formatOpportunityTelegramMessage(o, baseUrl = 'http://127.0.0.1:8848') {
  const symbol = o.symbol || '未知资产';
  const spread = (Number(o.spreadPct) || 0).toFixed(2);
  const grade = o.qualityGrade || 'A';
  const score = o.qualityScore || 0;
  const buyChain = o.buyChainName || o.buyChain || '未知公链';
  const buyDex = o.buyDex || 'DEX';
  const buyPrice = o.buyPrice !== undefined ? `$${o.buyPrice}` : '未知';
  const buyLiq = usdCompact(o.buyLiquidityUsd);

  const sellChain = o.sellChainName || o.sellChain || '未知公链';
  const sellDex = o.sellDex || 'DEX';
  const sellPrice = o.sellPrice !== undefined ? `$${o.sellPrice}` : '未知';
  const sellLiq = usdCompact(o.sellLiquidityUsd);

  const timeStr = new Date(o.ts || Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
  const viewUrl = `${baseUrl.replace(/\/+$/, '')}/?tab=dash&symbol=${encodeURIComponent(symbol)}`;

  return [
    `🎯 <b>【Bridge Arb Radar 捕获跨链套利机会】</b>`,
    ``,
    `🪙 <b>标的资产</b>: <code>${symbol}</code>`,
    `📈 <b>净价差</b>: <b>+${spread}%</b>`,
    `⭐ <b>评级评分</b>: <b>${grade} 级 · ${score} 分</b> ${o.scoreComment ? `(<i>${o.scoreComment}</i>)` : ''}`,
    ``,
    `🟢 <b>低价成本买入端</b>:`,
    `   • 链/DEX: <b>${buyChain}</b> · ${buyDex}`,
    `   • 报价: <code>${buyPrice}</code>`,
    `   • 深度: $${buyLiq}`,
    ``,
    `🔴 <b>高价利润卖出端</b>:`,
    `   • 链/DEX: <b>${sellChain}</b> · ${sellDex}`,
    `   • 报价: <code>${sellPrice}</code>`,
    `   • 深度: $${sellLiq}`,
    ``,
    `⏱ <b>捕获时间</b>: ${timeStr}`,
    `🔗 <a href="${viewUrl}">打开雷达查看路线与 Gas 精算</a>`,
  ].join('\n');
}

/**
 * 测试发送一条 Telegram 消息
 */
async function testTelegram({ botToken, chatId, settings }) {
  const s = settings || store.settings();
  const token = botToken || s.notifications?.telegram?.botToken;
  const chat = chatId || s.notifications?.telegram?.chatId;
  if (!token || !chat) {
    return { ok: false, error: '请先填写完整的 Telegram Bot Token 与 Chat ID' };
  }

  const testText = [
    `🚀 <b>【Bridge Arb Radar 雷达测试通知】</b>`,
    ``,
    `✅ <b>Telegram 机器人推送连接成功！</b>`,
    `• 本地代理状态: <b>${s.useProxy ? '已开启 (' + (s.proxyUrl || '默认') + ')' : '未开启 (直连)'}</b>`,
    `• 报警触发门槛: <b>净价差 ≥ ${s.notifications?.minSpreadPct ?? 1.0}%</b>`,
    ``,
    `当系统自动轮巡或代币核验发现真实套利机会时，将实时推送通知至本会话。`,
  ].join('\n');

  return sendTelegramMessage({ botToken: token, chatId: chat, text: testText, settings: s });
}

/**
 * 处理机会推送 (Telegram)
 * @param {Array<object>} opportunities 机会列表
 * @param {object} opts
 */
async function notifyOpportunities(opportunities = [], opts = {}) {
  const s = opts.settings || store.settings();
  const tgConfig = s.notifications?.telegram;
  if (!tgConfig || !tgConfig.enabled || !tgConfig.botToken || !tgConfig.chatId) {
    return { ok: true, sent: 0, reason: 'telegram not enabled or not configured' };
  }

  const minSpread = Number(s.notifications?.minSpreadPct ?? 1.0);
  const force = Boolean(opts.force);

  // 过滤符合条件的机会
  const valid = opportunities.filter((o) => {
    if (!o) return false;
    if (o.verdict === 'fake' || o.isSymbolCollision || o.collisionRisk) return false;
    const spread = Number(o.spreadPct) || 0;
    return spread >= minSpread;
  });

  if (!valid.length) return { ok: true, sent: 0, reason: 'no opportunities met criteria' };

  const now = Date.now();
  let sent = 0;
  for (const o of valid) {
    const key = `${o.symbol}:${o.buyChain}:${o.sellChain}`.toLowerCase();
    const prev = recentNotified.get(key);

    if (!force && prev) {
      // 30 分钟内同一路线且价差没有显著增加（< 1.5%），跳过避免刷屏
      if (now - prev.lastNotifiedAt < COOLDOWN_MS && (o.spreadPct - prev.lastSpread) < 1.5) {
        continue;
      }
    }

    const text = formatOpportunityTelegramMessage(o, opts.baseUrl || 'http://127.0.0.1:8848');
    const res = await sendTelegramMessage({
      botToken: tgConfig.botToken,
      chatId: tgConfig.chatId,
      text,
      settings: s,
    });

    if (res.ok) {
      recentNotified.set(key, { lastNotifiedAt: now, lastSpread: o.spreadPct });
      sent++;
      // 短暂延时，避免触发 Telegram API 频控 (30 msg/sec limit)
      if (valid.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    } else {
      console.error('[notify] Telegram 发送失败:', res.error);
    }
  }

  return { ok: true, sent };
}

module.exports = {
  sendTelegramMessage,
  formatOpportunityTelegramMessage,
  testTelegram,
  notifyOpportunities,
};
