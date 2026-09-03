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
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              placeholder={tr('feedSearchPh')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadData()}
              className="w-full bg-slate-950/70 dark:bg-slate-950/70 border border-slate-800 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
            />
          </div>
          <div className="relative w-32">
            <input
              type="number"
              placeholder={tr('minUsdPh')}
              value={minUsd}
              onChange={(e) => setMinUsd(e.target.value)}
              className="w-full bg-slate-950/70 dark:bg-slate-950/70 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition font-mono-num"
            />
          </div>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? tr('searching') : tr('refreshFeed')}</span>
        </button>
      </div>

      {/* 数据表格 */}
      <div className="terminal-panel rounded-lg overflow-hidden border border-slate-800/80">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 font-medium tracking-tight text-[11px] border-b border-slate-800/80">
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
            <tbody className="divide-y divide-slate-800/50">
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500 text-xs">
                    {loading ? tr('searching') : tr('noFeed')}
                  </td>
                </tr>
              ) : (
                transfers.map((t) => (
                  <tr key={t.id || t.txHash} className="hover:bg-slate-800/30 transition duration-150 font-mono-num">
                    <td className="py-2 px-3.5 text-slate-400 whitespace-nowrap text-[11px]">{ago(t.timestamp)}</td>
                    <td className="py-2 px-3">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800/70 border border-slate-700/50 text-slate-300 text-[10px] font-sans">
                        {t.source}
                      </span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-slate-200 font-sans text-xs">
                        <span className="font-medium text-slate-300">{t.fromChain || '—'}</span>
                        <ArrowRight size={11} className="text-slate-500" />
                        <span className="font-medium text-slate-300">{t.toChain || '—'}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 font-bold text-slate-100">{t.tokenSymbol || '—'}</td>
                    <td className="py-2 px-3 text-right font-extrabold text-slate-200">{usd(t.amountUsd)}</td>
                    <td className="py-2 px-3 font-mono text-slate-400 text-[11px]">
                      <span className="cursor-pointer hover:text-slate-200" onClick={() => t.sender && handleCopy(t.sender)}>
                        {short(t.sender, 5)}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-400 text-[11px]">
                      <span className="cursor-pointer hover:text-slate-200" onClick={() => t.receiver && handleCopy(t.receiver)}>
                        {short(t.receiver, 5)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      {t.explorer && (
                        <a
                          href={t.explorer}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-blue-400 transition"
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
