'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  view: 'dash',
  chains: [],
  walletFilter: {},
  tokenFilter: {},
};

// 数据源密钥配置：按「桥协议 / 链上数据」分类登记，用于保存后的「已填」统计与缺失提示。
// value 是展示名；Range 是唯一必填的桥数据源（无 Key 时该源会被跳过）。
const KEY_GROUPS = {
  bridge: { sKeyRange: 'Range' },
  chain: { sKeyEtherscan: 'Etherscan/Blockscan', sKeyDebank: 'DeBank' },
};
// 所有需要标记「已填」状态的输入框（含代理与自建 endpoint）
const KEY_INPUTS = [
  'sProxy',
  'sKeyRange', 'sEpRange',
  'sKeyEtherscan', 'sKeyDebank',
];

// ---------------- 工具 ----------------
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function short(a, n = 6) {
  if (!a) return '—';
  const s = String(a);
  return s.length <= n * 2 + 2 ? s : `${s.slice(0, n)}…${s.slice(-4)}`;
}
function num(v, d = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(d);
}
function usd(v) {
  const n = Number(v);
  return Number.isFinite(n) ? '$' + num(n, n < 10 ? 2 : 0) : '—';
}
function ago(ts) {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(diff)) return '—';
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}
// type: 'ok' 成功（绿）/ 'err' 失败（红，停留更久）/ 'info' 普通（默认黑）
function toast(msg, type = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (type && type !== 'info' ? ' toast-' + type : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), type === 'err' ? 4200 : 2600);
}

