'use strict';

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s;
  if (typeof v === 'object') s = JSON.stringify(v);
  else if (typeof v === 'boolean') s = v ? '1' : '0';
  else s = String(v);
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function buildCsv(rows, cols) {
  const header = cols.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => cols.map((c) => csvCell(c.get(r))).join(','));
  return '\uFEFF' + [header].concat(body).join('\r\n');
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const EXPORT_COLS = {
  wallets: [
    { label: '地址', get: (w) => w.address },
    { label: '等级', get: (w) => w.grade },
    { label: '分数', get: (w) => w.score },
    { label: '桥次数', get: (w) => w.bridgeCount },
    { label: '资金闭环', get: (w) => w.capitalCycles },
    { label: '往返', get: (w) => (w.roundtrips || []).length },
    { label: '链数', get: (w) => Object.keys(w.chains || {}).length },
    { label: '币种数', get: (w) => Object.keys(w.tokens || {}).length },
    { label: '标签', get: (w) => (w.tags || []).join('|') },
    { label: '备注', get: (w) => w.notes },
    { label: '疑似合约', get: (w) => w.likelyContract },
    { label: '收藏', get: (w) => w.starred },
    { label: '首次发现', get: (w) => w.firstSeen },
    { label: '最近活跃', get: (w) => w.lastSeen },
  ],
  tokens: [
    { label: '链', get: (t) => t.chain },
    { label: '合约地址', get: (t) => t.address },
    { label: 'Symbol', get: (t) => t.symbol },
    { label: '桥次数', get: (t) => t.bridges },
    { label: '关联钱包', get: (t) => Object.keys(t.wallets || {}).length },
    { label: '最佳价差%', get: (t) => t.bestSpread },
    { label: '冷门', get: (t) => t.unknown },
    { label: '收藏', get: (t) => t.starred },
    { label: '首次发现', get: (t) => t.firstSeen },
    { label: '最近检查', get: (t) => t.checkedAt },
  ],
  transfers: [
    { label: '来源', get: (t) => t.source },
    { label: 'TxHash', get: (t) => t.txHash },
    { label: '源链', get: (t) => t.fromChain },
    { label: '目标链', get: (t) => t.toChain },
    { label: 'Symbol', get: (t) => t.tokenSymbol },
    { label: '合约地址', get: (t) => t.tokenAddress },
    { label: '发送方', get: (t) => t.sender },
    { label: '接收方', get: (t) => t.receiver },
    { label: '数量', get: (t) => t.amount },
    { label: '金额USD', get: (t) => t.amountUsd },
    { label: '时间', get: (t) => t.timestamp },
  ],
  opportunities: [
    { label: 'Symbol', get: (o) => o.symbol },
    { label: '买入链', get: (o) => o.buyChain },
    { label: '卖出链', get: (o) => o.sellChain },
    { label: '价差%', get: (o) => o.spreadPct },
    { label: '已验证', get: (o) => o.verified },
    { label: '可疑', get: (o) => o.suspicious },
    { label: '裁决', get: (o) => o.verdict },
    { label: '买入价', get: (o) => o.buyPrice },
    { label: '卖出价', get: (o) => o.sellPrice },
    { label: '流动性USD', get: (o) => o.minLiquidityUsd },
    { label: '发现时间', get: (o) => o.ts },
  ],
};

module.exports = {
  csvCell,
  buildCsv,
  stamp,
  EXPORT_COLS,
};
