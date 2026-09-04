import React, { useEffect, useState } from 'react';
import { TransferItem } from '../types';
import { short, usd, ago } from '../utils/format';
import { ArrowRight, ExternalLink, Search, RefreshCw, Check, Copy } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

export const FeedTable: React.FC = () => {
  const { t: tr } = useI18n();
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [minUsd, setMinUsd] = useState('');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (search) p.append('q', search);
      if (minUsd) p.append('minUsd', minUsd);
      p.append('limit', '100');

      const res = await fetch(`/api/transfers?${p.toString()}`);
      const data = await res.json();
      if (data.ok) {
        setTransfers(data.items || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
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
              onKeyDown={(e) => e.key === 'Enter' && loadData()}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042] transition"
            />
          </div>
          <div className="relative w-32">
            <input
              type="number"
              placeholder={tr('minUsdPh')}
              value={minUsd}
              onChange={(e) => setMinUsd(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042] transition font-mono-num"
            />
          </div>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-semibold transition cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? tr('searching') : tr('refreshFeed')}</span>
        </button>
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
                      <span className="cursor-pointer hover:text-[var(--text-primary)]" onClick={() => t.sender && handleCopy(t.sender)}>
                        {short(t.sender, 5)}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-[var(--text-muted)] text-[11px]">
                      <span className="cursor-pointer hover:text-[var(--text-primary)]" onClick={() => t.receiver && handleCopy(t.receiver)}>
                        {short(t.receiver, 5)}
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