// 按钮点击统一包装：禁用防重复点击 + 显示忙碌文字 + 自动恢复 + 失败红色 toast（并可选就地提示）
async function withBtn(btn, busyText, fn, errSel) {
  if (!btn || btn.disabled) return;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyText;
  try {
    await fn();
  } catch (e) {
    const m = e.message || '操作失败';
    toast(m, 'err');
    if (errSel) setMsg(errSel, '✗ ' + m, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// 就地提示文本（带成功/失败配色），比灰色小字醒目
function setMsg(sel, text, type = 'ok') {
  const el = $(sel);
  if (!el) return;
  el.textContent = text;
  el.className = 'msg msg-' + type;
}

async function api(path, opts = {}) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  const j = await res.json().catch(() => ({ ok: false, error: '解析失败' }));
  if (!j.ok) throw new Error(j.error || '请求失败');
  return j;
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('已复制'); } catch { toast(text); }
}
// 触发服务端文件下载（服务端已设置 Content-Disposition: attachment）
function downloadFile(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function exportData(type, format) {
  downloadFile(`/api/export?type=${type}&format=${format}`);
  toast(`正在导出 ${type}（${format.toUpperCase()}）…`);
}

// ---------------- 机会裁决徽标 / 合约核验入口 ----------------
// 把一条机会/一条腿的 verdict 渲染成统一的语义徽标（前端多处复用）：
//   confirmed / official → 绿「✓ 已验证」；suspicious → 黄「? 存疑」；fake → 红「✗ 假币」。
function verdictChip(v) {
  const vv = v === 'official' ? 'confirmed' : v; // official 视同 confirmed（都过了官方合约验证）
  if (vv === 'confirmed') return '<span class="badge badge-ok" title="两腿合约地址均通过官方验证">✓ 已验证</span>';
  if (vv === 'fake') return '<span class="badge badge-err" title="价格偏离官方锚点 ≥3× 或链上标识不符，假币，禁止交易">✗ 假币</span>';
  return '<span class="badge badge-warn" title="涉及未验证/同名合约，动手前务必点 explorer 人工核验">? 存疑</span>';
}
// 单腿的合约核验链接：给出该链 explorer 上的「代币合约页」链接（无地址/无法推导则回退 DexScreener 交易对）
function legLink(label, chainName, dex, explorerUrl, address, pairUrl) {
  const ex = explorerUrl
    ? `<a class="btn btn-sm" href="${esc(explorerUrl)}" target="_blank" rel="noreferrer" title="官方 explorer 核验合约（${esc(address || '')}）">合约</a>`
    : (address
      ? `<button class="btn btn-sm" onclick="copy('${esc(address)}');" title="复制合约地址 ${esc(address)}">复制</button>`
      : '');
  const ds = pairUrl ? `<a class="btn btn-sm" href="${esc(pairUrl)}" target="_blank" rel="noreferrer" title="${esc(label)} · ${esc(dex || '')} 交易对">${esc(label)}</a>` : '';
  return `<span class="nowrap">${ex}${ds}</span>`;
}

// ---------------- 视图切换 ----------------
function switchView(name) {
  state.view = name;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'dash') loadDash();
  if (name === 'feed') loadFeed();
  if (name === 'wallets') loadWallets();
  if (name === 'tokens') loadTokens();
  if (name === 'decide') loadDecide();
  if (name === 'sources') { loadSources(); loadSettings(); loadRegistryStatus(); loadStorageStatus(); }
}

// ---------------- 决策状态徽标 / 颜色 ----------------
const DEC_STATUS_LABEL = { todo: '待定', watching: '已跟进', executed: '已执行', closed: '已结算', dropped: '已放弃' };
// 徽标 class：已跟进(蓝)/已执行(琥珀)/已结算(绿)/已放弃(灰)/待定(默认)
const DEC_STATUS_BADGE = { watching: 'badge-c', executed: 'badge-b', closed: 'badge-ok', dropped: 'badge-d', todo: '' };
function decStatusChip(status) {
  const s = status || 'todo';
  const label = DEC_STATUS_LABEL[s] || s;
  const cls = DEC_STATUS_BADGE[s] || '';
  return `<span class="badge ${cls}" title="人工决策状态">${esc(label)}</span>`;
}
function decPnlChip(usd) {
  const n = Number(usd) || 0;
  if (!n) return '<span class="muted small">—</span>';
  const pos = n >= 0;
  return `<span class="badge ${pos ? 'badge-ok' : 'badge-err'}" style="font-weight:600">${pos ? '+' : ''}${num(n, 2)}$</span>`;
}


// ---------------- 总览 ----------------
async function loadDash() {
  try {
    const s = await api('/api/state');
    const c = s.counts;
    const maxT = c.maxTransfers || 8000;
    const isCapped = c.transfers >= maxT;
    const tVal = isCapped ? `${c.transfers.toLocaleString()} / ${maxT.toLocaleString()}` : c.transfers.toLocaleString();
    const tDesc = isCapped ? `24h 新增 ${c.transfers24h} · FIFO 滚动` : `24h 新增 ${c.transfers24h}`;
    const tTip = isCapped
      ? `已达到系统设定的容量上限 (${maxT.toLocaleString()} 条)。采用 FIFO（先进先出）机制滚动更新：新流水入库时会自动淘汰最旧流水，确保毫秒级极速比价与轻量占用。`
      : `当前收录流水：${c.transfers.toLocaleString()} 条`;

    $('#statCards').innerHTML = [
      ['钱包库', c.wallets, `${c.walletsA} 个 A 级`],
      ['代币库', c.tokens, `${c.unknownTokens} 个陌生代币`],
      ['桥流水', tVal, tDesc, tTip],
      ['价差机会', c.opportunities, '超过阈值的记录'],
      ['扫描次数', s.lastScanAt ? '已运行' : '未运行', s.lastScanAt ? ago(s.lastScanAt) : '点右上角立即扫描'],
    ].map(([k, v, d, tip]) => `<div class="card"${tip ? ` title="${esc(tip)}"` : ''}><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="d">${esc(d)}</div></div>`).join('');

    $('#oppCount').textContent = `共 ${c.opportunities} 条`;
    // 整体裁决回退：老数据无 verdict 字段时按原有可疑标记推导
    const oppVerdict = (o) => o.verdict || (o.verified === false || o.suspicious ? 'suspicious' : 'confirmed');
    const legV = (o, side) => {
      const v = side === 'buy' ? o.buyVerdict : o.sellVerdict;
      return v || oppVerdict(o);
    };
    $('#dashOpps').innerHTML = s.opportunities.length
      ? s.opportunities.map((o) => {
        const v = oppVerdict(o);
        const vBadge = verdictChip(v);
        // 假币/存疑的价差本身不可信：价差徽标不强推红色高亮，改用中性色避免误导
        const spreadBadge = v === 'confirmed'
          ? (o.spreadPct >= 3 ? 'badge-a' : 'badge-b')
          : 'badge-warn';
        const warn = v === 'fake'
          ? '<div class="small" style="color:#b42318;font-weight:600">✗ 判假币：价格偏离官方锚点 ≥3× 或链上标识不符，是假币 vs 真币的假价差，禁止交易。</div>'
          : v === 'suspicious' ? '<div class="small" style="color:#b45309">? 存疑：涉及未验证/同名合约，动手前务必点两侧「合约」链接核对地址。</div>' : '';
        return `<div class="row opp ${v === 'fake' ? 'opp-fake' : v === 'suspicious' ? 'opp-susp' : ''}">
          <span class="badge ${spreadBadge}" title="两腿价差">${esc(o.spreadPct)}%</span>
          <div class="grow">
            <div>
              <b>${esc(o.symbol || '?')}</b> ${verdictChip(v)}
            </div>
            <div class="muted small">
              买 <b>${esc(o.buyChainName || o.buyChain)}</b> @${esc(o.buyPrice)}${o.buyDex ? ' <span class="mono">' + esc(o.buyDex) + '</span>' : ''} · ${verdictChip(legV(o, 'buy'))}
              → 卖 <b>${esc(o.sellChainName || o.sellChain)}</b> @${esc(o.sellPrice)}${o.sellDex ? ' <span class="mono">' + esc(o.sellDex) + '</span>' : ''} · ${verdictChip(legV(o, 'sell'))}
            </div>
            ${warn}
          </div>
          <span class="muted small nowrap" title="两条腿中较小的可承载流动性">流动性 ${usd(o.minLiquidityUsd)}</span>
          <span class="opp-links nowrap">
            ${legLink('买·DEX', o.buyChainName, o.buyDex, o.buyExplorer, o.buyAddress, o.buyUrl)}
            ${legLink('卖·DEX', o.sellChainName, o.sellDex, o.sellExplorer, o.sellAddress, o.sellUrl)}
          </span>
        </div>`;
      }).join('')
      : '<div class="empty">暂无机会。先扫描积累桥流，或到代币库手动比价。</div>';

    $('#dashWallets').innerHTML = s.topWallets.length
      ? s.topWallets.map((w) => `
        <div class="row">
          <span class="badge badge-${String(w.grade || 'd').toLowerCase()}">${esc(w.grade || 'D')}</span>
          <span class="mono">${esc(short(w.address, 10))}</span>
          <div class="grow muted small">
            ${(w.autoTags || []).map((t) => `<span class="badge">${esc(t)}</span>`).join(' ')}
          </div>
          <span class="small">${w.bridgeCount || 0} 桥 / <b>${w.capitalCycles || 0}</b> 资金闭环</span>
          <button class="btn btn-sm" data-wallet="${esc(w.address)}">详情</button>
        </div>`).join('')
      : '<div class="empty">钱包库还是空的，去桥流扫一波。</div>';

    $('#dashLog').innerHTML = (s.recentLog || []).map((l) => {
      const r = l.report || {};
      const srcs = Object.entries(r.sources || {}).map(([k, v]) => `${k}:${v.ok ? '+' + v.count : '×'}`).join(' ');
      return `<div class="l"><span class="t">${esc(ago(l.ts))}</span><span>${esc(l.type)} 新增${esc(r.added ?? 0)} 钱包+${esc(r.walletsNew ?? 0)} 代币+${esc(r.tokensNew ?? 0)}</span><span class="muted">${esc(srcs)}</span></div>`;
    }).join('') || '<div class="empty">暂无日志</div>';

    $('#scanStatus').className = 'pill ' + (s.scanning ? 'pill-run' : s.lastScanAt ? 'pill-ok' : 'pill-idle');
    $('#scanStatus').textContent = s.scanning ? '扫描中…' : s.lastScanAt ? '上次 ' + ago(s.lastScanAt) : '未扫描';
  } catch (e) {
    toast('总览加载失败：' + e.message);
  }
}

// ---------------- 决策 / 素材看板 ----------------
// 对雷达报出的每条价差机会做人工裁决（跟进/执行/结算/放弃），并沉淀实际盈亏日志。
// 决策记录存于独立的 meta 键，不会被每次自动扫描整体覆盖的机会表冲掉。
const DEC_CARD_KEYS = [
  ['未标记', 'unmarked', '待人工裁决'],
  ['已跟进', 'watching', '研究中 / 等机会'],
  ['已执行', 'executed', '已挂单或成交'],
  ['已结算', 'closed', '已平仓落袋'],
  ['已放弃', 'dropped', '跳过 / 不追'],
];
async function loadDecide() {
  const st = $('#decStatus').value || 'all';
  try {
    const j = await api('/api/decisions?status=' + encodeURIComponent(st) + '&limit=500');
    const bs = j.byStatus || {};
    const total = j.total || 0;
    // 顶部汇总
    $('#decMeta').textContent = `共 ${total} 条机会 · 已实现盈亏 ${(Number(j.realizedPnlUsd) || 0) >= 0 ? '+' : ''}${num(Number(j.realizedPnlUsd) || 0, 2)}$`;
    // 状态小卡（含未标记占位）
    $('#decCards').innerHTML = DEC_CARD_KEYS.map(([label, key, desc]) => {
      const c = bs[key] ?? 0;
      const cls = key === 'unmarked' ? '' : ' dec-' + key;
      return `<div class="card${cls}"><div class="k">${esc(label)}</div><div class="v">${esc(c)}</div><div class="d">${esc(desc)}</div></div>`;
    }).join('');
    // 列表表头计数
    $('#decListMeta').textContent = st === 'all' ? '全部' : st === 'unmarked' ? '未标记' : DEC_STATUS_LABEL[st] || st;
    const tb = $('#decTable tbody');
    tb.innerHTML = (j.items || []).length ? (j.items || []).map((r) => renderDecRow(r)).join('')
      : '<tr><td colspan="9"><div class="empty">该分组暂无机会。先扫描积累价差机会，再到「总览」标记跟进。</div></td></tr>';
  } catch (e) {
    toast('决策看板加载失败：' + e.message, 'err');
  }
}

// 机会的裁决推导：official/confirmed → 已验证绿；fake → 假币红；suspicious / 未验证 → 存疑黄
function oppVerdictOf(r) {
  return r.verdict || (r.verified === false || r.suspicious ? 'suspicious' : 'confirmed');
}
function renderDecRow(r) {
  const dec = r.decision || {};
  const st = r.status || 'todo';
  const v = oppVerdictOf(r);
  const spreadBadge = v === 'confirmed' ? (r.spreadPct >= 3 ? 'badge-a' : 'badge-b') : 'badge-warn';
  // 最新一条日志 + 备注做摘要
  const latest = (dec.journal || [])[0];
  const summary = latest ? `<span class="small">${esc(ago(latest.ts))} ${decStatusChip(latest.status)} ${esc(latest.text || '')}${latest.pnlDeltaUsd ? ' · ' + (latest.pnlDeltaUsd > 0 ? '+' : '') + num(latest.pnlDeltaUsd, 2) + '$' : ''}</span>` : (dec.note ? `<span class="small muted">备注：${esc(dec.note)}</span>` : '<span class="muted small">—</span>');
  const markBtn = st === 'todo' && !dec.note && !(dec.journal || []).length
    ? `<button class="btn btn-sm" data-dec-setstatus="${esc(r.symbol)}|${esc(r.buyChain)}|${esc(r.sellChain)}" data-dec-status="watching" title="标记为已跟进">标记</button>`
    : '';
  return `<tr>
    <td>${decStatusChip(st)}</td>
    <td><b>${esc(r.symbol || '?')}</b> ${verdictChip(v)}</td>
    <td class="right"><span class="badge ${spreadBadge}">${esc(r.spreadPct)}%</span></td>
    <td>
      <span class="muted small">买 ${esc(r.buyChainName || r.buyChain)} @${esc(r.buyPrice ?? '—')}</span>
      ${verdictChip(r.buyVerdict || v)}
      <div class="opp-links nowrap">${legLink('买·DEX', r.buyChainName, r.buyDex, r.buyExplorer, r.buyAddress, r.buyUrl)}</div>
    </td>
    <td>
      <span class="muted small">卖 ${esc(r.sellChainName || r.sellChain)} @${esc(r.sellPrice ?? '—')}</span>
      ${verdictChip(r.sellVerdict || v)}
      <div class="opp-links nowrap">${legLink('卖·DEX', r.sellChainName, r.sellDex, r.sellExplorer, r.sellAddress, r.sellUrl)}</div>
    </td>
    <td class="right">${decPnlChip(dec.realizedPnlUsd)}</td>
    <td><div class="dec-sum">${summary}<button class="btn btn-sm" data-dec-log="${esc(r.symbol)}|${esc(r.buyChain)}|${esc(r.sellChain)}" title="追加行动/盈亏日志">日志</button></div></td>
    <td class="muted small nowrap" title="${esc(r.ts || '')}">${ago(r.ts)}${r.hits > 1 ? ` <span class="badge">×${esc(r.hits)}</span>` : ''}</td>
    <td class="nowrap">
      <select class="dec-status-sel" data-dec-status="${esc(r.symbol)}|${esc(r.buyChain)}|${esc(r.sellChain)}">
        ${['todo', 'watching', 'executed', 'closed', 'dropped'].map((s) => `<option value="${s}"${s === st ? ' selected' : ''}>${esc(DEC_STATUS_LABEL[s] || s)}</option>`).join('')}
      </select>
      ${markBtn}
      ${(dec.note || (dec.journal || []).length) ? `<button class="btn btn-sm dec-remove" data-dec-remove="${esc(r.symbol)}|${esc(r.buyChain)}|${esc(r.sellChain)}" title="清空该条人工记录，重置为未标记">清空</button>` : ''}
    </td>
  </tr>`;
}

// 打开「追加行动/盈亏」抽屉
function openDecLog(sym, buy, sell) {
  const dw = $('#drawer');
  dw.classList.add('open');
  $('#dwTitle').innerHTML = `行动 / 盈亏 · <span class="mono">${esc(sym)}</span> <span class="muted small">${esc(buy)} → ${esc(sell)}</span>`;
  $('#dwContent').innerHTML = `
    <form id="decLogForm" class="dec-log-form">
      <input type="hidden" id="dlSym" value="${esc(sym)}"><input type="hidden" id="dlBuy" value="${esc(buy)}"><input type="hidden" id="dlSell" value="${esc(sell)}">
      <label>行动 / 备注（必填）<textarea id="dlText" rows="3" required placeholder="如：已按 $1.02 买入、等 $1.05 挂单、观察流动性不足暂缓…"></textarea></label>
      <div class="row gap">
        <label class="grow">推进状态
          <select id="dlStatus">
            <option value="">（保持不变）</option>
            ${['todo', 'watching', 'executed', 'closed', 'dropped'].map((s) => `<option value="${s}">${esc(DEC_STATUS_LABEL[s] || s)}</option>`).join('')}
          </select>
        </label>
        <label>已实现盈亏 Δ$（可选）
          <input type="number" step="0.01" id="dlPnl" placeholder="如 12.50 / -8">
        </label>
      </div>
      <button type="submit" class="btn btn-block">保存日志</button>
    </form>
    <p class="muted small" style="margin-top:8px">盈亏填正数记盈利、负数记亏损；每次保存累加到「已实现盈亏」。</p>`;
  const f = $('#decLogForm');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const text = $('#dlText').value.trim();
    if (!text) return toast('请填写行动内容', 'err');
    try {
      const j = await api('/api/decisions/log', {
        method: 'POST',
        body: JSON.stringify({
          symbol: sym, buyChain: buy, sellChain: sell,
          text,
          status: $('#dlStatus').value || undefined,
          pnlDeltaUsd: $('#dlPnl').value === '' ? undefined : Number($('#dlPnl').value),
        }),
      });
      toast('已记录', 'ok');
      dw.classList.remove('open');
      loadDecide();
    } catch (err) { toast(err.message, 'err'); }
  };
}

