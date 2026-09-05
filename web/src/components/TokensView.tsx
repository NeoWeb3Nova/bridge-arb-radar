import React, { useEffect, useState } from 'react';
import { short, ago } from '../utils/format';
import { Search, Star, ExternalLink, Zap } from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { TokenCheckModal, TokenCheckReport } from './TokenCheckModal';
import { OpportunityItem } from '../types';

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

interface Props {
  onNavigateToDash?: () => void;
  onSelectOpp?: (opp: OpportunityItem) => void;
  onViewInMatrix?: (symbol: string, opp?: OpportunityItem | null) => void;
}

export const TokensView: React.FC<Props> = ({ onNavigateToDash, onSelectOpp, onViewInMatrix }) => {
  const { t: tr } = useI18n();
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [unknownOnly, setUnknownOnly] = useState(false);
  const [checkingKey, setCheckingKey] = useState<string | null>(null);
  const [report, setReport] = useState<TokenCheckReport | null>(null);

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
      const res = await fetch('/api/token/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: t.chain, address: t.address }),
      });
      const data = await res.json();
      if (data.ok && data.result) {
        setReport({
          token: { chain: t.chain, address: t.address, symbol: t.symbol },
          result: data.result,
          security: data.security || data.result.best?.security || null,
        });
      }
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
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="search"
              placeholder={tr('tSearchPh')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadTokens()}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
            />
          </div>
          <button
            onClick={loadTokens}
            className="px-3 py-1.5 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-semibold cursor-pointer"
          >
            {tr('tSearchBtn')}
          </button>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={unknownOnly}
              onChange={(e) => setUnknownOnly(e.target.checked)}
              className="rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
            />
            <span className="font-medium text-[#f5c042]">{tr('tUnknownOnly')}</span>
          </label>
        </div>
      </div>

      {/* 代币表格 */}
      <div className="terminal-panel rounded-lg overflow-hidden border border-[var(--border-subtle)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[var(--text-primary)]">
            <thead className="bg-[var(--bg-elevated)]/60 text-[var(--text-secondary)] font-medium tracking-tight text-[11px] border-b border-[var(--border-subtle)]">
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
            <tbody className="divide-y divide-[var(--border-subtle)] font-mono-num">
              {tokens.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-[var(--text-muted)] font-sans">
                    {loading ? tr('searching') : tr('tNoData')}
                  </td>
                </tr>
              ) : (
                tokens.map((t) => {
                  const k = `${t.chain}:${t.address}`;
                  const isChecking = checkingKey === k;
                  return (
                    <tr key={k} className="hover:bg-[var(--bg-elevated)]/40 transition duration-150">
                      <td className="py-2 px-3">
                        <button
                          onClick={() => toggleStar(t)}
                          className={`hover:scale-110 transition ${t.starred ? 'text-amber-400' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                        >
                          <Star size={13} fill={t.starred ? 'currentColor' : 'none'} />
                        </button>
                      </td>
                      <td className="py-2 px-3 font-bold text-[var(--text-primary)] font-sans">
                        <div className="flex items-center gap-1.5">
                          <span>{t.symbol || '?'}</span>
                          {t.unknown && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/15 border border-amber-500/30 text-amber-500">
                              {tr('tUnknownBadge')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-[var(--text-secondary)] font-sans">{t.chain}</td>
                      <td className="py-2 px-3 font-mono text-[var(--text-muted)]">{short(t.address, 6)}</td>
                      <td className="py-2 px-3 text-right font-semibold text-[var(--text-primary)]">{t.bridges || 0}</td>
                      <td className="py-2 px-3 text-right font-extrabold text-emerald-500">
                        {t.bestSpread ? `+${t.bestSpread.toFixed(2)}%` : <span className="text-[var(--text-muted)] font-normal">—</span>}
                      </td>
                      <td className="py-2 px-3 text-[var(--text-muted)] text-[11px] font-sans">{ago(t.lastSeen)}</td>
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
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-[10px] transition"
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

      {report && (
        <TokenCheckModal
          report={report}
          onClose={() => setReport(null)}
          onNavigateToDash={onNavigateToDash}
          onSelectOpp={onSelectOpp}
          onViewInMatrix={onViewInMatrix}
        />
      )}
    </div>
  );
};
