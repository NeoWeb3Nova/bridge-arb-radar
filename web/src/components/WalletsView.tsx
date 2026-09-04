import React, { useEffect, useState } from 'react';
import { WalletItem } from '../types';
import { short, usd, ago } from '../utils/format';
import { Search, ExternalLink, Star, Copy, Check } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

interface Props {
  onSelectWallet: (w: WalletItem) => void;
}

export const WalletsView: React.FC<Props> = ({ onSelectWallet }) => {
  const { t: tr } = useI18n();
  const [wallets, setWallets] = useState<WalletItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [grade, setGrade] = useState('');
  const [sort, setSort] = useState('score');
  const [hideContracts, setHideContracts] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const loadWallets = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (query) p.append('q', query);
      if (grade) p.append('grade', grade);
      p.append('sort', sort);
      if (hideContracts) p.append('hideContracts', '1');
      p.append('limit', '200');

      const res = await fetch(`/api/wallets?${p.toString()}`);
      const data = await res.json();
      if (data.ok) {
        setWallets(data.items || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWallets();
  }, [grade, sort, hideContracts]);

  const handleCopy = (e: React.MouseEvent, addr: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(addr);
    setCopied(addr);
    setTimeout(() => setCopied(null), 1500);
  };

  const toggleStar = async (e: React.MouseEvent, w: WalletItem) => {
    e.stopPropagation();
    const next = !w.starred;
    try {
      await fetch('/api/wallet/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: w.address, patch: { starred: next } }),
      });
      loadWallets();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-3">
      {/* 搜索过滤控制台 */}
      <div className="terminal-panel p-3 rounded-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="search"
              placeholder={tr('wSearchPh')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadWallets()}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
            />
          </div>
          <button
            onClick={loadWallets}
            className="px-3 py-1.5 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)] text-xs font-semibold cursor-pointer"
          >
            {tr('wSearchBtn')}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#f5c042]"
          >
            <option value="">{tr('wAllGrades')}</option>
            <option value="S">{tr('wGradeS')}</option>
            <option value="A">{tr('wGradeA')}</option>
            <option value="B">{tr('wGradeB')}</option>
            <option value="C">{tr('wGradeC')}</option>
            <option value="D">{tr('wGradeD')}</option>
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#f5c042]"
          >
            <option value="score">{tr('wSortScore')}</option>
            <option value="cycles">{tr('wSortCycles')}</option>
            <option value="bridges">{tr('wSortBridges')}</option>
            <option value="roundtrips">{tr('wSortRoundtrips')}</option>
            <option value="recent">{tr('wSortRecent')}</option>
          </select>

          <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={hideContracts}
              onChange={(e) => setHideContracts(e.target.checked)}
              className="rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
            />
            <span>{tr('wHideContracts')}</span>
          </label>
        </div>
      </div>

      {/* 钱包表格 */}
      <div className="terminal-panel rounded-lg overflow-hidden border border-[var(--border-subtle)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[var(--text-primary)]">
            <thead className="bg-[var(--bg-elevated)]/60 text-[var(--text-secondary)] font-medium tracking-tight text-[11px] border-b border-[var(--border-subtle)]">
              <tr>
                <th className="py-2.5 px-3">{tr('thGrade')}</th>
                <th className="py-2.5 px-3">{tr('thAddress')}</th>
                <th className="py-2.5 px-3 text-right">{tr('thScore')}</th>
                <th className="py-2.5 px-3 text-right">{tr('thCycles')}</th>
                <th className="py-2.5 px-3 text-right">{tr('thBridges')}</th>
                <th className="py-2.5 px-3 text-right">{tr('thRoundtrips')}</th>
                <th className="py-2.5 px-3">{tr('thTags')}</th>
                <th className="py-2.5 px-3">{tr('thLastSeen')}</th>
                <th className="py-2.5 px-3 text-center">{tr('thAction')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] font-mono-num">
              {wallets.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-[var(--text-muted)] font-sans">
                    {loading ? tr('searching') : tr('wNoData')}
                  </td>
                </tr>
              ) : (
                wallets.map((w) => (
                  <tr
                    key={w.address}
                    onClick={() => onSelectWallet(w)}
                    className="hover:bg-[var(--bg-elevated)]/40 transition duration-150 cursor-pointer"
                  >
                    <td className="py-2 px-3 font-sans">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        w.grade === 'S' ? 'bg-amber-400/20 text-amber-400 border border-amber-400/40 shadow-sm' :
                        w.grade === 'A' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' :
                        w.grade === 'B' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30' :
                        w.grade === 'C' ? 'bg-slate-500/20 text-slate-300 border border-slate-500/30' :
                        'bg-slate-700/20 text-[var(--text-muted)] border border-[var(--border-subtle)]'
                      }`}>
                        {w.grade}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-[var(--text-primary)]">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => toggleStar(e, w)}
                          className={`hover:scale-110 transition ${w.starred ? 'text-amber-400' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                        >
                          <Star size={13} fill={w.starred ? 'currentColor' : 'none'} />
                        </button>
                        <span>{short(w.address, 8)}</span>
                        <button
                          onClick={(e) => handleCopy(e, w.address)}
                          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
                          title="复制完整地址"
                        >
                          {copied === w.address ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                        </button>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <span className={`font-mono-num font-bold text-xs ${
                          w.score >= 90 ? 'text-amber-400' :
                          w.score >= 75 ? 'text-emerald-400' :
                          w.score >= 50 ? 'text-sky-400' :
                          w.score >= 25 ? 'text-[var(--text-secondary)]' :
                          'text-[var(--text-muted)]'
                        }`}>{w.score}</span>
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">/100</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right font-extrabold text-emerald-500">
                      {w.capitalCycles > 0 ? `${w.capitalCycles}` : <span className="text-[var(--text-muted)] font-normal">0</span>}
                    </td>
                    <td className="py-2 px-3 text-right text-[var(--text-primary)]">{w.bridgeCount}</td>
                    <td className="py-2 px-3 text-right text-[var(--text-secondary)]">{w.roundtrips}</td>
                    <td className="py-2 px-3 font-sans">
                      <div className="flex flex-wrap gap-1">
                        {(w.autoTags || []).slice(0, 3).map((tag, i) => (
                          <span key={i} className="px-1.5 py-0.2 rounded text-[10px] bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-[var(--text-muted)] text-[11px] whitespace-nowrap">{ago(w.lastSeen)}</td>
                    <td className="py-2 px-3 text-center font-sans">
                      <a
                        href={`https://debank.com/profile/${w.address}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600/10 hover:bg-blue-600/25 text-blue-500 dark:text-blue-400 border border-blue-500/20 text-[10px] font-semibold transition"
                      >
                        <span>DeBank</span>
                        <ExternalLink size={10} />
                      </a>
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
