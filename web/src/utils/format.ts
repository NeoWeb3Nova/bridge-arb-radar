export function short(a: string | null | undefined, n = 6): string {
  if (!a) return '—';
  const s = String(a);
  return s.length <= n * 2 + 2 ? s : `${s.slice(0, n)}…${s.slice(-4)}`;
}

const SUB_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

export function num(v: number | string | null | undefined, d = 2): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (Math.abs(n) < 0.0001 && Math.abs(n) > 0) {
    const s = Math.abs(n).toFixed(18);
    const m = s.match(/^0\.(0+)([1-9]\d{0,3})/);
    if (m) {
      const sub = String(m[1].length).split('').map((dig) => SUB_DIGITS[Number(dig)] || dig).join('');
      return `${n < 0 ? '-' : ''}0.0${sub}${m[2]}`;
    }
  }
  if (Math.abs(n) < 1 && Math.abs(n) > 0) return n.toFixed(Math.max(d, 4));
  return n.toFixed(d);
}

export function usd(v: number | string | null | undefined, forceDecimals?: number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '$0.00';
  const isNeg = n < 0;
  const abs = Math.abs(n);
  const prefix = isNeg ? '-$' : '$';

  if (forceDecimals !== undefined) {
    return prefix + abs.toLocaleString('en-US', {
      minimumFractionDigits: forceDecimals,
      maximumFractionDigits: forceDecimals,
    });
  }
  // 正常金额资金 (本金、回款、盈亏 >= 1)，使用千分符 + 两位小数 (如 $1,473.07)
  if (abs >= 1) {
    return prefix + abs.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  // 小于 1 的代币单价 (0.01 ~ 1)，保留 4 位小数 (如 $0.0479)
  if (abs >= 0.01) {
    return prefix + abs.toFixed(4);
  }
  // 微小代币单价 (0.0001 ~ 0.01)，保留 6 位小数 (如 $0.003683)
  if (abs >= 0.0001) {
    return prefix + abs.toFixed(6);
  }
  // 超微单价 / Meme 代币 (< 0.0001，例如 REKT 1.073e-7, PEPE, SHIB):
  // 采用行业标准零下标计数法 $0.0₆1073，彻底避免因 toFixed(6) 截断而错误显示为 $0.000000
  const s = abs.toFixed(18);
  const m = s.match(/^0\.(0+)([1-9]\d{0,3})/);
  if (m) {
    const zeroCount = m[1].length;
    const sigDigits = m[2];
    const sub = String(zeroCount).split('').map((dig) => SUB_DIGITS[Number(dig)] || dig).join('');
    return `${prefix}0.0${sub}${sigDigits}`;
  }
  return prefix + abs.toPrecision(4);
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
  if (Math.abs(n) < 0.0001 && Math.abs(n) > 0) return usd(n);
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