async function decSetStatus(sym, buy, sell, status) {
  if (!status) return;
  try {
    await api('/api/decisions/status', { method: 'POST', body: JSON.stringify({ symbol: sym, buyChain: buy, sellChain: sell, status }) });
    toast(`已标记为「${DEC_STATUS_LABEL[status] || status}」`, 'ok');
    loadDecide();
  } catch (e) { toast(e.message, 'err'); }
}

async function decRemove(sym, buy, sell) {
  if (!confirm(`清空「${sym} ${buy} → ${sell}」的人工记录？该机会会回到未标记状态。`)) return;
  try {
    await api('/api/decisions/remove', { method: 'POST', body: JSON.stringify({ symbol: sym, buyChain: buy, sellChain: sell }) });
    toast('已清空', 'ok');
    loadDecide();
  } catch (e) { toast(e.message, 'err'); }
}

// ---------------- 管道看板 ----------------
// 轮询状态：只在页面可见时跑，扫描结束或计数变化时刷新当前视图并闪烁提示。
const poll = { timer: null, tick: null, busy: false, lastCounts: null, nextScanAt: null, autoEnabled: false, scanning: false };

const PIPE_CARDS = [
  ['桥流水', 'transfers', '条记录'],
  ['钱包库', 'wallets', '个地址'],
  ['代币库', 'tokens', '个代币'],
  ['价差机会', 'opportunities', '条'],
];

function fmtDur(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return Math.round(n) + 'ms';
  const s = n / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  return Math.floor(s / 60) + 'm' + Math.round(s % 60) + 's';
}

function fmtCountdown(ms) {
  if (ms <= 0) return '正在扫描…';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' 秒';
  return Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒';
}

function fmtMs(ms) {
  if (ms == null || ms < 0) return '-';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return m + 'm' + String(s).padStart(2, '0') + 's';
}

function diffCounts(counts) {
  const changed = new Set();
  if (!poll.lastCounts) { poll.lastCounts = counts; return changed; }
  for (const k of Object.keys(counts)) {
    if (poll.lastCounts[k] !== counts[k]) changed.add(k);
  }
  poll.lastCounts = counts;
  return changed;
}

function renderPipeCards(counts, changed) {
  const maxT = counts?.maxTransfers || 8000;
  $('#pipeCards').innerHTML = PIPE_CARDS.map(([label, key, unit]) => {
    const flash = changed && changed.has(key) ? ' flash' : '';
    let val = counts?.[key] ?? 0;
    let desc = unit;
    let tip = '';
    if (key === 'transfers') {
      const isCapped = val >= maxT;
      if (isCapped) {
        val = `${Number(val).toLocaleString()} / ${Number(maxT).toLocaleString()}`;
        desc = `已达容量上限 · 滚动保留最新`;
        tip = `系统默认保留最新 ${maxT.toLocaleString()} 条流水（FIFO 先进先出机制）。新流水入库会自动淘汰最老流水以维持极速计算与轻量内存。`;
      } else {
        val = Number(val).toLocaleString();
        tip = `当前保留流水 ${val} 条（上限 ${maxT.toLocaleString()} 条）`;
      }
    }
    return `<div class="card${flash}" data-count="${esc(key)}"${tip ? ` title="${esc(tip)}"` : ''}><div class="k">${esc(label)}</div><div class="v">${esc(val)}</div><div class="d">${esc(desc)}</div></div>`;
  }).join('');
}

function renderFunnel(funnel) {
  const el = $('#funnel');
  if (!funnel || !funnel.length) {
    el.innerHTML = '<div class="empty">还没有扫描记录，点右上角「立即扫描」生成漏斗。</div>';
    return;
  }
  const maxIn = Math.max(...funnel.map((s) => s.in || 0), 1);
  el.innerHTML = funnel.map((s) => {
    const pct = Math.max(2, ((s.out || 0) / maxIn) * 100);
    const empty = !s.skipped && (s.out || 0) === 0 && (s.in || 0) > 0;
    const nums = s.skipped
      ? '<span class="muted">未运行（本次未开启比价）</span>'
      : `<b>${esc(s.out)}</b> / ${esc(s.in)} · ${esc(s.rate)}%${s.dropped ? ` <span class="drop">-${esc(s.dropped)}</span>` : ''}`;
    return `<div class="funnel-row${s.skipped ? ' is-skipped' : ''}${empty ? ' is-empty' : ''}">
      <span class="funnel-label">${esc(s.label)} <i>${esc(s.unit || '')}</i></span>
      <span class="funnel-track"><span class="funnel-fill" style="width:${pct.toFixed(1)}%"></span></span>
      <span class="funnel-nums">${nums}</span>
      <span class="funnel-note">${esc(s.note || '')}</span>
    </div>`;
  }).join('');
}

