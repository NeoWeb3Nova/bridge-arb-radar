export function short(a: string | null | undefined, n = 6): string {
  if (!a) return '—';
  const s = String(a);
  return s.length <= n * 2 + 2 ? s : `${s.slice(0, n)}…${s.slice(-4)}`;
}

export function num(v: number | string | null | undefined, d = 2): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (Math.abs(n) < 1 && Math.abs(n) > 0) return n.toFixed(Math.max(d, 4));
  return n.toFixed(d);
}

export function usd(v: number | string | null | undefined, forceDecimals?: number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (forceDecimals !== undefined) {
    return '$' + n.toLocaleString('en-US', {
      minimumFractionDigits: forceDecimals,
      maximumFractionDigits: forceDecimals,
    });
  }
  // 小于 0.01 的微小价格，保留 6 位小数
  if (Math.abs(n) < 0.01 && Math.abs(n) > 0) {
    return '$' + n.toFixed(6);
  }
  // 小于 1 的代币单价，保留 4 位小数 (如 $0.0479)
  if (Math.abs(n) < 1 && Math.abs(n) > 0) {
    return '$' + n.toFixed(4);
  }
  // 正常金融资金 (本金、回款、盈亏)，使用千分符 + 两位小数 (如 $1,473.07)
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * 仅用于宏观聚合数据 (如池子 TVL、24h 交易量) 的紧凑缩写
 */
export function usdCompact(v: number | string | null | undefined): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  if (Math.abs(n) < 1 && Math.abs(n) > 0) return '$' + n.toFixed(4);
  return '$' + n.toFixed(2);
}


export function ago(ts: string | null | undefined): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(diff)) return '—';
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function agoSec(ts: string | null | undefined, locale = 'zh'): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(diff) || diff < 0) return locale === 'zh' ? '刚刚' : 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return locale === 'zh' ? `${Math.max(1, sec)} 秒前` : `${Math.max(1, sec)}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return locale === 'zh' ? `${m} 分钟前` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return locale === 'zh' ? `${h} 小时前` : `${h}h ago`;
  return locale === 'zh' ? `${Math.floor(h / 24)} 天前` : `${Math.floor(h / 24)}d ago`;
}

