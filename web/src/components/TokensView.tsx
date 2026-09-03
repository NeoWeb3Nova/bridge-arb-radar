import React, { useEffect, useState } from 'react';
import { short, ago } from '../utils/format';
import { Search, Star, ExternalLink, Zap } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

interface TokenItem {
  chain: string;
  address: string;
  symbol: string;
  bridges: number;
  starred: boolean;
  unknown: boolean;
  bestSpread?: number;
  lastSeen?: string;
  checkedAt?: string;
  wallets?: Record<string, number>;
}

export const TokensView: React.FC = () => {
  const { t: tr } = useI18n();
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [unknownOnly, setUnknownOnly] = useState(false);
  const [checkingKey, setCheckingKey] = useState<string | null>(null);

  const loadTokens = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (query) p.append('q', query);
      if (unknownOnly) p.append('unknown', '1');
      p.append('limit', '200');

      const res = await fetch(`/api/tokens?${p.toString()}`);
      const data = await res.json();
      if (data.ok) {
        setTokens(data.items || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTokens();
  }, [unknownOnly]);

  const handleCheck = async (t: TokenItem) => {
    const k = `${t.chain}:${t.address}`;
    setCheckingKey(k);
    try {
      await fetch('/api/token/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: t.chain, address: t.address }),
      });
      loadTokens();
    } catch (e) {
      console.error(e);
    } finally {
      setCheckingKey(null);
    }
  };

  const toggleStar = async (t: TokenItem) => {
    const next = !t.starred;
    try {
      await fetch('/api/token/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: t.chain, address: t.address, patch: { starred: next } }),
      });
      loadTokens();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-3">
      {/* 搜索栏 */}
      <div className="terminal-panel p-3 rounded-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              placeholder={tr('tSearchPh')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadTokens()}
              className="w-full bg-slate-950/70 dark:bg-slate-950/70 border border-slate-800 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={loadTokens}
            className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold cursor-pointer"
          >
            {tr('tSearchBtn')}
          </button>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={unknownOnly}
              onChange={(e) => setUnknownOnly(e.target.checked)}
              className="rounded bg-slate-900 border-slate-800"
            />
            <span className="font-medium text-amber-500 dark:text-amber-400">{tr('tUnknownOnly')}</span>
          </label>
        </div>
      </div>

      {/* 代币表格 */}
      <div className="terminal-panel rounded-lg overflow-hidden border border-slate-800/80">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 font-medium tracking-tight text-[11px] border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">{tr('tStar')}</th>
                <th className="py-2.5 px-3">{tr('tSymbol')}</th>
                <th className="py-2.5 px-3">{tr('tOriginChain')}</th>
                <th className="py-2.5 px-3 font-mono">{tr('tAddress')}</th>
                <th className="py-2.5 px-3 text-right">{tr('tFreq')}</th>
                <th className="py-2.5 px-3 text-right">{tr('tBestSpread')}</th>
                <th className="py-2.5 px-3">{tr('thLastSeen')}</th>
                <th className="py-2.5 px-3 text-center">{tr('tAction')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono-num">
              {tokens.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500 font-sans">
                    {loading ? tr('searching') : tr('tNoData')}
                  </td>
                </tr>
              ) : (
                tokens.map((t) => {
                  const k = `${t.chain}:${t.address}`;
                  const isChecking = checkingKey === k;
                  return (
                    <tr key={k} className="hover:bg-slate-800/40 transition duration-150">
                      <td className="py-2 px-3">
                        <button
                          onClick={() => toggleStar(t)}
                          className={`hover:scale-110 transition ${t.starred ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
                        >
                          <Star size={13} fill={t.starred ? 'currentColor' : 'none'} />
                        </button>
                      </td>
                      <td className="py-2 px-3 font-bold text-slate-100 font-sans">
                        <div className="flex items-center gap-1.5">
                          <span>{t.symbol || '?'}</span>
                          {t.unknown && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/15 border border-amber-500/30 text-amber-500 dark:text-amber-400">
                              {tr('tUnknownBadge')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-slate-300 font-sans">{t.chain}</td>
                      <td className="py-2 px-3 font-mono text-slate-400">{short(t.address, 6)}</td>
                      <td className="py-2 px-3 text-right font-semibold text-slate-200">{t.bridges || 0}</td>
                      <td className="py-2 px-3 text-right font-extrabold text-emerald-500 dark:text-emerald-400">
                        {t.bestSpread ? `+${t.bestSpread.toFixed(2)}%` : <span className="text-slate-500 font-normal">—</span>}
                      </td>
                      <td className="py-2 px-3 text-slate-400 text-[11px] font-sans">{ago(t.lastSeen)}</td>
                      <td className="py-2 px-3 text-center font-sans">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleCheck(t)}
                            disabled={isChecking}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600/20 hover:bg-blue-600/35 text-blue-500 dark:text-blue-400 border border-blue-500/30 text-[10px] font-semibold transition cursor-pointer"
                          >
                            <Zap size={10} className={isChecking ? 'animate-spin' : ''} />
                            <span>{isChecking ? tr('tChecking') : tr('tCheckBtn')}</span>
                          </button>
                          <a
                            href={`https://dexscreener.com/search?q=${encodeURIComponent(t.symbol || '')}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 text-slate-400 hover:text-slate-200 text-[10px] transition"
                          >
                            <span>DEX</span>
                            <ExternalLink size={10} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