function renderPipeSources(report) {
  const el = $('#pipeSources');
  const srcs = (report && report.sources) || {};
  const keys = Object.keys(srcs).filter((k) => k !== 'priceError');
  if (!keys.length) { el.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  el.innerHTML = keys.map((k) => {
    const v = srcs[k] || {};
    const right = v.ok
      ? `<b>+${esc(v.count)}</b> <span class="muted small">条进入去重</span>`
      : `<span class="badge badge-err">失败</span> <span class="muted small">${esc(v.error || '')}</span>`;
    return `<div class="row"><span class="badge">${esc(k)}</span><div class="grow">${right}</div></div>`;
  }).join('') + (srcs.priceError ? `<div class="row"><span class="badge badge-warn">比价</span><div class="grow muted small">${esc(srcs.priceError.error || '比价阶段出错')}</div></div>` : '');
}

// 顶栏与管道页各有一个状态 pill，内容一致，一起更新
function updateScanPill(j) {
  const cls = 'pill ' + (j.scanning ? 'pill-run' : j.lastScanAt ? 'pill-ok' : 'pill-idle');
  const txt = j.scanning ? '扫描中…' : j.lastScanAt ? '上次 ' + ago(j.lastScanAt) : '未扫描';
  for (const sel of ['#scanStatus', '#pipeStatus']) {
    const el = $(sel);
    if (!el) continue;
    el.className = cls;
    el.textContent = txt;
  }
}

function tickCountdown() {
  const el = $('#pipeNext');
  if (!el) return;
  if (!poll.autoEnabled) { el.textContent = '自动扫描未开启（数据源页可开启）'; return; }
  if (poll.scanning) { el.textContent = '扫描进行中…'; return; }
  if (!poll.nextScanAt) { el.textContent = '等待调度…'; return; }
  el.textContent = '下次扫描 ' + fmtCountdown(new Date(poll.nextScanAt).getTime() - Date.now());
}

function applyPipeline(j, changed) {
  poll.nextScanAt = j.nextScanAt;
  poll.autoEnabled = j.autoEnabled;
  renderPipeCards(j.counts, changed);
  renderFunnel(j.funnel);
  renderPipeSources(j.lastScan);
  const r = j.lastScan || {};
  const t = r.timings || {};
  $('#funnelMeta').textContent = r.finishedAt
    ? `最近一次扫描 ${ago(r.finishedAt)} · 新增 ${r.added || 0} 条 · 机会 +${r.opportunitiesNew || 0} · 总耗时 ${fmtMs(t.totalMs)}（拉取 ${fmtMs(t.fetchMs)} / 沉淀 ${fmtMs(t.storeMs)} / 比价 ${fmtMs(t.priceMs)}）`
    : '尚无扫描记录';
  updateScanPill(j);
  tickCountdown();
  if ($('#pipeFresh')) $('#pipeFresh').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

async function loadPipeline() {
  try {
    const j = await api('/api/pipeline');
    applyPipeline(j, diffCounts(j.counts));
  } catch (e) {
    toast('管道数据加载失败：' + e.message, 'err');
  }
}

async function pollOnce() {
  if (poll.busy || document.hidden) return;
  poll.busy = true;
  try {
    const j = await api('/api/pipeline');
    const wasScanning = poll.scanning;
    poll.scanning = j.scanning;
    const changed = diffCounts(j.counts);
    updateScanPill(j);

    if (wasScanning && !j.scanning) {
      // 扫描刚结束：当前视图整页刷新，让用户直接看到新数据
      if (state.view === 'pipeline') applyPipeline(j, changed);
      else if (state.view === 'dash') loadDash();
      else if (state.view === 'feed') loadFeed();
      toast(`扫描完成：新增 ${j.lastScan?.added || 0} 条`, 'ok');
      return;
    }
    if (state.view === 'pipeline') { applyPipeline(j, changed); return; }
    if (changed.size) {
      const label = { transfers: '流水', wallets: '钱包', tokens: '代币', opportunities: '机会' };
      toast('数据更新：' + [...changed].map((k) => label[k] || k).join('、'), 'ok');
    }
  } catch {
    // 轮询失败静默处理，避免每 10 秒弹一次错误
  } finally {
    poll.busy = false;
  }
}

function startPolling() {
  if (poll.timer) clearInterval(poll.timer);
  if (poll.tick) clearInterval(poll.tick);
  poll.timer = null; poll.tick = null;
  const on = $('#pAutoRefresh') && $('#pAutoRefresh').checked;
  const sec = Number(($('#pRefreshSec') || {}).value || 10);
  // 倒计时每秒跑一次（纯本地计算不发包），数据请求按所选间隔
  poll.tick = setInterval(tickCountdown, 1000);
  if (!on) return;
  poll.timer = setInterval(pollOnce, sec * 1000);
}

// ---------------- 桥流 ----------------
async function loadFeed() {
  const p = new URLSearchParams({
    source: $('#fSource').value, chain: $('#fChain').value, q: $('#fQuery').value.trim(),
    unknown: $('#fUnknown').checked ? '1' : '', minUsd: $('#fMinUsd').value, hours: $('#fHours').value, limit: 300,
  });
  try {
    const j = await api('/api/transfers?' + p.toString());
    $('#feedCount').textContent = `共 ${j.total} 条，显示 ${j.items.length} 条`;
    $('#feedTable tbody').innerHTML = j.items.length ? j.items.map((t) => {
      const sym = String(t.tokenSymbol || '?').toUpperCase();
      const unknown = sym && !KNOWN.has(sym);
      return `<tr>
        <td class="nowrap muted small">${esc(ago(t.timestamp))}</td>
        <td><span class="badge">${esc(t.source)}</span></td>
        <td class="nowrap">${esc(t.fromChain || '?')} → ${esc(t.toChain || '?')}</td>
        <td>${unknown ? '<span class="badge badge-unknown">陌生</span> ' : ''}<b>${esc(sym)}</b></td>
        <td class="right num">${esc(num(t.amount))}</td>
        <td class="right num">${esc(usd(t.amountUsd))}</td>
        <td class="mono" title="${esc(t.sender || '')}">${esc(short(t.sender))}</td>
        <td class="mono" title="${esc(t.receiver || '')}">${esc(short(t.receiver))}</td>
        <td class="nowrap">
          ${t.sender ? `<button class="btn btn-sm" data-wallet="${esc(t.sender)}">看钱包</button>` : ''}
          ${t.explorer ? `<a class="btn btn-sm" href="${esc(t.explorer)}" target="_blank" rel="noreferrer">tx</a>` : ''}
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="9"><div class="empty">没数据。去「数据源」点立即扫描，或手动导入。</div></td></tr>';
  } catch (e) {
    toast('桥流加载失败：' + e.message);
  }
}

// ---------------- 钱包 ----------------
async function loadWallets() {
  const p = new URLSearchParams({
    q: $('#wQuery').value.trim(), grade: $('#wGrade').value, sort: $('#wSort').value, limit: 300,
    hideContracts: $('#wHideContracts').checked ? '1' : '',
  });
  const j = await api('/api/wallets?' + p.toString());
  $('#walletTable tbody').innerHTML = j.items.length ? j.items.map((w) => `
    <tr>
      <td><span class="badge badge-${String(w.grade || 'd').toLowerCase()}">${esc(w.grade || 'D')}</span></td>
      <td class="mono">
        <a href="https://debank.com/profile/${esc(w.address)}" target="_blank" rel="noreferrer" title="DeBank 主页">${esc(short(w.address, 10))}</a>
        <button class="btn btn-sm" data-copy="${esc(w.address)}">复制</button>
        ${w.starred ? '<span class="badge badge-star">★</span>' : ''}
      </td>
      <td class="right num"><b>${esc(w.score || 0)}</b></td>
      <td class="right num">${esc(w.bridgeCount || 0)}</td>
      <td class="right num">${w.roundtrips ? `<b>${esc(w.roundtrips)}</b>` : '<span class="muted">0</span>'}</td>
      <td class="right num" title="代币出去、资金回来的完整套利闭环">${w.capitalCycles ? `<span class="badge badge-a">${esc(w.capitalCycles)}</span>` : '<span class="muted">0</span>'}</td>
      <td class="right num">${esc(w.exoticCount || 0)}</td>
      <td class="small muted">${esc(Object.keys(w.chains || {}).length)} 条</td>
      <td>${(w.autoTags || []).map((t) => `<span class="badge ${t === '疑似桥合约' ? 'badge-err' : ''}">${esc(t)}</span>`).join(' ')}${(w.tags || []).map((t) => `<span class="badge badge-ok">${esc(t)}</span>`).join(' ')}</td>
      <td class="nowrap muted small">${esc(ago(w.lastSeen))}</td>
      <td class="nowrap">
        <button class="btn btn-sm" data-wallet="${esc(w.address)}">详情</button>
        <button class="btn btn-sm" data-star="${esc(w.address)}">${w.starred ? '取消★' : '★'}</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="11"><div class="empty">钱包库为空。扫描桥流后会自动沉淀地址。</div></td></tr>';
}

async function openWallet(addr) {
  const dw = $('#drawer');
  dw.classList.add('open');
  $('#dwTitle').innerHTML = `钱包 <span class="mono">${esc(short(addr, 12))}</span>`;
  $('#dwContent').innerHTML = '<div class="empty">加载中…</div>';
  let w;
  try {
    const j = await api('/api/wallets?q=' + encodeURIComponent(addr));
    w = (j.items || []).find((x) => x.address.toLowerCase() === addr.toLowerCase());
  } catch (e) { /* ignore */ }
  if (!w) { $('#dwContent').innerHTML = '<div class="empty">未找到该钱包</div>'; return; }

  const chainList = Object.entries(w.chains || {}).sort((a, b) => b[1] - a[1]);
  const tokenList = Object.entries(w.tokens || {}).sort((a, b) => b[1] - a[1]);
  $('#dwContent').innerHTML = `
    <div class="kv">
      <div class="k">地址</div><div class="mono">${esc(w.address)} <button class="btn btn-sm" data-copy="${esc(w.address)}">复制</button></div>
      <div class="k">评分</div><div><span class="badge badge-${String(w.grade || 'd').toLowerCase()}">${esc(w.grade)}</span> ${esc(w.score)} 分 · 桥 ${esc(w.bridgeCount || 0)} 次 · 同币往返 ${esc(w.roundtrips || 0)} · <b>资金闭环 ${esc(w.capitalCycles || 0)}</b> · 最大单笔 ${esc(usd(w.maxUsd))}</div>
      <div class="k">首次/最近</div><div>${esc(ago(w.firstSeen))} / ${esc(ago(w.lastSeen))}</div>
      <div class="k">涉及链</div><div>${chainList.map(([c, n]) => `<span class="badge">${esc(c)} ×${esc(n)}</span>`).join(' ')}</div>
      <div class="k">自动标签</div><div>${(w.autoTags || []).map((t) => `<span class="badge">${esc(t)}</span>`).join(' ') || '<span class="muted">无</span>'}</div>
      <div class="k">我的标签</div><div class="tag-input" id="dwTags">${(w.tags || []).map((t) => `<span class="tag">${esc(t)} <button data-rmtag="${esc(t)}">×</button></span>`).join('')}<input id="dwTagInput" placeholder="加标签后回车" style="width:120px" /></div>
      <div class="k">备注</div><div><input id="dwNotes" value="${esc(w.notes || '')}" style="width:100%" placeholder="记录这个地址在干什么" /></div>
      <div class="k">外链</div><div>
        <a class="btn btn-sm" href="https://debank.com/profile/${esc(w.address)}" target="_blank" rel="noreferrer">DeBank 主页</a>
        <a class="btn btn-sm" href="https://debank.com/profile/${esc(w.address)}/history" target="_blank" rel="noreferrer">DeBank 流水</a>
      </div>
    </div>
    ${(w.capitalCycleDetails || []).length ? `
    <div style="margin-top:16px">
      <h3 style="font-size:13px;margin-bottom:8px">资金闭环明细（${esc(w.capitalCycles)}）</h3>
      <div class="list">${w.capitalCycleDetails.map((c) => `
        <div class="row">
          <span class="badge badge-a">${esc(c.token)}</span>
          <span class="grow small">${esc(c.outChain)} → ${esc(c.inChain)} 卖掉，<b>${esc(c.moneyLeg)}</b> 从 ${esc(c.inChain)} → ${esc(c.outChain)} 回流</span>
          <span class="small muted">${esc(c.hours)}h · ${esc(usd(c.outUsd || 0))}</span>
        </div>`).join('')}</div>
      <div class="muted small" style="margin-top:6px">代币出去、资金回来 —— 卖掉后回流的完整套利动作</div>
    </div>` : ''}
    <div class="form-row">
      <button class="btn btn-primary btn-sm" id="dwSave">保存备注/标签</button>
      <button class="btn btn-sm" id="dwStar">${w.starred ? '取消星标' : '★ 星标'}</button>
      <button class="btn btn-sm" id="dwIgnore">忽略此地址</button>
      <button class="btn btn-sm" id="dwTrack">追踪多链流水</button>
    </div>
    <div style="margin-top:16px">
      <h3 style="font-size:13px;margin-bottom:8px">桥过的代币（${tokenList.length}）</h3>
      <div class="list">${tokenList.slice(0, 40).map(([s, n]) =>
    `<div class="row"><span class="badge ${!KNOWN.has(String(s).toUpperCase()) ? 'badge-unknown' : ''}">${esc(s)}</span><span class="grow muted small">${!KNOWN.has(String(s).toUpperCase()) ? '陌生代币，值得查' : '主流币'}</span><span class="small">×${esc(n)}</span></div>`).join('') || '<div class="empty">无</div>'}</div>
    </div>
    <div style="margin-top:16px" id="dwActivity"></div>
  `;

  $('#dwSave').onclick = (e) => withBtn(e.currentTarget, '保存中…', async () => {
    await api('/api/wallet/update', { method: 'POST', body: JSON.stringify({ address: w.address, patch: { notes: $('#dwNotes').value, tags: w.tags || [] } }) });
    toast('备注已保存', 'ok');
    loadWallets();
  });
  $('#dwStar').onclick = (e) => withBtn(e.currentTarget, '切换中…', async () => {
    const next = !w.starred;
    await api('/api/wallet/update', { method: 'POST', body: JSON.stringify({ address: w.address, patch: { starred: next } }) });
    w.starred = next;
    toast(next ? '已加星标' : '已取消星标', 'ok');
    loadWallets();
  });
  $('#dwIgnore').onclick = (e) => withBtn(e.currentTarget, '处理中…', async () => {
    await api('/api/wallet/update', { method: 'POST', body: JSON.stringify({ address: w.address, patch: { ignored: true } }) });
    toast('已忽略', 'ok');
    dw.classList.remove('open');
    loadWallets();
  });
  $('#dwTrack').onclick = (e) => withBtn(e.currentTarget, '拉取中…', async () => {
    $('#dwActivity').innerHTML = '<div class="empty">正在拉取多链流水（代币流水 + 跨链消息）…</div>';
    const r = await api('/api/wallet/activity?address=' + encodeURIComponent(w.address));
    $('#dwActivity').innerHTML = `
      <h3 style="font-size:13px;margin-bottom:8px">近期流水（${r.activity.length}）</h3>
      <div class="table-wrap" style="max-height:300px"><table class="table"><tbody>
      ${r.activity.slice(0, 60).map((a) => `<tr>
        <td class="nowrap muted small">${esc(ago(a.timestamp))}</td>
        <td><span class="badge">${esc(a.chain)}</span></td>
        <td><span class="badge ${a.direction === 'in' ? 'badge-ok' : ''}">${a.direction === 'in' ? '转入' : '转出'}</span></td>
        <td>${!KNOWN.has(String(a.tokenSymbol || '').toUpperCase()) ? '<span class="badge badge-unknown">陌生</span> ' : ''}<b>${esc(a.tokenSymbol || '?')}</b></td>
        <td class="right num">${esc(num(a.amount))}</td>
      </tr>`).join('') || '<tr><td><div class="empty">无流水或 Key 未配置</div></td></tr>'}
      </tbody></table></div>`;
    if (r.errors?.length) toast('部分链失败：' + r.errors[0], 'err');
  });
  const ti = $('#dwTagInput');
  if (ti) ti.onkeydown = async (ev) => {
    if (ev.key !== 'Enter') return;
    const v = ti.value.trim();
    if (!v) return;
    ti.disabled = true;
    try {
      const tags = [...(w.tags || []), v];
      await api('/api/wallet/update', { method: 'POST', body: JSON.stringify({ address: w.address, patch: { tags } }) });
      w.tags = tags; ti.value = '';
      toast('标签已添加', 'ok');
      openWallet(addr);
    } catch (e) { toast(e.message || '添加失败', 'err'); }
    finally { ti.disabled = false; }
  };
  $$('#dwTags [data-rmtag]').forEach((b) => b.onclick = (e) => withBtn(e.currentTarget, '删除中…', async () => {
    const tags = (w.tags || []).filter((t) => t !== b.dataset.rmtag);
    await api('/api/wallet/update', { method: 'POST', body: JSON.stringify({ address: w.address, patch: { tags } }) });
    w.tags = tags;
    toast('标签已删除', 'ok');
    openWallet(addr);
  }));
}

// ---------------- 代币 ----------------
async function loadTokens() {
  const p = new URLSearchParams({
    q: $('#tQuery').value.trim(), unknown: $('#tUnknown').checked ? '1' : '',
    starred: $('#tStarred').checked ? '1' : '', sort: $('#tSort').value, limit: 300,
  });
  const j = await api('/api/tokens?' + p.toString());
  $('#tokenTable tbody').innerHTML = j.items.length ? j.items.map((t) => {
    const routes = Object.entries(t.routes || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${k} ×${n}`).join('，');
    const spread = Number(t.bestSpread || 0);
    return `<tr>
      <td><button class="btn btn-sm" data-tstar="${esc(t.chain)}|${esc(t.address)}">${t.starred ? '★' : '☆'}</button></td>
      <td><b>${esc(t.symbol || '?')}</b> ${t.unknown ? '<span class="badge badge-unknown">陌生</span>' : ''}
        <div class="mono muted small">${esc(short(t.address, 8))}</div></td>
      <td><span class="badge">${esc(t.chain)}</span></td>
      <td class="right num">${esc(t.bridges || 0)}</td>
      <td class="right num">${esc(Object.keys(t.wallets || {}).length)}</td>
      <td class="right ${spread >= 2 ? 'up' : 'muted'} num">${t.checkedAt ? (spread ? esc(spread) + '%' : '<span class="muted">无价差</span>') : '<span class="muted">未检查</span>'}</td>
      <td class="small muted">${esc(routes || '—')}</td>
      <td class="nowrap muted small">${esc(ago(t.lastSeen))}</td>
      <td class="nowrap">
        <button class="btn btn-sm" data-tcheck="${esc(t.chain)}|${esc(t.address)}">比价</button>
        <a class="btn btn-sm" href="https://dexscreener.com/search?q=${encodeURIComponent(t.symbol || '')}" target="_blank" rel="noreferrer">DEX</a>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="9"><div class="empty">代币库为空</div></td></tr>';
}

// ---------------- 价差检查 ----------------
function renderSpreadResult(el, data) {
  if (!data || !data.quotes || !data.quotes.length) { el.innerHTML = '<div class="empty">没查到报价</div>'; return; }
  const verdictOf = (q) => q.verdict || (q.verified === true ? 'official' : 'suspicious');
  const srcName = (s) => s === 'coingecko' ? 'CoinGecko' : s === 'trustwallet' ? 'TrustWallet' : s === 'bridge' ? '链上' : (s || '');
  const badge = (q) => {
    const v = verdictOf(q);
    if (v === 'official') return `<span class="badge badge-ok">✓ 官方合约</span> <span class="muted small">${esc(srcName(q.source))}</span>`;
    if (v === 'confirmed') return `<span class="badge badge-ok">✓ 已确认</span> <span class="muted small">价格联动 + 链上核对</span>`;
    if (v === 'fake') return `<span class="badge badge-err">✗ 假币</span>`;
    return `<span class="badge badge-warn">? 存疑</span>`;
  };
  const rows = data.quotes.map((q) => {
    const explorer = q.explorerUrl ? `<a class="btn btn-sm" href="${esc(q.explorerUrl)}" target="_blank" rel="noreferrer" title="官方 explorer 核验合约">explorer</a>` : '';
    const reason = q.reason ? `<div class="muted small">${esc(q.reason)}</div>` : '';
    return `<tr>
      <td><span class="badge">${esc(q.chainName || q.chain)}</span></td>
      <td class="small">${esc(q.dex || '')}</td>
      <td class="right num">${esc(q.priceUsd)}</td>
      <td class="right num">${esc(usd(q.liquidityUsd))}</td>
      <td class="right num">${esc(usd(q.volume24h))}</td>
      <td>${badge(q)}${reason}</td>
      <td class="nowrap"><a class="btn btn-sm" href="${esc(q.pairUrl || q.url)}" target="_blank" rel="noreferrer">打开</a>${explorer}</td>
    </tr>`;
  }).join('');
  const best = data.best;
  const count = (v) => data.quotes.filter((q) => verdictOf(q) === v).length;
  const official = count('official'); const confirmed = count('confirmed');
  const suspicious = count('suspicious'); const fake = count('fake');

  const anchorHtml = data.adjudicated
    ? `<div class="row" style="margin-bottom:8px"><span class="badge badge-a">自动裁决</span><div class="grow muted small">同名多合约，已按「价格联动 + explorer 二次确认」裁决${data.anchor && data.anchor.price ? `，官方锚定价 <b>$${esc(data.anchor.price)}</b>` : ''}</div></div>`
    : '';

  el.innerHTML = `
    ${anchorHtml}
    ${best ? `<div class="row" style="margin-bottom:10px">
      <span class="badge ${best.verified === false ? 'badge-err' : best.suspicious ? 'badge-err' : best.spreadPct >= 3 ? 'badge-a' : 'badge-b'}">${esc(best.spreadPct)}%</span>
      <div class="grow"><b>${esc(best.symbol || '')}</b> 在 ${esc(best.buyChainName)} 买 → ${esc(best.sellChainName)} 卖
        ${best.verified === false ? '<div class="small" style="color:#b42318;font-weight:600">⚠ 该价差涉及假币/存疑地址，是「假币 vs 真币」的假价差，禁止交易！</div>'
        : best.suspicious ? '<div class="small" style="color:#b42318">价差异常，可能同名不同资产，动手前务必核对合约</div>' : ''}</div>
      <span class="muted small">可承载流动性 ${esc(usd(best.minLiquidityUsd))}</span>
    </div>` : '<div class="row" style="margin-bottom:10px"><div class="grow muted">未发现有效价差</div></div>'}
    <div class="row" style="margin-bottom:8px">
      <span class="badge badge-ok">✓ 官方合约 ${esc(official)}</span>
      ${confirmed ? `<span class="badge badge-ok">已确认 ${esc(confirmed)}</span>` : ''}
      ${suspicious ? `<span class="badge badge-warn">存疑 ${esc(suspicious)}</span>` : ''}
      ${fake ? `<span class="badge badge-err">✗ 假币 ${esc(fake)}</span>` : ''}
      ${!fake && !suspicious && !confirmed ? '<span class="muted small">全部通过官方合约验证</span>' : ''}
    </div>
    <div class="table-wrap" style="max-height:360px"><table class="table">
      <thead><tr><th>链</th><th>DEX</th><th class="right">价格 USD</th><th class="right">流动性</th><th class="right">24h 量</th><th>合约裁决</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${fake ? '<p class="muted small" style="margin-top:8px">「假币」= 价格偏离官方锚点 ≥3× 或链上 symbol 与查询不符，已自动从价差计算中剔除。「存疑」= 点 explorer 人工核验合约后再决定。</p>' : ''}`;
}

async function spreadBySymbol() {
  const sym = $('#spSymbol').value.trim();
  if (!sym) return toast('填个 symbol');
  $('#spSymbolResult').innerHTML = '<div class="empty">查询中…</div>';
  try {
    const j = await api('/api/spread/check', { method: 'POST', body: JSON.stringify({ symbol: sym }) });
    renderSpreadResult($('#spSymbolResult'), j);
  } catch (e) { $('#spSymbolResult').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

function addSpreadRow() {
  const row = document.createElement('div');
  row.className = 'form-row';
  row.innerHTML = `<select class="sp-chain">${state.chains.map((c) => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join('')}</select>
    <input class="sp-addr" placeholder="合约地址 0x..." style="flex:1;min-width:260px" />
    <button class="btn btn-sm sp-del">删除</button>`;
  row.querySelector('.sp-del').onclick = () => row.remove();
  $('#spRows').appendChild(row);
}

async function spreadByAddress() {
  const items = $$('#spRows .form-row').map((r) => ({ chain: $('.sp-chain', r).value, address: $('.sp-addr', r).value.trim() })).filter((i) => i.address);
  if (items.length < 2) return toast('至少填两条链的合约地址');
  $('#spAddrResult').innerHTML = '<div class="empty">比价中…</div>';
  try {
    const j = await api('/api/spread/check', { method: 'POST', body: JSON.stringify({ items }) });
    renderSpreadResult($('#spAddrResult'), j);
  } catch (e) { $('#spAddrResult').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// ---------------- 官方合约解析（防假币） ----------------
async function resolveSymbol() {
  const sym = $('#spSymbol').value.trim();
  if (!sym) return toast('先填 symbol');
  const box = $('#spResolveResult');
  box.innerHTML = '<div class="empty">解析中…</div>';
  try {
    const j = await api('/api/resolve?symbol=' + encodeURIComponent(sym));
    if (!j.entries || !j.entries.length) { box.innerHTML = '<div class="empty">官方注册表里没有这个 symbol（TrustWallet / CoinGecko 都未收录），无法确认真实合约，请谨慎。</div>'; return; }
    const rows = j.entries.map((e) => `<div class="row">
      <span class="badge ${e.verified ? 'badge-ok' : 'badge-err'}">${e.verified ? '✓ 官方' : '⚠ 假币嫌疑'}</span>
      <span class="badge">${esc(e.chain)}</span>
      <span class="mono small grow">${esc(e.address)}</span>
      <span class="muted small">${e.source === 'coingecko' ? 'CoinGecko' : e.source === 'trustwallet' ? 'TrustWallet' : e.source === 'bridge' ? '链上出现' : esc(e.source || '')}</span>
      ${e.explorerUrl ? `<a class="btn btn-sm" href="${esc(e.explorerUrl)}" target="_blank" rel="noreferrer" title="官方 explorer 核验">explorer</a>` : ''}
      <button class="btn btn-sm" data-copy="${esc(e.address)}">复制</button>
    </div>`).join('');
    const note = j.ambiguous ? '<p class="small" style="color:#b45309;margin:8px 0">⚠ 该 symbol 在不同链上对应不同资产（同名不同币）。比价时会自动按「价格联动 + explorer 二次确认」裁决真假，点上面「查询价差」看裁决结果。</p>' : '';
    box.innerHTML = `<div class="muted small" style="margin-bottom:6px">共 ${j.entries.length} 条链上记录，其中官方合约 ${j.verifiedCount} 条</div>${note}${rows}`;
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

async function loadRegistryStatus() {
  const box = $('#registryStatus');
  try {
    const s = await api('/api/state');
    const r = s.registry || {};
    const tw = r.sources?.trustwallet || {};
    box.innerHTML = r.builtAt
      ? `已构建 ${r.builtAt} · ${r.symbols} 个官方 symbol · TrustWallet 覆盖 ${(tw.chains || []).length} 条链 · CoinGecko 补全 ${r.sources?.coingecko?.tokens || 0} 个代币`
      : '尚未构建。首次启动会自动在后台构建，也可点右上「重建注册表」。';
  } catch (e) { box.textContent = '加载失败：' + e.message; }
}

async function buildRegistry() {
  await withBtn($('#btnBuildRegistry'), '构建中…', async () => {
    const j = await api('/api/registry/build', { method: 'POST' });
    toast(`注册表构建完成：${j.added} 个代币，覆盖 ${(j.chains || []).length} 条链`, 'ok');
    loadRegistryStatus();
  });
}

// 导出官方合约映射对照表（symbol → 各链官方合约），供线下核对
function exportRegistry(format) {
  downloadFile('/api/registry/export?format=' + format);
  toast(`正在导出官方合约对照表（${format.toUpperCase()}）…`);
}

// ---------------- 数据安全（SQLite 存储） ----------------
function fmtBytes(n) { if (!n && n !== 0) return '—'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n; while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return v.toFixed(1) + ' ' + u[i]; }

async function loadStorageStatus() {
  const box = $('#storageStatus');
  try {
    const s = await api('/api/storage');
    const ok = s.integrity === 'ok';
    const rows = [
      `存储后端：<b>${esc(s.backend)}</b> · 主库 ${fmtBytes(s.mainSizeBytes)}${s.walSizeBytes > 1048576 ? ` · WAL ${fmtBytes(s.walSizeBytes)}` : ''}`,
      `完整性校验：<span class="${ok ? 'badge-ok' : 'badge-err'}">${ok ? '✓ 通过' : '✗ ' + esc(s.integrity)}</span>`,
      `备份：<b>${s.backupCount}</b> 份（每 6h 自动滚动，保留最近 20 份）`,
    ];
    if (s.lastFlush && s.lastFlush.mode) {
      const modeLabel = s.lastFlush.mode === 'delta' ? '增量写入' : s.lastFlush.mode === 'full' ? '全量重写' : s.lastFlush.mode;
      rows.push(`写入模式：<b>${modeLabel}</b>${s.lastFlush.rows != null ? ` · 写 ${s.lastFlush.rows} 行` : ''}${s.lastFlush.ms != null ? ` · ${s.lastFlush.ms}ms` : ''}`);
    }
    if (s.inMemory) rows.push(`内存态：${s.inMemory.wallets} 钱包 · ${s.inMemory.tokens} 代币 · ${s.inMemory.transfers} 流水 · ${s.inMemory.opportunities} 机会`);
    if (s.backups && s.backups.length) {
      rows.push('最近备份：<br>' + s.backups.slice(0, 3).map((b) => `&nbsp;&nbsp;· ${esc(b.file)}（${fmtBytes(b.size)}）`).join('<br>'));
    }
    box.innerHTML = rows.join('<br>');
  } catch (e) { box.textContent = '加载失败：' + e.message; }
}

async function backupNow() {
  await withBtn($('#btnBackup'), '备份中…', async () => {
    const j = await api('/api/backup', { method: 'POST' });
    const name = j.file ? String(j.file).split(/[\\/]/).pop() : '';
    toast(name ? `备份完成：${name}` : '备份完成', 'ok');
    loadStorageStatus();
  });
}

async function compactNow() {
  await withBtn($('#btnCompact'), '压缩中…', async () => {
    await api('/api/storage/compact', { method: 'POST' });
    toast('压缩完成（全量重写 + WAL 合并）', 'ok');
    loadStorageStatus();
  });
}

// ---------------- 数据源 ----------------
async function loadSources() {
  $('#sourceHealth').innerHTML = '<div class="empty">检测中…</div>';
  try {
    const j = await api('/api/sources/health');
    $('#sourceHealth').innerHTML = j.sources.map((s) => `
      <div class="src">
        <div class="t"><span class="name"><span class="dot ${s.ok ? 'dot-ok' : 'dot-err'}"></span>${esc(s.name)}</span>
          <a class="btn btn-sm" href="${esc(s.siteUrl)}" target="_blank" rel="noreferrer">打开</a></div>
        <div class="note">${esc(s.note || '')} ${s.ok ? `· 实测取到 ${s.count} 条 / ${s.ms}ms` : ''}</div>
        ${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
      </div>`).join('');
  } catch (e) { $('#sourceHealth').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// 设置输入框值并标记「已填」（浅绿底），让未填的 key 一眼可见
// 注意：$ 是 querySelector，id 必须带 # 前缀；缺失的元素直接跳过，不能让一个 id 漂移拖垮整页加载
function setVal(id, v) {
  const el = $('#' + id);
  if (!el) return;
  el.value = v ?? '';
  el.classList.toggle('filled', !!String(el.value).trim());
}

async function loadSettings() {
  const j = await api('/api/settings');
  const s = j.settings;
  setVal('sProxy', s.proxyUrl || '');
  $('#sUseProxy').checked = s.useProxy !== false;
  setVal('sKeyRange', s.keys?.range || '');
  setVal('sKeyEtherscan', s.keys?.etherscan || '');
  setVal('sKeyDebank', s.keys?.debank || '');
  setVal('sEpRange', s.endpoints?.range || '');
  $('#sAuto').checked = s.scan?.autoEnabled !== false;
  $('#sInterval').value = s.scan?.intervalMin || 5;
  $('#sLookback').value = s.scan?.lookbackHours || 24;
  $('#sSpread').value = s.scan?.spreadAlertPct || 1.5;
  $('#sHeurSpread').value = s.scan?.maxHeuristicSpreadPct || 25;
  $('#sLiq').value = s.scan?.minLiquidityUsd || 5000;
  $('#sAutoPrice').checked = s.scan?.autoPriceCheck !== false;
}

// ---------------- 扫描 ----------------
async function doScan() {
  const btn = $('#btnScan');
  btn.disabled = true;
  $('#scanStatus').className = 'pill pill-run';
  $('#scanStatus').textContent = '扫描中…';
  try {
    const j = await api('/api/scan', { method: 'POST', body: JSON.stringify({}) });
    const r = j.report;
    const ok = Object.entries(r.sources || {}).filter(([, v]) => v.ok).map(([k, v]) => `${k}+${v.count}`).join(' ');
    const bad = Object.entries(r.sources || {}).filter(([, v]) => !v.ok).map(([k]) => k).join(' ');
    toast(`扫描完成：新增 ${r.added} 条，钱包 +${r.walletsNew}，代币 +${r.tokensNew}，机会 +${r.opportunitiesNew || 0}${bad ? '；失败源：' + bad : ''}`);
    console.log('scan report', r, ok);
    switchView(state.view);
  } catch (e) {
    toast('扫描失败：' + e.message);
  } finally {
    btn.disabled = false;
    refreshCurrentView();
  }
}

// 扫描/写入之后按当前所在页刷新，否则在管道页点扫描会看不到漏斗更新
function refreshCurrentView() {
  if (state.view === 'pipeline') return loadPipeline();
  if (state.view === 'feed') return loadFeed();
  if (state.view === 'wallets') return loadWallets();
  if (state.view === 'tokens') return loadTokens();
  if (state.view === 'decide') return loadDecide();
  return loadDash();
}

// 补全存量机会的裁决证据（合约地址 / explorer / 裁决徽标），需联网逐代币比价
async function doOppRefresh() {
  const btn = $('#btnOppRefresh');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = '核验中…';
  try {
    const j = await api('/api/opportunities/refresh', { method: 'POST', body: JSON.stringify({}) });
    toast(`补全完成：更新 ${j.updated} 条（无可用报价 ${j.noBest}，跳过 ${j.skipped}）`);
    loadDash();
  } catch (e) {
    toast('补全核验失败：' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '补全核验';
  }
}

// ---------------- 事件绑定 ----------------
function bind() {
  $$('.tab').forEach((t) => t.onclick = () => switchView(t.dataset.view));
  $('#btnScan').onclick = doScan;
  $('#btnOppRefresh').onclick = doOppRefresh;
  $('#btnSettings').onclick = () => switchView('sources');

  $('#fApply').onclick = loadFeed;
  [$('#fSource'), $('#fChain'), $('#fHours')].forEach((el) => el.onchange = loadFeed);
  $('#fUnknown').onchange = loadFeed;
  $('#fQuery').onkeydown = (e) => { if (e.key === 'Enter') loadFeed(); };

  $('#wApply').onclick = loadWallets;
  [$('#wGrade'), $('#wSort')].forEach((el) => el.onchange = loadWallets);
  $('#wHideContracts').onchange = loadWallets;
  $('#wQuery').onkeydown = (e) => { if (e.key === 'Enter') loadWallets(); };
  $('#wAdd').onclick = (e) => {
    const v = prompt('粘贴地址，多个地址用逗号/换行分隔：');
    if (!v) return;
    return withBtn(e.currentTarget, '添加中…', async () => {
      const j = await api('/api/wallet/track', { method: 'POST', body: JSON.stringify({ addresses: [v] }) });
      toast(`已加入 ${j.added.length} 个地址`, 'ok');
      loadWallets();
    });
  };
  $('#wExport').onclick = () => exportData('wallets', 'csv');

  $('#tApply').onclick = loadTokens;
  [$('#tSort')].forEach((el) => el.onchange = loadTokens);
  $('#tUnknown').onchange = loadTokens;
  $('#tStarred').onchange = loadTokens;
  $('#tQuery').onkeydown = (e) => { if (e.key === 'Enter') loadTokens(); };

  $('#spSymbolGo').onclick = spreadBySymbol;
  $('#spResolveGo').onclick = resolveSymbol;
  $('#spSymbol').onkeydown = (e) => { if (e.key === 'Enter') spreadBySymbol(); };
  $('#spAddRow').onclick = addSpreadRow;
  $('#spAddrGo').onclick = spreadByAddress;

  $('#pRefreshNow').onclick = (e) => withBtn(e.currentTarget, '刷新中…', loadPipeline);
  $('#pAutoRefresh').onchange = startPolling;
  $('#pRefreshSec').onchange = startPolling;
  // 页面重新可见时立刻补一次，避免后台节流导致看到的是几分钟前的数
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && $('#pAutoRefresh').checked) pollOnce();
  });

  // 决策/素材看板
  $('#decStatus').onchange = loadDecide;
  $('#decRefresh').onclick = (e) => withBtn(e.currentTarget, '刷新中…', loadDecide);
  // 行内状态下拉：改了就即时保存
  document.addEventListener('change', (ev) => {
    const sel = ev.target.closest('select[data-dec-status]');
    if (!sel) return;
    const [sym, buy, sell] = sel.dataset.decStatus.split('|');
    return decSetStatus(sym, buy, sell, sel.value);
  });

  $('#btnHealth').onclick = (e) => withBtn(e.currentTarget, '检测中…', loadSources);
  $('#btnBuildRegistry').onclick = buildRegistry;
  $('#btnExportRegistryCsv').onclick = () => exportRegistry('csv');
  $('#btnExportRegistryJson').onclick = () => exportRegistry('json');
  $('#btnBackup').onclick = backupNow;
  $('#btnCompact').onclick = compactNow;
  $$('.exp-btn').forEach((b) => { b.onclick = () => exportData(b.dataset.expType, b.dataset.expFormat); });
  $('#saveKeys').onclick = (e) => withBtn(e.currentTarget, '保存中…', async () => {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        proxyUrl: $('#sProxy').value.trim(), useProxy: $('#sUseProxy').checked,
        keys: {
          range: $('#sKeyRange').value.trim(),
          etherscan: $('#sKeyEtherscan').value.trim(), debank: $('#sKeyDebank').value.trim(),
        },
        endpoints: {
          range: $('#sEpRange').value.trim(),
        },
      }),
    });
    // $ 是 querySelector，必须拼 '#'，否则 'sKeyRange' 会被当成标签选择器而永远取不到元素
    KEY_INPUTS.forEach((id) => {
      const el = $('#' + id);
      if (el) el.classList.toggle('filled', !!el.value.trim());
    });
    const cnt = (g) => Object.keys(KEY_GROUPS[g]).filter((id) => $('#' + id)?.value.trim()).length;
    const b = cnt('bridge');
    const c = cnt('chain');
    const missing = (g) => Object.entries(KEY_GROUPS[g]).filter(([id]) => !$('#' + id)?.value.trim()).map(([, n]) => n);
    const missB = missing('bridge');
    setMsg('#keysMsg', `✓ 已保存并立即生效（桥协议 ${b}/1、链上数据 ${c}/2 已配置）`, 'ok');
    // Range 是唯一「必填」的桥数据源，缺了要明说，否则用户以为在跑其实一直被跳过
    toast(missB.includes('Range') ? '已保存，但 Range 未配置 → 该数据源会被跳过' : '密钥与代理已保存', 'ok');
    setTimeout(() => { const el = $('#keysMsg'); if (el) el.textContent = ''; }, 4000);
  }, '#keysMsg');

  $('#saveScan').onclick = (e) => withBtn(e.currentTarget, '保存中…', async () => {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        scan: {
          autoEnabled: $('#sAuto').checked, intervalMin: Number($('#sInterval').value) || 5,
          lookbackHours: Number($('#sLookback').value) || 24, spreadAlertPct: Number($('#sSpread').value) || 1.5,
          maxHeuristicSpreadPct: Number($('#sHeurSpread').value) || 25,
          minLiquidityUsd: Number($('#sLiq').value) || 5000, autoPriceCheck: $('#sAutoPrice').checked,
        },
      }),
    });
    setMsg('#scanMsg', '✓ 扫描设置已保存并立即生效', 'ok');
    toast('扫描设置已保存', 'ok');
    setTimeout(() => { const el = $('#scanMsg'); if (el) el.textContent = ''; }, 4000);
  }, '#scanMsg');
  $('#importGo').onclick = (e) => {
    const text = $('#importText').value.trim();
    if (!text) { setMsg('#importMsg', '先粘贴要导入的内容', 'err'); return toast('先粘贴要导入的内容', 'err'); }
    return withBtn(e.currentTarget, '导入中…', async () => {
      const j = await api('/api/import', { method: 'POST', body: JSON.stringify({ source: $('#importSource').value, text }) });
      $('#importText').value = '';
      setMsg('#importMsg', `✓ 导入 ${j.added} 条，钱包 +${j.walletsTouched}，代币 +${j.tokensTouched}`, 'ok');
      toast(`导入成功：${j.added} 条桥交易`, 'ok');
    }, '#importMsg');
  };

  // 抽屉关闭
  $$('[data-close]').forEach((el) => el.onclick = () => $('#drawer').classList.remove('open'));

  // 全局委托
  document.addEventListener('click', async (ev) => {
    // 决策：先处理专属动作（避免被下面的通用选择器漏掉）
    const decSet = ev.target.closest('[data-dec-setstatus]');
    if (decSet) {
      const [sym, buy, sell] = decSet.dataset.decSetstatus.split('|');
      const target = decSet.dataset.decStatus;
      await withBtn(decSet, '标记中…', async () => decSetStatus(sym, buy, sell, target));
      return;
    }
    const decLog = ev.target.closest('[data-dec-log]');
    if (decLog) {
      const [sym, buy, sell] = decLog.dataset.decLog.split('|');
      return openDecLog(sym, buy, sell);
    }
    const decRm = ev.target.closest('[data-dec-remove]');
    if (decRm) {
      const [sym, buy, sell] = decRm.dataset.decRemove.split('|');
      return decRemove(sym, buy, sell);
    }
    const el = ev.target.closest('[data-wallet],[data-copy],[data-star],[data-tstar],[data-tcheck]');
    if (!el) return;
    if (el.dataset.wallet) return openWallet(el.dataset.wallet);
    if (el.dataset.copy) return copy(el.dataset.copy);
    if (el.dataset.star) {
      await withBtn(el, '切换中…', async () => {
        const j = await api('/api/wallets?q=' + encodeURIComponent(el.dataset.star));
        const w = (j.items || []).find((x) => x.address.toLowerCase() === el.dataset.star.toLowerCase());
        const next = !w?.starred;
        await api('/api/wallet/update', { method: 'POST', body: JSON.stringify({ address: el.dataset.star, patch: { starred: next } }) });
        toast(next ? '已加星标' : '已取消星标', 'ok');
        return loadWallets();
      });
      return;
    }
    if (el.dataset.tstar) {
      await withBtn(el, '切换中…', async () => {
        const [chain, address] = el.dataset.tstar.split('|');
        const j = await api('/api/tokens?q=' + encodeURIComponent(address));
        const t = (j.items || []).find((x) => x.address.toLowerCase() === address.toLowerCase());
        const next = !t?.starred;
        await api('/api/token/update', { method: 'POST', body: JSON.stringify({ chain, address, patch: { starred: next } }) });
        toast(next ? '已加星标' : '已取消星标', 'ok');
        return loadTokens();
      });
      return;
    }
    if (el.dataset.tcheck) {
      await withBtn(el, '查询中…', async () => {
        const [chain, address] = el.dataset.tcheck.split('|');
        const j = await api('/api/token/check', { method: 'POST', body: JSON.stringify({ chain, address }) });
        const best = j.result?.best;
        toast(best ? `${best.symbol} 价差 ${best.spreadPct}%（${best.buyChainName} → ${best.sellChainName}）` : '未发现价差', 'ok');
        return loadTokens();
      });
      return;
    }
  });
}

// 主流币白名单（前端仅用于渲染「陌生」标记）
const KNOWN = new Set(['ETH', 'WETH', 'USDC', 'USDC.E', 'USDBC', 'USDT', 'DAI', 'WBTC', 'CBBTC', 'TBTC', 'WSTETH', 'STETH', 'RETH', 'CBETH', 'WEETH', 'EZETH', 'RSETH', 'PXETH', 'FRXETH', 'SFRXETH', 'USDE', 'SUSDE', 'USDS', 'SDAI', 'SUSDS', 'BNB', 'WBNB', 'SOL', 'WSOL', 'MSOL', 'JITOSOL', 'BSOL', 'JSOL', 'ARB', 'OP', 'MNT', 'POL', 'MATIC', 'AVAX', 'WAVAX', 'FTM', 'S', 'BERA', 'UNI', 'LINK', 'AAVE', 'LDO', 'PENDLE', 'CRV', 'CVX', 'BAL', 'COMP', 'MKR', 'SKY', 'ENA', 'ONDO', 'PYUSD', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'GHO', 'CRVUSD', 'FRAX', 'LUSD', 'DOLA', 'MIM', 'EURC', 'EURS', 'XAUT', 'PAXG', 'RLUSD', 'USD0', 'USDF', 'INJ', 'APT', 'SUI', 'TON', 'TRX', 'USDD', 'USDX', 'USDY', 'RPL']);

// ---------------- 启动 ----------------
(async function init() {
  // 链下拉
  const chains = await fetch('/api/state').then((r) => r.json()).then((s) => s.chains || null).catch(() => null);
  state.chains = chains || [
    { key: 'ethereum', name: 'Ethereum' }, { key: 'arbitrum', name: 'Arbitrum' }, { key: 'base', name: 'Base' },
    { key: 'optimism', name: 'Optimism' }, { key: 'polygon', name: 'Polygon' }, { key: 'bsc', name: 'BNB Chain' },
    { key: 'solana', name: 'Solana' }, { key: 'avalanche', name: 'Avalanche' }, { key: 'linea', name: 'Linea' },
    { key: 'scroll', name: 'Scroll' }, { key: 'blast', name: 'Blast' }, { key: 'mantle', name: 'Mantle' },
    { key: 'sonic', name: 'Sonic' }, { key: 'berachain', name: 'Berachain' }, { key: 'unichain', name: 'Unichain' },
  ];
  const opts = state.chains.map((c) => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join('');
  $('#fChain').innerHTML = '<option value="">全部链</option>' + opts;

  bind();
  addSpreadRow();
  addSpreadRow();
  switchView('dash');
  startPolling();
})();
