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
  if (forceDecimals !== undefined) return '$' + n.toFixed(forceDecimals);
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  if (Math.abs(n) < 0.01 && Math.abs(n) > 0) return '$' + n.toFixed(6);
  if (Math.abs(n) < 1) return '$' + n.toFixed(4);
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
