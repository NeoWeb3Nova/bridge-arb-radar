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
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              placeholder={tr('wSearchPh')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadWallets()}
              className="w-full bg-slate-950/70 dark:bg-slate-950/70 border border-slate-800 rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={loadWallets}
            className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold cursor-pointer"
          >
            {tr('wSearchBtn')}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value="">{tr('wAllGrades')}</option>
            <option value="A">{tr('wGradeA')}</option>
            <option value="B">{tr('wGradeB')}</option>
            <option value="C">{tr('wGradeC')}</option>
            <option value="D">{tr('wGradeD')}</option>
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value="score">{tr('wSortScore')}</option>
            <option value="cycles">{tr('wSortCycles')}</option>
            <option value="bridges">{tr('wSortBridges')}</option>
            <option value="roundtrips">{tr('wSortRoundtrips')}</option>
            <option value="recent">{tr('wSortRecent')}</option>
          </select>

          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={hideContracts}
              onChange={(e) => setHideContracts(e.target.checked)}
              className="rounded bg-slate-900 border-slate-800"
            />
            <span>{tr('wHideContracts')}</span>
          </label>
        </div>
      </div>

      {/* 钱包表格 */}
      <div className="terminal-panel rounded-lg overflow-hidden border border-slate-800/80">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 font-medium tracking-tight text-[11px] border-b border-slate-800">
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
            <tbody className="divide-y divide-slate-800/60 font-mono-num">
              {wallets.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-500 font-sans">
                    {loading ? tr('searching') : tr('wNoData')}
                  </td>
                </tr>
              ) : (
                wallets.map((w) => (
                  <tr
                    key={w.address}
                    onClick={() => onSelectWallet(w)}
                    className="hover:bg-slate-800/40 transition duration-150 cursor-pointer"
                  >
                    <td className="py-2 px-3 font-sans">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        w.grade === 'A' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' :
                        w.grade === 'B' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30' :
                        'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}>
                        {w.grade}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-200">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => toggleStar(e, w)}
                          className={`hover:scale-110 transition ${w.starred ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
                        >
                          <Star size={13} fill={w.starred ? 'currentColor' : 'none'} />
                        </button>
                        <span>{short(w.address, 8)}</span>
                        <button
                          onClick={(e) => handleCopy(e, w.address)}
                          className="text-slate-500 hover:text-slate-300 transition"
                          title="复制完整地址"
                        >
                          {copied === w.address ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                        </button>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right font-bold text-slate-100">{w.score}</td>
                    <td className="py-2 px-3 text-right font-extrabold text-emerald-500 dark:text-emerald-400">
                      {w.capitalCycles > 0 ? `${w.capitalCycles}` : <span className="text-slate-500 font-normal">0</span>}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-300">{w.bridgeCount}</td>
                    <td className="py-2 px-3 text-right text-slate-400">{w.roundtrips}</td>
                    <td className="py-2 px-3 font-sans">
                      <div className="flex flex-wrap gap-1">
                        {(w.autoTags || []).slice(0, 3).map((tag, i) => (
                          <span key={i} className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800/80 text-slate-300 border border-slate-700/60">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-slate-400 text-[11px] whitespace-nowrap">{ago(w.lastSeen)}</td>
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
