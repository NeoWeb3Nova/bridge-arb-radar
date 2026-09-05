import React, { useEffect, useState } from 'react';
import { TransferItem } from '../types';
import { short, usd, ago } from '../utils/format';
import { ArrowRight, ExternalLink, Search, RefreshCw, Check, Copy, Play } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

export const FeedTable: React.FC = () => {
  const { t: tr } = useI18n();
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [justRefreshed, setJustRefreshed] = useState(false);
  const [search, setSearch] = useState('');
  const [minUsd, setMinUsd] = useState('');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const loadData = async (isManual = false) => {
    setLoading(true);
    const start = Date.now();
    try {
      const p = new URLSearchParams();
      if (search.trim()) p.append('q', search.trim());
      if (minUsd.trim()) p.append('minUsd', minUsd.trim());
      p.append('limit', '100');

      const res = await fetch(`/api/transfers?${p.toString()}`);
      const data = await res.json();
      if (data.ok) {
        setTransfers(data.items || []);
        if (data.total !== undefined) setTotal(data.total);
      }
      if (isManual) {
        // 保证平滑可感知的旋转反馈，避免 1ms 瞬间完成导致视觉上无感知
        const elapsed = Date.now() - start;
        if (elapsed < 400) {
          await new Promise((r) => setTimeout(r, 400 - elapsed));
        }
        setJustRefreshed(true);
        setTimeout(() => setJustRefreshed(false), 2000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleScanAndFetch = async () => {
    setScanning(true);
    try {
      await fetch('/api/scan', { method: 'POST' });
      await loadData(true);
    } catch (e) {
      console.error(e);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 1500);
  };

  return (
    <div className="space-y-3">
      {/* 搜索工具栏 */}
      <div className="terminal-panel p-3 rounded-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 flex-1 max-w-lg">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="search"
              placeholder={tr('feedSearchPh')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadData(true)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042] transition"
            />
          </div>
          <div className="relative w-32">
            <input
              type="number"
              placeholder={tr('minUsdPh')}
              value={minUsd}
              onChange={(e) => setMinUsd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadData(true)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042] transition font-mono-num"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {total > 0 && (
            <span className="text-[11px] text-[var(--text-muted)] font-mono hidden md:inline mr-1">
              {tr('feedTotalCount')}: <b className="text-[var(--text-primary)]">{total.toLocaleString()}</b> 条
            </span>
          )}

          {/* 刷新本地流水 */}
          <button
            onClick={() => loadData(true)}
            disabled={loading || scanning}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer disabled:opacity-50 ${
              justRefreshed
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)]'
            }`}
            title="从本地数据库重新载入符合筛选条件的流水记录"
          >
            {justRefreshed ? (
              <Check size={12} className="text-emerald-400" />
            ) : (
              <RefreshCw size={12} className={loading ? 'animate-spin text-[#f5c042]' : ''} />
            )}
            <span>
              {loading
                ? tr('searching')
                : justRefreshed
                ? `${tr('feedRefreshed')} (${total})`
                : tr('refreshFeed')}
            </span>
          </button>

          {/* 抓取全网最新跨链流水 */}
          <button
            onClick={handleScanAndFetch}
            disabled={scanning || loading}
            className="impeccable-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold tracking-tight transition cursor-pointer disabled:opacity-50"
            title="立即并发请求各大跨链桥远程节点抓取全网最新转账并更新此列表"
          >
            <Play size={11} className={scanning ? 'animate-spin' : 'fill-current'} />
            <span>{scanning ? tr('feedScanning') : tr('feedScanBtn')}</span>
          </button>
        </div>
      </div>

      {/* 数据表格 */}
      <div className="terminal-panel rounded-lg overflow-hidden border border-[var(--border-subtle)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[var(--text-primary)]">
            <thead className="bg-[var(--bg-elevated)]/60 text-[var(--text-secondary)] font-medium tracking-tight text-[11px] border-b border-[var(--border-subtle)]">
              <tr>
                <th className="py-2.5 px-3.5">{tr('thTime')}</th>
                <th className="py-2.5 px-3">{tr('thBridge')}</th>
                <th className="py-2.5 px-3">{tr('thRoute')}</th>
                <th className="py-2.5 px-3">{tr('thToken')}</th>
                <th className="py-2.5 px-3 text-right">{tr('thAmountUsd')}</th>
                <th className="py-2.5 px-3">{tr('thSender')}</th>
                <th className="py-2.5 px-3">{tr('thReceiver')}</th>
                <th className="py-2.5 px-3 text-center">{tr('thExplorer')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-[var(--text-muted)] text-xs">
                    {loading ? tr('searching') : tr('noFeed')}
                  </td>
                </tr>
              ) : (
                transfers.map((t) => (
                  <tr key={t.id || t.txHash} className="hover:bg-[var(--bg-elevated)]/40 transition duration-150 font-mono-num">
                    <td className="py-2 px-3.5 text-[var(--text-muted)] whitespace-nowrap text-[11px]">{ago(t.timestamp)}</td>
                    <td className="py-2 px-3">
                      <span className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] text-[10px] font-sans">
                        {t.source}
                      </span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-[var(--text-primary)] font-sans text-xs">
                        <span className="font-medium text-[var(--text-secondary)]">{t.fromChain || '—'}</span>
                        <ArrowRight size={11} className="text-[var(--text-muted)]" />
                        <span className="font-medium text-[var(--text-secondary)]">{t.toChain || '—'}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 font-bold text-[var(--text-primary)]">{t.tokenSymbol || '—'}</td>
                    <td className="py-2 px-3 text-right font-extrabold text-[var(--text-primary)]">{usd(t.amountUsd)}</td>
                    <td className="py-2 px-3 font-mono text-[var(--text-muted)] text-[11px]">
                      <span className="cursor-pointer hover:text-[var(--text-primary)] flex items-center gap-1" onClick={() => t.sender && handleCopy(t.sender)}>
                        {short(t.sender, 5)}
                        {copiedHash === t.sender && <Check size={10} className="text-emerald-400" />}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-[var(--text-muted)] text-[11px]">
                      <span className="cursor-pointer hover:text-[var(--text-primary)] flex items-center gap-1" onClick={() => t.receiver && handleCopy(t.receiver)}>
                        {short(t.receiver, 5)}
                        {copiedHash === t.receiver && <Check size={10} className="text-emerald-400" />}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      {t.explorer && (
                        <a
                          href={t.explorer}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[#45c4b0] transition"
                          title="在 Explorer 中打开"
                        >
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
