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
 * 清理并规整 Bot Token，智能处理各种用户常见格式错误：
 * 1. 去除前后空格或单双引号
 * 2. 去除用户误输入的 `bot` 前缀（如 `bot8750497694:...`）
 * 3. 去除完整 URL（如 `https://api.telegram.org/bot...`）
 * 4. 如果用户把冒号前的数字 ID 误当作 chatId 填入，而把 token 填了后半段，尝试智能重组
 */
function cleanBotToken(token, maybeChatId) {
  if (!token || typeof token !== 'string') return '';
  let t = token.trim().replace(/^['"]|['"]$/g, '');
  // 去除完整 URL
  const urlMatch = t.match(/api\.telegram\.org\/bot([^/]+)/i);
  if (urlMatch) {
    t = urlMatch[1].trim();
  }
  // 去除可能的 'bot' 前缀 (如 bot8750497694:...)
  if (t.toLowerCase().startsWith('bot') && /^\d/.test(t.slice(3))) {
    t = t.slice(3).trim();
  }
  // 如果 token 缺少冒号且可能是哈希部分，而 maybeChatId 是 8~12 位的纯数字 Bot ID
  if (!t.includes(':') && maybeChatId && /^\d{8,12}$/.test(String(maybeChatId).trim())) {
    t = `${String(maybeChatId).trim()}:${t}`;
  }
  return t;
}

/**
 * 获取机器人基本信息 (验证 token 是否有效)
 */
async function getBotInfo({ botToken, settings } = {}) {
  const s = settings || store.settings();
  const token = cleanBotToken(botToken || s.notifications?.telegram?.botToken);
  if (!token) return { ok: false, error: '缺少 Telegram Bot Token' };
  if (!token.includes(':')) {
    return {
      ok: false,
      error: 'Bot Token 格式不正确：必须形如 8750497694:AAEUstjc...，包含冒号及前面的机器人数字 ID。',
    };
  }

  const url = `https://api.telegram.org/bot${token}/getMe`;
  const res = await net.request(url, {
    method: 'GET',
    settings: s,
    timeout: 12000,
  });

  if (res.ok && res.json && res.json.ok) {
    return { ok: true, bot: res.json.result, token };
  }
  const desc = res.json?.description || res.error || `HTTP 错误 ${res.status}`;
  if (desc === 'Not Found') {
    return { ok: false, error: 'Telegram 返回 Not Found：说明 Bot Token 不存在或格式错误，请核对 @BotFather 的原消息。' };
  }
  return { ok: false, error: desc };
}

/**
 * 自动从机器人的最近消息中检测当前用户的 Chat ID
 */
async function detectChatId({ botToken, settings } = {}) {
  const s = settings || store.settings();
  const rawToken = botToken || s.notifications?.telegram?.botToken;
  const token = cleanBotToken(rawToken);
  if (!token) {
    return { ok: false, error: '请先填写完整的 Telegram Bot Token' };
  }

  // 先检查机器人有效性
  const infoRes = await getBotInfo({ botToken: token, settings: s });
  const botInfo = infoRes.ok ? infoRes.bot : null;
  const botUsername = botInfo?.username;

  const url = `https://api.telegram.org/bot${token}/getUpdates`;
  const res = await net.request(url, {
    method: 'GET',
    settings: s,
    timeout: 12000,
  });

  if (!res.ok || !res.json || !res.json.ok) {
    const desc = res.json?.description || res.error || `HTTP 错误 ${res.status}`;
    return { ok: false, error: desc, bot: botInfo };
  }

  const updates = res.json.result || [];
  if (!updates.length) {
    const hint = botUsername ? `@${botUsername}` : '您的 Telegram 机器人';
    return {
      ok: false,
      error: `暂未检测到消息记录。请先在 Telegram 中打开 ${hint}，点击「Start」(发送 /start)，然后再次点击「自动获取」！`,
      bot: botInfo,
    };
  }

  // 从后往前找最近一条消息会话
  for (let i = updates.length - 1; i >= 0; i--) {
    const u = updates[i];
    const msg = u.message || u.edited_message || u.channel_post || u.my_chat_member;
    const chat = msg?.chat;
    if (chat && chat.id) {
      const name = chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || '个人会话';
      return {
        ok: true,
        chatId: String(chat.id),
        chatName: name,
        chatType: chat.type,
        bot: botInfo,
      };
    }
  }

  return { ok: false, error: '未能从更新中解析出有效会话，请向机器人重新发送一条消息。', bot: botInfo };
}

/**
 * 发送一条 Telegram 消息
 */
async function sendTelegramMessage({ botToken, chatId, text, settings }) {
  if (!botToken || !chatId) {
    return { ok: false, error: '缺少 Telegram Bot Token 或 Chat ID' };
  }
  const s = settings || store.settings();
  const rawToken = String(botToken).trim();
  const rawChat = String(chatId).trim();

  let token = cleanBotToken(rawToken, rawChat);

  // 校验 Token 格式必须包含冒号
  if (!token.includes(':')) {
    return {
      ok: false,
      error: 'Bot Token 格式不正确：必须是完整格式（形如 8750497694:AAEUstjcXPve...）。请从 @BotFather 复制完整的 Token，勿遗漏冒号及前面的数字 Bot ID。',
    };
  }

  // 校验 Chat ID 不能与 Bot 自身的 ID 相同
  const botId = token.split(':')[0];
  if (rawChat === botId) {
    return {
      ok: false,
      error: `Chat ID 不能填写机器人自身的 ID (${botId})！机器人无法给自己发消息。请填入您个人的 Telegram 数字 ID（可在 Telegram 向 @userinfobot 发送消息获取，或向机器人发送 /start 后点击「自动获取 Chat ID」）。`,
    };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await net.request(url, {
    method: 'POST',
    settings: s,
    timeout: 15000,
    body: {
      chat_id: rawChat,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    },
  });

  if (res.ok && res.json && res.json.ok) {
    return { ok: true, result: res.json.result };
  }
  const desc = res.json?.description || res.error || `HTTP 错误 ${res.status}`;
  if (desc === 'Not Found') {
    return {
      ok: false,
      error: 'Telegram 返回 Not Found：通常说明 Bot Token 无效或不完整。请确保 Token 包含冒号前后的完整字符。',
    };
  }
  if (desc.includes("can't send messages to the bot")) {
    return {
      ok: false,
      error: `Chat ID 错误：${rawChat} 是机器人自身的 ID，机器人无法给自己发消息。请填入您本人的 Telegram ID。`,
    };
  }
  if (desc.includes('chat not found')) {
    return {
      ok: false,
      error: 'Telegram 提示 Chat not found：机器人尚未与该 Chat 建立会话。请先在 Telegram 中打开该机器人并点击「Start」(发送 /start)，然后重试。',
    };
  }
  return { ok: false, error: desc };
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
  cleanBotToken,
  getBotInfo,
  detectChatId,
  sendTelegramMessage,
  formatOpportunityTelegramMessage,
  testTelegram,
  notifyOpportunities,
};
