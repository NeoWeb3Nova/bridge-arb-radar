import React, { useState, useEffect, useRef, useMemo } from 'react';
import { OpportunityItem } from '../types';
import { usd, usdCompact, agoSec } from '../utils/format';
import { calculateNetArb, resolveBridgeRoute, LiveQuoteData } from '../utils/routeEstimator';
import { VerdictBadge } from './VerdictBadge';
import { OpportunityCard } from './OpportunityCard';
import { 
  ArrowRight, ExternalLink, Copy, Check, FileEdit, 
  ChevronDown, ChevronUp, Search, Filter, ArrowUpDown, 
  Sparkles, ShieldCheck, Layers, LayoutGrid, Table, DollarSign,
  TrendingUp, CheckCircle, AlertTriangle, RefreshCw, Clock
} from 'lucide-react';
import { useI18n } from '../context/I18nContext';

interface Props {
  opportunities: OpportunityItem[];
  onSelectOpp: (opp: OpportunityItem) => void;
  sseConnected?: boolean;
}

type SortField = 'score' | 'netProfit' | 'spread' | 'liquidity' | 'volume' | 'time';
type SortOrder = 'desc' | 'asc';
type VerdictFilter = 'all' | 'verified' | 'clean';

export const ArbitrageMatrix: React.FC<Props> = ({ 
  opportunities, 
  onSelectOpp, 
  sseConnected = true 
}) => {
  const { locale, t: tr } = useI18n();

  // 1. Controls State
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [capitalUsd, setCapitalUsd] = useState<number>(1000);
  const [customCapital, setCustomCapital] = useState<string>('1000');
  const [chainFilter, setChainFilter] = useState<string>('all');
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('netProfit');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Copy state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Live on-chain quoting state
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveQuoteData>>({});
  const [loadingQuotes, setLoadingQuotes] = useState<Record<string, boolean>>({});
  const [justRefreshedKey, setJustRefreshedKey] = useState<string | null>(null);

  // 1-second timer tick for quote validity countdown
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchLiveQuote = async (opp: OpportunityItem, capital: number, force = false) => {
    const key = `${opp.symbol}-${opp.buyChain}-${opp.sellChain}`;
    if (!force && liveQuotes[key]) return;
    setLoadingQuotes((prev) => ({ ...prev, [key]: true }));
    try {
      const q = new URLSearchParams({
        buyChain: opp.buyChain,
        sellChain: opp.sellChain,
        buyAddress: opp.buyAddress || '',
        sellAddress: opp.sellAddress || '',
        amountUsd: String(capital),
        force: force ? 'true' : 'false',
        _t: String(Date.now()),
      });
      const res = await fetch(`/api/quote/live?${q.toString()}`);
      if (res.ok) {
        const data: LiveQuoteData = await res.json();
        if (data && data.ok) {
          setLiveQuotes((prev) => ({ ...prev, [key]: data }));
          if (force) {
            setJustRefreshedKey(key);
            setTimeout(() => setJustRefreshedKey(null), 2500);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch live quote:', e);
    } finally {
      setLoadingQuotes((prev) => ({ ...prev, [key]: false }));
    }
  };

  // Trigger live quote whenever a row is expanded or capitalUsd changes
  useEffect(() => {
    if (!expandedKey) return;
    const opp = opportunities.find((o) => `${o.symbol}-${o.buyChain}-${o.sellChain}` === expandedKey);
    if (opp) {
      fetchLiveQuote(opp, capitalUsd);
    }
  }, [expandedKey, capitalUsd, opportunities]);

  // 2. Price Flash Tracking
  const [flashMap, setFlashMap] = useState<Record<string, 'up' | 'down'>>({});
  const prevPricesRef = useRef<Record<string, { buy: number; sell: number; spread: number }>>({});

  useEffect(() => {
    const newFlash: Record<string, 'up' | 'down'> = {};
    let hasChanges = false;

    opportunities.forEach((opp) => {
      const key = `${opp.symbol}-${opp.buyChain}-${opp.sellChain}`;
      const prev = prevPricesRef.current[key];
      if (prev) {
        if (opp.spreadPct > prev.spread + 0.05 || opp.buyPrice < prev.buy * 0.998 || opp.sellPrice > prev.sell * 1.002) {
          newFlash[key] = 'up';
          hasChanges = true;
        } else if (opp.spreadPct < prev.spread - 0.05) {
          newFlash[key] = 'down';
          hasChanges = true;
        }
      }
      prevPricesRef.current[key] = {
        buy: opp.buyPrice,
        sell: opp.sellPrice,
        spread: opp.spreadPct,
      };
    });

    if (hasChanges) {
      setFlashMap((prev) => ({ ...prev, ...newFlash }));
      const timer = setTimeout(() => {
        setFlashMap({});
      }, 1400);
      return () => clearTimeout(timer);
    }
  }, [opportunities]);

  const handleCopy = (e: React.MouseEvent, text: string | null, key: string) => {
    e.stopPropagation();
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // Extract unique chains for filtering
  const availableChains = useMemo(() => {
    const s = new Set<string>();
    opportunities.forEach((o) => {
      if (o.buyChain) s.add(o.buyChain);
      if (o.sellChain) s.add(o.sellChain);
    });
    return Array.from(s).sort();
  }, [opportunities]);

  // Handle Capital Change
  const applyCapital = (val: number) => {
    setCapitalUsd(val);
    setCustomCapital(String(val));
  };

  // Filter and Sort Data
  const processedData = useMemo(() => {
    return opportunities
      .filter((opp) => {
        // Search
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchSymbol = opp.symbol.toLowerCase().includes(q);
          const matchBuyChain = opp.buyChain.toLowerCase().includes(q) || opp.buyChainName?.toLowerCase().includes(q);
          const matchSellChain = opp.sellChain.toLowerCase().includes(q) || opp.sellChainName?.toLowerCase().includes(q);
          if (!matchSymbol && !matchBuyChain && !matchSellChain) return false;
        }
        // Chain Filter
        if (chainFilter !== 'all') {
          if (opp.buyChain !== chainFilter && opp.sellChain !== chainFilter) return false;
        }
        // Verdict Filter
        if (verdictFilter === 'verified') {
          if (opp.verdict !== 'official' && opp.verdict !== 'confirmed') return false;
        } else if (verdictFilter === 'clean') {
          if (opp.verdict === 'fake' || opp.verdict === 'suspicious' || opp.suspicious) return false;
        }
        return true;
      })
      .map((opp) => {
        const key = `${opp.symbol}-${opp.buyChain}-${opp.sellChain}`;
        const netCalc = calculateNetArb(
          opp.buyPrice,
          opp.sellPrice,
          opp.spreadPct,
          opp.minLiquidityUsd,
          opp.buyChain,
          opp.sellChain,
          capitalUsd,
          liveQuotes[key],
          opp.sellQuoteReserveUsd,
          opp.buyBaseReserveUsd
        );
        return {
          ...opp,
          netCalc,
          uniqueKey: key,
        };
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortField === 'score') {
          diff = a.netCalc.score - b.netCalc.score;
        } else if (sortField === 'netProfit') {
          diff = a.netCalc.netProfitUsd - b.netCalc.netProfitUsd;
        } else if (sortField === 'spread') {
          diff = a.spreadPct - b.spreadPct;
        } else if (sortField === 'liquidity') {
          diff = (a.minLiquidityUsd || 0) - (b.minLiquidityUsd || 0);
        } else if (sortField === 'volume') {
          diff = (a.minVolume24h || 0) - (b.minVolume24h || 0);
        } else if (sortField === 'time') {
          const ta = a.ts ? new Date(a.ts).getTime() : 0;
          const tb = b.ts ? new Date(b.ts).getTime() : 0;
          diff = ta - tb;
        }
        return sortOrder === 'desc' ? -diff : diff;
      });
  }, [opportunities, searchQuery, chainFilter, verdictFilter, capitalUsd, sortField, sortOrder, liveQuotes]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const chainBadgeColor = (chain: string) => {
    const c = (chain || '').toLowerCase();
    if (c === 'bsc') return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    if (c === 'arbitrum') return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    if (c === 'base') return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    if (c === 'optimism') return 'bg-red-500/15 text-red-400 border-red-500/30';
    if (c === 'polygon') return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
    if (c === 'ethereum') return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30';
    if (c === 'solana') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    if (c === 'avalanche') return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30';
  };

  return (
    <div className="space-y-3.5">
      {/* 顶部控制与量化筛选栏 */}
      <div className="terminal-panel p-3.5 rounded-lg space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* 左侧：标题与状态指示 */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <TrendingUp size={16} className="text-[#f5c042]" />
              <span>{tr('dmTitle')}</span>
            </h2>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#45c4b0]/10 border border-[#45c4b0]/25 text-[10px] font-mono font-semibold text-[#45c4b0]">
              <span className={`w-1.5 h-1.5 rounded-full bg-[#45c4b0] ${sseConnected ? 'animate-pulse-dot' : ''}`} />
              <span>{sseConnected ? tr('dmLiveTracking') : 'OFFLINE'}</span>
            </div>
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              ({processedData.length} {locale === 'zh' ? '条套利路径' : 'routes'})
            </span>
          </div>

          {/* 右侧：模拟头寸 Position Sizer & 视图切换 */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs bg-[var(--bg-base)] px-2.5 py-1 rounded-md border border-[var(--border-subtle)]">
              <DollarSign size={13} className="text-[#f5c042]" />
              <span className="text-[var(--text-secondary)] font-medium text-[11px]">{locale === 'zh' ? '模拟本金 (USD):' : 'Capital (USD):'}</span>
              {[500, 1000, 2500, 5000].map((c) => (
                <button
                  key={c}
                  onClick={() => applyCapital(c)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition cursor-pointer ${
                    capitalUsd === c
                      ? 'bg-[#f5c042] text-black shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                  }`}
                >
                  ${c}
                </button>
              ))}
              <div className="flex items-center ml-1">
                <span className="text-[10px] text-[var(--text-muted)] mr-0.5">$</span>
                <input
                  type="number"
                  value={customCapital}
                  onChange={(e) => {
                    setCustomCapital(e.target.value);
                    const n = parseFloat(e.target.value);
                    if (n > 0) setCapitalUsd(n);
                  }}
                  className="w-14 bg-transparent border-b border-[var(--border-subtle)] text-[10px] font-mono-num font-bold text-[var(--text-primary)] focus:outline-none focus:border-[#f5c042]"
                  placeholder="自定义"
                />
              </div>
            </div>

            {/* 视图切换 */}
            <div className="flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-0.5">
              <button
                onClick={() => setViewMode('table')}
                className={`p-1 rounded text-xs transition cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-[var(--bg-elevated)] text-[#f5c042] font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
                title={tr('dmViewTable')}
              >
                <Table size={14} />
              </button>
              <button
                onClick={() => setViewMode('cards')}
                className={`p-1 rounded text-xs transition cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-[var(--bg-elevated)] text-[#f5c042] font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
                title={tr('dmViewCards')}
              >
                <LayoutGrid size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* 筛选过滤行 */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-[var(--border-subtle)] text-xs">
          <div className="flex items-center gap-2 flex-wrap flex-1 max-w-2xl">
            {/* 搜索 */}
            <div className="relative min-w-[140px] flex-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder={tr('dmSearchPh')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-md pl-7 pr-2.5 py-1 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] uppercase font-mono font-medium focus:outline-none focus:border-[#f5c042]"
              />
            </div>

            {/* 链过滤 */}
            <select
              value={chainFilter}
              onChange={(e) => setChainFilter(e.target.value)}
              className="bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-md px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#f5c042]"
            >
              <option value="all">{tr('dmAllChains')}</option>
              {availableChains.map((c) => (
                <option key={c} value={c}>
                  {c.toUpperCase()}
                </option>
              ))}
            </select>

            {/* 认证过滤 */}
            <select
              value={verdictFilter}
              onChange={(e) => setVerdictFilter(e.target.value as VerdictFilter)}
              className="bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-md px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#f5c042]"
            >
              <option value="all">{locale === 'zh' ? '全部裁决' : 'All Verdicts'}</option>
              <option value="verified">{tr('dmFilterVerifiedOnly')}</option>
              <option value="clean">{tr('dmFilterExcludeRisky')}</option>
            </select>
          </div>

          {/* 排序快捷切换 */}
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <span className="text-[var(--text-muted)]">{locale === 'zh' ? '排序:' : 'Sort:'}</span>
            <button
              onClick={() => toggleSort('netProfit')}
              className={`px-2 py-0.5 rounded font-mono transition cursor-pointer flex items-center gap-1 ${
                sortField === 'netProfit'
                  ? 'bg-[#45c4b0]/15 text-[#45c4b0] font-bold border border-[#45c4b0]/30'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>{tr('dmSortNetProfit')}</span>
              {sortField === 'netProfit' && (sortOrder === 'desc' ? '↓' : '↑')}
            </button>
            <button
              onClick={() => toggleSort('spread')}
              className={`px-2 py-0.5 rounded font-mono transition cursor-pointer flex items-center gap-1 ${
                sortField === 'spread'
                  ? 'bg-[#f5c042]/15 text-[#f5c042] font-bold border border-[#f5c042]/30'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>{tr('dmSortSpread')}</span>
              {sortField === 'spread' && (sortOrder === 'desc' ? '↓' : '↑')}
            </button>
            <button
              onClick={() => toggleSort('liquidity')}
              className={`px-2 py-0.5 rounded font-mono transition cursor-pointer flex items-center gap-1 ${
                sortField === 'liquidity'
                  ? 'bg-blue-500/15 text-blue-400 font-bold border border-blue-500/30'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>{tr('dmSortLiquidity')}</span>
              {sortField === 'liquidity' && (sortOrder === 'desc' ? '↓' : '↑')}
            </button>
          </div>
        </div>
      </div>

      {/* 主展示区：表格模式 OR 卡片模式 */}
      {viewMode === 'table' ? (
        <div className="terminal-panel rounded-lg overflow-hidden border border-[var(--border-subtle)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[var(--text-primary)]">
              <thead className="bg-[var(--bg-elevated)]/70 text-[var(--text-secondary)] font-medium tracking-tight text-[11px] border-b border-[var(--border-subtle)] select-none">
                <tr>
                  <th 
                    onClick={() => toggleSort('time')}
                    className="py-2.5 px-3 cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center gap-1">
                      <span>{tr('dmColAsset')}</span>
                      <ArrowUpDown size={11} className="text-[var(--text-muted)]" />
                    </div>
                  </th>
                  <th 
                    onClick={() => toggleSort('score')}
                    className="py-2.5 px-3 cursor-pointer hover:text-[var(--text-primary)] text-center whitespace-nowrap"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span>{tr('thArbScore')}</span>
                      <ArrowUpDown size={11} className={sortField === 'score' ? 'text-[#f5c042]' : 'text-[var(--text-muted)]'} />
                    </div>
                  </th>
                  <th className="py-2.5 px-3">{tr('dmColBuyLeg')}</th>
                  <th className="py-2.5 px-3">{tr('dmColBridgeRoute')}</th>
                  <th className="py-2.5 px-3">{tr('dmColSellLeg')}</th>
                  <th 
                    onClick={() => toggleSort('spread')}
                    className="py-2.5 px-3 cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center gap-1">
                      <span>{tr('dmColSpread')}</span>
                      <ArrowUpDown size={11} className="text-[var(--text-muted)]" />
                    </div>
                  </th>
                  <th 
                    onClick={() => toggleSort('netProfit')}
                    className="py-2.5 px-3 cursor-pointer hover:text-[var(--text-primary)] text-right"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{tr('dmColNetProfit')} ({usd(capitalUsd, 0)})</span>
                      <ArrowUpDown size={11} className="text-[#45c4b0]" />
                    </div>
                  </th>
                  <th 
                    onClick={() => toggleSort('liquidity')}
                    className="py-2.5 px-3 cursor-pointer hover:text-[var(--text-primary)] text-right"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>{tr('dmColLiquidity')} / {locale === 'zh' ? '成交量' : 'Vol'}</span>
                      <ArrowUpDown size={11} className={sortField === 'liquidity' || sortField === 'volume' ? 'text-[#45c4b0]' : 'text-[var(--text-muted)]'} />
                    </div>
                  </th>
                  <th className="py-2.5 px-3 text-center">{tr('dmColAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {processedData.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-16 text-[var(--text-muted)] text-xs">
                      {tr('noOpps')}
                    </td>
                  </tr>
                ) : (
                  processedData.map((row) => {
                    const isExpanded = expandedKey === row.uniqueKey;
                    const flash = flashMap[row.uniqueKey];
                    const flashClass = flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : '';
                    const isNetPositive = row.netCalc.isProfitable;

                    return (
                      <React.Fragment key={row.uniqueKey}>
                        <tr 
                          onClick={() => setExpandedKey(isExpanded ? null : row.uniqueKey)}
                          className={`hover:bg-[var(--bg-elevated)]/50 transition duration-150 cursor-pointer ${flashClass} ${
                            isExpanded ? 'bg-[var(--bg-elevated)]/30' : ''
                          }`}
                        >
                          {/* 1. 资产与认证 */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-[var(--text-primary)] font-mono text-sm tracking-tight">
                                {row.symbol}
                              </span>
                              <VerdictBadge verdict={row.verdict} size="xs" />
                              {row.decision?.status && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-[#45c4b0]/15 text-[#45c4b0] border border-[#45c4b0]/25">
                                  {row.decision.status}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-1 mt-0.5 font-mono">
                              <span className="text-[#45c4b0] font-bold">●</span>
                              <span>{agoSec(row.ts, locale)}</span>
                            </div>
                          </td>

                          {/* 综合评分 */}
                          <td className="py-2.5 px-3 whitespace-nowrap text-center">
                            <div className="inline-flex flex-col items-center">
                              <div className={`px-2 py-0.5 rounded text-xs font-mono font-bold border flex items-center gap-1 ${
                                row.netCalc.score >= 85 ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 shadow-sm' :
                                row.netCalc.score >= 70 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                                row.netCalc.score >= 50 ? 'bg-sky-500/20 text-sky-400 border-sky-500/30' :
                                row.netCalc.score >= 25 ? 'bg-slate-500/20 text-slate-300 border-slate-500/30' :
                                'bg-rose-500/15 text-rose-400 border-rose-500/30'
                              }`} title={`综合评分明细 (100分制):\n• 净利: ${row.netCalc.scoreBreakdown.profitScore}/40\n• 储备: ${row.netCalc.scoreBreakdown.liquidityScore}/30\n• 通道: ${row.netCalc.scoreBreakdown.bridgeScore}/20\n• 活跃: ${row.netCalc.scoreBreakdown.volumeScore}/10\n• 扣分: -${row.netCalc.scoreBreakdown.penalty}`}>
                                <span>{row.netCalc.scoreGrade}</span>
                                <span className="font-mono-num">{row.netCalc.score}</span>
                              </div>
                              <span className="text-[9px] text-[var(--text-muted)] mt-0.5 truncate max-w-[85px]" title={row.netCalc.scoreComment}>
                                {row.netCalc.scoreComment}
                              </span>
                            </div>
                          </td>

                          {/* 2. 买入腿 */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${chainBadgeColor(row.buyChain)}`}>
                                {row.buyChain}
                              </span>
                              <span className="text-[11px] text-[var(--text-secondary)] font-medium">
                                {row.buyDex || 'DEX'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="font-mono-num font-bold text-xs text-[var(--text-primary)]">
                                {usd(row.buyPrice)}
                              </span>
                              {row.buyAddress && (
                                <div className="flex items-center gap-1 text-[10px] font-mono text-[var(--text-muted)]">
                                  <button
                                    onClick={(e) => handleCopy(e, row.buyAddress, `${row.uniqueKey}-buy`)}
                                    className="hover:text-[var(--text-primary)] cursor-pointer"
                                    title="复制买入代币合约"
                                  >
                                    {copiedKey === `${row.uniqueKey}-buy` ? <Check size={10} className="text-[#45c4b0]" /> : <Copy size={10} />}
                                  </button>
                                  {row.buyExplorer && (
                                    <a
                                      href={row.buyExplorer}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="hover:text-[#f5c042]"
                                    >
                                      <ExternalLink size={10} />
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* 3. 跨链路由通道 */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${row.netCalc.route.badgeClass}`}>
                                {row.netCalc.route.bridgeName}
                              </span>
                              <span className="text-[11px] text-[var(--text-secondary)] font-mono">
                                ~{row.netCalc.route.etaMinutes}m
                              </span>
                              {row.netCalc.isLiveQuote && (
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" title="链上实时询价已打通" />
                              )}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] font-mono-num mt-1 flex items-center gap-1">
                              <span>{locale === 'zh' ? (row.netCalc.isLiveQuote ? '实时费' : '预估费') : (row.netCalc.isLiveQuote ? 'Live Fee' : 'Est. Fee')}:</span>
                              <span className={row.netCalc.isLiveQuote ? 'text-emerald-400 font-bold' : ''}>
                                ~{usd(row.netCalc.estGasUsd + row.netCalc.estBridgeFeeUsd)}
                              </span>
                            </div>
                          </td>

                          {/* 4. 卖出腿 */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${chainBadgeColor(row.sellChain)}`}>
                                {row.sellChain}
                              </span>
                              <span className="text-[11px] text-[var(--text-secondary)] font-medium">
                                {row.sellDex || 'DEX'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="font-mono-num font-bold text-xs text-[var(--text-primary)]">
                                {usd(row.sellPrice)}
                              </span>
                              {row.sellAddress && (
                                <div className="flex items-center gap-1 text-[10px] font-mono text-[var(--text-muted)]">
                                  <button
                                    onClick={(e) => handleCopy(e, row.sellAddress, `${row.uniqueKey}-sell`)}
                                    className="hover:text-[var(--text-primary)] cursor-pointer"
                                    title="复制卖出代币合约"
                                  >
                                    {copiedKey === `${row.uniqueKey}-sell` ? <Check size={10} className="text-[#45c4b0]" /> : <Copy size={10} />}
                                  </button>
                                  {row.sellExplorer && (
                                    <a
                                      href={row.sellExplorer}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="hover:text-[#f5c042]"
                                    >
                                      <ExternalLink size={10} />
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* 5. 名义价差 */}
                          <td className="py-2.5 px-3 whitespace-nowrap font-mono-num">
                            <div className="font-bold text-xs text-[#f5c042]">
                              +{row.spreadPct.toFixed(2)}%
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                              Δ +{usd(row.netCalc.priceDelta)}
                            </div>
                          </td>

                          {/* 6. 预估净利 */}
                          <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono-num">
                            {isNetPositive ? (
                              <div>
                                <div className="font-bold text-xs text-[#45c4b0]">
                                  +{usd(row.netCalc.netProfitUsd)}
                                </div>
                                <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                                  +{row.netCalc.netRoiPct.toFixed(2)}% ROI
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div className="font-bold text-xs text-amber-500/80">
                                  {usd(row.netCalc.netProfitUsd)}
                                </div>
                                <span className="inline-block px-1 rounded text-[9px] bg-amber-500/10 text-amber-500 border border-amber-500/20 mt-0.5">
                                  {tr('dmUnprofitable')}
                                </span>
                              </div>
                            )}
                          </td>

                          {/* 7. 池流动性与成交量 */}
                          <td className="py-2.5 px-3 whitespace-nowrap text-right font-mono-num">
                            <div 
                              className="font-semibold text-xs text-[var(--text-primary)] cursor-help" 
                              title={`短板深度: ${usd(row.minLiquidityUsd)} | 买入池: ${usd(row.buyLiquidityUsd || row.minLiquidityUsd)} | 卖出池: ${usd(row.sellLiquidityUsd || row.minLiquidityUsd)} | 建议单笔上限: ${usd(row.netCalc.maxSafeCapacityUsd)}`}
                            >
                              {usdCompact(row.minLiquidityUsd)}
                              <span className="text-[10px] text-[var(--text-muted)] font-normal ml-1">
                                ({locale === 'zh' ? '深度' : 'Depth'})
                              </span>
                            </div>
                            <div className="text-[10px] mt-0.5">
                              {row.netCalc.liquidityHealth === 'safe' && (
                                <span className="text-[#45c4b0] font-sans">
                                  {locale === 'zh' ? '深度充裕' : 'Deep'} (~{row.netCalc.poolImpactPct.toFixed(1)}%)
                                </span>
                              )}
                              {row.netCalc.liquidityHealth === 'moderate' && (
                                <span className="text-amber-400 font-sans">
                                  {locale === 'zh' ? '注意滑点' : 'Slippage'} (~{row.netCalc.poolImpactPct.toFixed(1)}%)
                                </span>
                              )}
                              {row.netCalc.liquidityHealth === 'dangerous' && (
                                <span className="text-rose-400 font-sans font-bold">
                                  {locale === 'zh' ? '⚠️ 冲击过大' : '⚠️ Heavy Impact'} ({row.netCalc.poolImpactPct.toFixed(1)}%)
                                </span>
                              )}
                            </div>
                            {/* 6h/24h 交易量与单边现金池枯竭熔断指示 */}
                            <div className="mt-1 flex items-center justify-end gap-1 font-mono-num flex-wrap">
                              {row.sellQuoteReserveUsd !== undefined && row.sellQuoteReserveUsd < 500 ? (
                                <span 
                                  className="px-1.5 py-0.2 rounded bg-rose-500/25 text-rose-300 border border-rose-500/50 text-[9px] font-bold font-sans animate-pulse"
                                  title={`致命单边池：卖出池 ${row.sellQuoteSymbol || '现金'} 储备仅 $${row.sellQuoteReserveUsd.toFixed(2)} (仅占池 ${( (row.sellQuoteRatio || 0) * 100).toFixed(1)}%)！TVL 是单边代币虚标，实际无法承兑变现`}
                                >
                                  ⚠️ 现金枯竭 ({row.sellQuoteSymbol || 'Quote'} ${row.sellQuoteReserveUsd.toFixed(0)})
                                </span>
                              ) : row.minVolume6h === 0 ? (
                                <span 
                                  className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[9px] font-bold font-sans animate-pulse"
                                  title={`近6小时短板池成交为$0 (买端6h: ${usd(row.buyVolume6h || 0)}, 卖端6h: ${usd(row.sellVolume6h || 0)})！极高概率为无对手盘的死池或虚假陈旧挂单`}
                                >
                                  ⚠️ 6h零成交(死池)
                                </span>
                              ) : (row.minVolume24h !== undefined && row.minVolume24h < 500) ? (
                                <span 
                                  className="px-1 py-0.2 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[9px] font-sans"
                                  title={`24小时成交量仅 ${usd(row.minVolume24h || 0)}，换手严重不足`}
                                >
                                  ⚠️ 24h极低量
                                </span>
                              ) : row.minVolume24h !== undefined ? (
                                <span 
                                  className={`text-[9px] ${row.minVolume24h >= 50000 ? 'text-emerald-400 font-semibold' : 'text-[var(--text-muted)]'}`}
                                  title={`24h短板量: ${usd(row.minVolume24h)} | 6h短板量: ${usd(row.minVolume6h || 0)}`}
                                >
                                  24h量: {usdCompact(row.minVolume24h)}
                                </span>
                              ) : null}
                            </div>
                          </td>

                          {/* 8. 操作与展开 */}
                          <td className="py-2.5 px-3 whitespace-nowrap text-center">
                            <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => onSelectOpp(row)}
                                className="px-2 py-1 rounded bg-[#f5c042]/15 hover:bg-[#f5c042]/25 text-[#f5c042] border border-[#f5c042]/30 text-[11px] font-semibold transition cursor-pointer flex items-center gap-1"
                                title="调出决策操盘弹窗"
                              >
                                <FileEdit size={11} />
                                <span>{tr('dmTrack')}</span>
                              </button>
                              <button
                                onClick={() => setExpandedKey(isExpanded ? null : row.uniqueKey)}
                                className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition cursor-pointer"
                                title={isExpanded ? tr('dmCollapse') : tr('dmExpand')}
                              >
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* 展开的深度与执行子面板 */}
                        {isExpanded && (() => {
                          const isQuoting = !!loadingQuotes[row.uniqueKey];
                          const liveData = row.netCalc.liveQuoteData;
                          const ttlSec = liveData?.ttlSeconds || 60;
                          const expiresAt = liveData?.expiresAt || (liveData?.updatedAt ? liveData.updatedAt + ttlSec * 1000 : 0);
                          const remainingSec = expiresAt > 0 ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
                          const isExpired = expiresAt > 0 && remainingSec === 0;
                          const isExpiringSoon = expiresAt > 0 && remainingSec > 0 && remainingSec <= 15;

                          return (
                            <tr className="bg-[var(--bg-elevated)]/25">
                              <td colSpan={9} className="p-4 border-t border-[var(--border-subtle)]">
                                {/* 链上实时询价打通状态横幅 */}
                                <div className="mb-2 px-3.5 py-2.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                                  <div className="flex items-center gap-2">
                                    {isQuoting ? (
                                      <div className="flex items-center gap-2 text-sky-400 text-xs font-mono">
                                        <RefreshCw size={13} className="animate-spin text-sky-400" />
                                        <span>直连 Li.Fi / Across / Stargate 跨链聚合器实时询价中...</span>
                                      </div>
                                    ) : row.netCalc.isLiveQuote ? (
                                      <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="flex items-center gap-1.5 font-bold text-emerald-400">
                                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                          ● 链上实时询价已打通 ({row.netCalc.route.bridgeName})
                                        </span>
                                        {liveData?.hasApiKey && (
                                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                            PRO KEY 加速
                                          </span>
                                        )}
                                        {liveData?.details?.apiKeyWarning && (
                                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30" title={liveData.details.apiKeyWarning}>
                                            Key失效 · 公共源
                                          </span>
                                        )}
                                        <span className="text-[10px] text-[var(--text-muted)] font-mono">
                                          实测 ~{liveData?.etaSeconds || 60}s 到账 · 实时 Gas 与中继费已锁定
                                        </span>

                                        {/* 报价有效期倒计时指示器 */}
                                        {expiresAt > 0 && (
                                          <div className="flex items-center gap-1 font-mono text-[10px]">
                                            {isExpired ? (
                                              <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center gap-1 font-bold animate-pulse">
                                                <Clock size={10} />
                                                报价已过期 (0s)
                                              </span>
                                            ) : isExpiringSoon ? (
                                              <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1 font-bold animate-pulse">
                                                <Clock size={10} />
                                                有效期仅剩: {remainingSec}s
                                              </span>
                                            ) : (
                                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                                                <Clock size={10} />
                                                报价有效: {remainingSec}s
                                              </span>
                                            )}
                                          </div>
                                        )}

                                        {liveData?.updatedAt && (
                                          <span className="text-[9px] text-[var(--text-muted)] font-mono">
                                            ({new Date(liveData.updatedAt).toLocaleTimeString()} 更新)
                                          </span>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="text-amber-400/90 font-medium flex items-center gap-1">
                                          <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                                          ⚙️ 基准模型测算 (离线兜底)
                                        </span>
                                        {liveData?.details?.note ? (
                                          <span className="text-[10px] text-amber-300/90 font-mono bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/25 max-w-xl truncate" title={liveData.details.note}>
                                            原因: {liveData.details.note}
                                          </span>
                                        ) : (
                                          <span className="text-[10px] text-[var(--text-muted)] font-mono">
                                            点击右侧按钮可直连链上聚合器进行毫秒级真实询价
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    {liveData?.details?.gasTokens && liveData.details.gasTokens.length > 0 && (
                                      <span className="text-[10px] font-mono text-[var(--text-secondary)] hidden lg:inline">
                                        Gas 构成: {liveData.details.gasTokens.join(' · ')}
                                      </span>
                                    )}
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        fetchLiveQuote(row, capitalUsd, true);
                                      }}
                                      disabled={isQuoting}
                                      className={`px-2.5 py-1 rounded text-[10px] font-mono flex items-center gap-1.5 cursor-pointer transition border disabled:opacity-50 ${
                                        justRefreshedKey === row.uniqueKey
                                          ? (row.netCalc.isLiveQuote
                                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                              : 'bg-amber-500/20 text-amber-300 border-amber-500/40')
                                          : (isExpired
                                            ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40 animate-pulse'
                                            : 'bg-[var(--bg-elevated)] hover:bg-[var(--bg-elevated)]/80 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)]')
                                      }`}
                                      title="强制重新向链上发起实时询价，突破缓存"
                                    >
                                      {justRefreshedKey === row.uniqueKey ? (
                                        row.netCalc.isLiveQuote ? (
                                          <>
                                            <Check size={11} className="text-emerald-400" />
                                            <span className="font-bold">链上实时报价已更新 ✓</span>
                                          </>
                                        ) : (
                                          <>
                                            <AlertTriangle size={11} className="text-amber-400" />
                                            <span className="font-bold">暂无直连 · 沿用基准测算</span>
                                          </>
                                        )
                                      ) : isQuoting ? (
                                        <>
                                          <RefreshCw size={11} className="animate-spin text-sky-400" />
                                          <span>直连链上询价中...</span>
                                        </>
                                      ) : isExpired ? (
                                        <>
                                          <RefreshCw size={11} className="text-amber-300" />
                                          <span className="font-bold">报价已过期 · 点击刷新</span>
                                        </>
                                      ) : (
                                        <>
                                          <RefreshCw size={11} />
                                          <span>{row.netCalc.isLiveQuote ? '重新询价' : '发起链上实时询价'}</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>

                                {/* 套利可行性综合评分横幅 (100分制) */}
                                <div className="mb-3 px-3 py-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <div className="flex items-center gap-2">
                                    <div className={`px-2 py-0.5 rounded font-bold font-mono text-xs border flex items-center gap-1 ${
                                      row.netCalc.score >= 85 ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 shadow-sm' :
                                      row.netCalc.score >= 70 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                                      row.netCalc.score >= 50 ? 'bg-sky-500/20 text-sky-400 border-sky-500/30' :
                                      row.netCalc.score >= 25 ? 'bg-slate-500/20 text-slate-300 border-slate-500/30' :
                                      'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                    }`}>
                                      <span className="font-extrabold">{row.netCalc.scoreGrade} 级</span>
                                      <span className="font-mono-num">{row.netCalc.score} 分</span>
                                    </div>
                                    <span className="font-semibold text-[var(--text-primary)]">
                                      {row.netCalc.scoreComment}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--text-secondary)]">
                                    <span>净利: <strong className="text-[var(--text-primary)]">{row.netCalc.scoreBreakdown.profitScore}</strong>/40</span>
                                    <span>储备: <strong className="text-[var(--text-primary)]">{row.netCalc.scoreBreakdown.liquidityScore}</strong>/30</span>
                                    <span>通道: <strong className="text-[var(--text-primary)]">{row.netCalc.scoreBreakdown.bridgeScore}</strong>/20</span>
                                    <span>活跃: <strong className="text-[var(--text-primary)]">{row.netCalc.scoreBreakdown.volumeScore}</strong>/10</span>
                                    {row.netCalc.scoreBreakdown.penalty > 0 && (
                                      <span className="text-rose-400 font-bold bg-rose-500/10 px-1.5 py-0.2 rounded border border-rose-500/20">
                                        扣分 -{row.netCalc.scoreBreakdown.penalty}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                  {/* 执行流水线 */}
                                  <div className="space-y-2">
                                    <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                                      <Sparkles size={13} className="text-[#f5c042]" />
                                      <span>{tr('dmExecutionPlan')}</span>
                                    </div>
                                    <div className="space-y-1.5 text-[11px]">
                                      <div className="flex items-center justify-between p-2 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)]">
                                        <div>
                                          <span className="text-[var(--text-muted)] font-mono">1. 买入: </span>
                                          <span className="font-semibold text-[var(--text-primary)]">{row.buyChainName} · {row.buyDex}</span>
                                          <div className="text-[10px] text-[var(--text-muted)] font-mono-num mt-0.5">
                                            投入 <span className="text-[#f5c042] font-bold">${capitalUsd} USD</span> ➔ 买入 <span className="text-[var(--text-primary)] font-bold">{row.netCalc.tokensBought.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> {row.symbol} (单价 {usd(row.buyPrice)})
                                          </div>
                                        </div>
                                        {row.buyUrl && (
                                          <a href={row.buyUrl} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] hover:text-[#f5c042] text-[10px] flex items-center gap-1 border border-[var(--border-subtle)]">
                                            <span>DEX</span>
                                            <ExternalLink size={10} />
                                          </a>
                                        )}
                                      </div>

                                      <div className="flex items-center justify-between p-2 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)]">
                                        <div>
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[var(--text-muted)] font-mono">2. 跨链: </span>
                                            <span className="font-semibold text-[#45c4b0]">{row.netCalc.route.bridgeName}</span>
                                            {row.netCalc.isLiveQuote && (
                                              <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                                                LIVE
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-[10px] text-[var(--text-muted)] font-mono-num mt-0.5">
                                            转移 <span className="text-[var(--text-primary)] font-bold">{row.netCalc.tokensBought.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> {row.symbol} ➔ ~{row.netCalc.route.etaMinutes}m · 损耗 ~{usd(row.netCalc.estGasUsd + row.netCalc.estBridgeFeeUsd)}
                                          </div>
                                        </div>
                                        <a href={row.netCalc.route.bridgeUrl} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] hover:text-[#45c4b0] text-[10px] flex items-center gap-1 border border-[var(--border-subtle)]">
                                          <span>Bridge</span>
                                          <ExternalLink size={10} />
                                        </a>
                                      </div>

                                      <div className="flex items-center justify-between p-2 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)]">
                                        <div>
                                          <span className="text-[var(--text-muted)] font-mono">3. 卖出: </span>
                                          <span className="font-semibold text-[var(--text-primary)]">{row.sellChainName} · {row.sellDex}</span>
                                          <div className="text-[10px] text-[var(--text-muted)] font-mono-num mt-0.5">
                                            卖出全部代币 ➔ 变现回款 <span className="text-[#45c4b0] font-bold">{usd(row.netCalc.grossRevenueUsd)} USD</span> (单价 {usd(row.sellPrice)})
                                          </div>
                                        </div>
                                        {row.sellUrl && (
                                          <a href={row.sellUrl} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] hover:text-[#f5c042] text-[10px] flex items-center gap-1 border border-[var(--border-subtle)]">
                                            <span>DEX</span>
                                            <ExternalLink size={10} />
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* 全链路成本与收益精算 */}
                                  <div className="space-y-2">
                                    <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                                      <DollarSign size={13} className="text-[#45c4b0]" />
                                      <span>{tr('dmCostBreakdown')} (${capitalUsd} USD 现金本金)</span>
                                    </div>
                                    <div className="p-2.5 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] space-y-1.5 text-[11px] font-mono-num">
                                      <div className="flex justify-between text-[var(--text-secondary)]">
                                        <span>投入本金:</span>
                                        <span className="text-[var(--text-primary)] font-semibold">{usd(capitalUsd)}</span>
                                      </div>
                                      <div className="flex justify-between text-[var(--text-secondary)]">
                                        <span>卖出变现回款:</span>
                                        <span className="text-[var(--text-primary)] font-semibold">{usd(row.netCalc.grossRevenueUsd)}</span>
                                      </div>
                                      <div className="flex justify-between text-[var(--text-secondary)] pt-1 border-t border-[var(--border-subtle)]">
                                        <span>{tr('dmGrossRevenue')}:</span>
                                        <span className="text-[#f5c042] font-semibold">+{usd(row.netCalc.grossProfitUsd)} (+{row.spreadPct.toFixed(2)}%)</span>
                                      </div>
                                      <div className="flex justify-between text-[var(--text-muted)] text-[10px]">
                                        <span className="flex items-center gap-1">
                                          <span>{tr('dmEstGas')}:</span>
                                          {row.netCalc.isLiveQuote && (
                                            <span className="px-1 rounded text-[8px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">实时</span>
                                          )}
                                        </span>
                                        <span className="font-mono-num font-semibold text-[var(--text-primary)]">-{usd(row.netCalc.estGasUsd)}</span>
                                      </div>
                                      <div className="flex justify-between text-[var(--text-muted)] text-[10px]">
                                        <span className="flex items-center gap-1">
                                          <span>{tr('dmEstBridgeFee')}:</span>
                                          {row.netCalc.isLiveQuote && (
                                            <span className="px-1 rounded text-[8px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">实时</span>
                                          )}
                                        </span>
                                        <span className="font-mono-num font-semibold text-[var(--text-primary)]">-{usd(row.netCalc.estBridgeFeeUsd)}</span>
                                      </div>
                                      <div className="flex justify-between text-[var(--text-muted)] text-[10px]">
                                        <span>{tr('dmEstSlippage')} ({row.netCalc.slippagePct.toFixed(2)}%):</span>
                                        <span className="font-mono-num">-{usd(row.netCalc.estSlippageUsd)}</span>
                                      </div>
                                      <div className="pt-1.5 border-t border-[var(--border-subtle)] flex justify-between font-bold text-xs">
                                        <span className="text-[var(--text-primary)]">{tr('dmNetRealized')}:</span>
                                        <span className={row.netCalc.isProfitable ? 'text-[#45c4b0]' : 'text-amber-500'}>
                                          {row.netCalc.isProfitable ? '+' : ''}{usd(row.netCalc.netProfitUsd)}
                                        </span>
                                      </div>
                                      {/* 实时桥费明细项 */}
                                      {liveData?.details?.feeDetails && liveData.details.feeDetails.length > 0 && (
                                        <div className="p-1.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[9px] font-mono text-[var(--text-muted)] space-y-0.5">
                                          <span className="text-[#45c4b0] font-bold">链上费用明细: </span>
                                          {liveData.details.feeDetails.join(' | ')}
                                        </div>
                                      )}
                                      {/* 币数对照提示框 */}
                                      <div className="mt-2 p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] leading-relaxed font-sans">
                                        <span className="text-[#f5c042] font-bold">💡 币数对照：</span>若按数量搬 1,000 个代币，所需本金仅为 <span className="font-mono-num font-bold text-[var(--text-primary)]">{usd(row.netCalc.token1kCost)}</span>，卖出到手 <span className="font-mono-num font-bold text-[var(--text-primary)]">{usd(row.netCalc.token1kRevenue)}</span>，毛利 <span className="font-mono-num font-bold text-[#45c4b0]">+{usd(row.netCalc.token1kProfit)}</span>（回报率同样为 +{row.spreadPct.toFixed(2)}%）。当前测算为按 ${capitalUsd} USD 现金本金（折合 {row.netCalc.tokensBought.toLocaleString(undefined, { maximumFractionDigits: 1 })} 个币）推演。
                                      </div>
                                    </div>
                                  </div>

                                {/* 安全与风控校验 */}
                                <div className="space-y-2">
                                  <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                                    <ShieldCheck size={13} className="text-sky-400" />
                                    <span>{locale === 'zh' ? '风控与裁决审计' : 'Risk & Security Audit'}</span>
                                  </div>
                                  <div className="p-2.5 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] space-y-2 text-[11px]">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[var(--text-muted)]">{locale === 'zh' ? '裁决结果:' : 'Verdict:'}</span>
                                      <VerdictBadge verdict={row.verdict} size="xs" />
                                    </div>
                                    <div className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                                      {row.verdict === 'official' && (
                                        <span className="text-emerald-400">✓ 官方背书注册表代币，双链合约严格锚定。</span>
                                      )}
                                      {row.verdict === 'confirmed' && (
                                        <span className="text-sky-400">✓ 多源 DEX 流动性交叉核验通过，价差合理。</span>
                                      )}
                                      {row.verdict === 'suspicious' && (
                                        <span className="text-amber-400">⚠ 报价单边偏离过大或单链流动性较浅，注意滑点。</span>
                                      )}
                                      {row.verdict === 'fake' && (
                                        <span className="text-rose-400">✗ 警惕山寨同名貔貅假币，合约地址不匹配。</span>
                                      )}
                                    </div>

                                    {/* 双端流动性深度与 6h/24h 交易量审计 */}
                                    <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5 text-[10px] font-mono-num">
                                      <div className="text-[11px] font-bold text-[var(--text-primary)] font-sans flex items-center justify-between">
                                        <span>{locale === 'zh' ? '双端 Pair 资产储备与换手审计:' : 'Dual-Leg Pair Reserves & Volume:'}</span>
                                        <span className="text-[#f5c042] font-semibold">{locale === 'zh' ? '建议单笔' : 'Max'} ≤ {usd(row.netCalc.maxSafeCapacityUsd)}</span>
                                      </div>

                                      {/* 买入池指标 */}
                                      <div className="bg-[var(--bg-surface)]/60 rounded p-1.5 space-y-1 border border-[var(--border-subtle)]/50">
                                        <div className="flex justify-between text-[var(--text-secondary)] font-sans font-semibold text-[10px]">
                                          <span>{locale === 'zh' ? '买入池' : 'Buy Pool'} ({row.buyChain}):</span>
                                          <span className="font-mono-num text-[var(--text-primary)]">TVL {usd(row.buyLiquidityUsd || row.minLiquidityUsd)}</span>
                                        </div>
                                        {row.buyQuoteReserveUsd !== undefined && (
                                          <div className="flex justify-between text-[var(--text-muted)] text-[9px] bg-[var(--bg-base)]/50 px-1 py-0.5 rounded">
                                            <span>Pair 构成:</span>
                                            <span>{row.symbol} 存量 {usd(row.buyBaseReserveUsd || 0)} | {row.buyQuoteSymbol || 'Quote'} 现金 {usd(row.buyQuoteReserveUsd)} ({((row.buyQuoteRatio || 0.5) * 100).toFixed(0)}%)</span>
                                          </div>
                                        )}
                                        <div className="flex justify-between text-[var(--text-muted)] text-[9px]">
                                          <span>24h 成交: {usd(row.buyVolume24h || 0)} ({row.buyTxns24h || 0} 笔)</span>
                                          <span>6h: {usd(row.buyVolume6h || 0)}</span>
                                        </div>
                                      </div>

                                      {/* 卖出池指标 */}
                                      <div className="bg-[var(--bg-surface)]/60 rounded p-1.5 space-y-1 border border-[var(--border-subtle)]/50">
                                        <div className="flex justify-between text-[var(--text-secondary)] font-sans font-semibold text-[10px]">
                                          <span>{locale === 'zh' ? '卖出池' : 'Sell Pool'} ({row.sellChain}):</span>
                                          <span className="font-mono-num text-[var(--text-primary)]">TVL {usd(row.sellLiquidityUsd || row.minLiquidityUsd)}</span>
                                        </div>
                                        {row.sellQuoteReserveUsd !== undefined && (
                                          <div className="flex justify-between text-[var(--text-muted)] text-[9px] bg-[var(--bg-base)]/50 px-1 py-0.5 rounded">
                                            <span>Pair 构成:</span>
                                            <span>
                                              {row.symbol} {usd(row.sellBaseReserveUsd || 0)} ({((1 - (row.sellQuoteRatio || 0.5)) * 100).toFixed(0)}%) |{' '}
                                              <strong className={row.sellQuoteReserveUsd < 500 ? 'text-rose-400 font-mono' : 'text-emerald-400 font-mono'}>
                                                {row.sellQuoteSymbol || 'Quote'} 现金 {usd(row.sellQuoteReserveUsd)} ({((row.sellQuoteRatio || 0.5) * 100).toFixed(1)}%)
                                              </strong>
                                            </span>
                                          </div>
                                        )}
                                        <div className="flex justify-between text-[var(--text-muted)] text-[9px]">
                                          <span>24h 成交: {usd(row.sellVolume24h || 0)} ({row.sellTxns24h || 0} 笔)</span>
                                          <span>6h: {usd(row.sellVolume6h || 0)}</span>
                                        </div>
                                      </div>

                                      {/* 冲击率 */}
                                      <div className="flex justify-between text-[var(--text-muted)] pt-0.5">
                                        <span>{locale === 'zh' ? '拟投' : 'Impact'} ${capitalUsd} {locale === 'zh' ? '深度冲击率:' : 'impact:'}</span>
                                        <span className={row.netCalc.liquidityHealth === 'safe' ? 'text-[#45c4b0] font-semibold' : (row.netCalc.liquidityHealth === 'moderate' ? 'text-amber-400 font-semibold' : 'text-rose-400 font-bold')}>
                                          ~{row.netCalc.poolImpactPct.toFixed(2)}%
                                        </span>
                                      </div>

                                      {/* 动态交易量与死池熔断诊断 */}
                                      {row.sellQuoteReserveUsd !== undefined && row.sellQuoteReserveUsd < 500 ? (
                                        <div className="p-2 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] leading-relaxed font-sans">
                                          ⚠️ <strong>{locale === 'zh' ? '致命单边池 / 现金枯竭陷阱' : 'Illiquid Cash Reserve Drain'}</strong>：{locale === 'zh' ? `卖出池名义 TVL 虽标为 ${usd(row.sellLiquidityUsd || row.minLiquidityUsd)}，但其中 ${((1 - (row.sellQuoteRatio || 0)) * 100).toFixed(1)}% 均为待抛售的 ${row.symbol} 虚标市值！池内真实 ${row.sellQuoteSymbol || 'USDC'} 现金储备仅有 ${usd(row.sellQuoteReserveUsd)}！若您跨链卖出，该池最多只能兑付 ${usd(row.sellQuoteReserveUsd)}，将遭遇 >90% 毁灭性滑点归零！` : `Sell pool quote cash reserve is only ${usd(row.sellQuoteReserveUsd)}! High risk of total loss.`}
                                        </div>
                                      ) : row.sellVolume6h === 0 ? (
                                        <div className="p-2 rounded bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[10px] leading-relaxed font-sans">
                                          ⚠️ <strong>{locale === 'zh' ? '致命死池告警' : 'Dead Pool Alert'}</strong>：{locale === 'zh' ? '卖出池在近 6 小时内成交量为 $0.00！无真实对手盘买入。表面价差通常是由于挂牌无人交易的“幽灵陈旧挂单”，跨链后极难按此价变现！' : 'Sell pool has $0.00 volume in last 6h! High risk of stale zombie quotes.'}
                                        </div>
                                      ) : row.buyVolume6h === 0 ? (
                                        <div className="p-2 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] leading-relaxed font-sans">
                                          ⚠️ <strong>{locale === 'zh' ? '换手滞后提示' : 'Low Velocity Warning'}</strong>：{locale === 'zh' ? '买入池在近 6 小时内成交量为 $0.00，价格未随市场行情动态修正，注意潜在实际滑点。' : 'Buy pool has $0 volume in last 6h.'}
                                        </div>
                                      ) : (row.minVolume24h !== undefined && row.minVolume24h < 500) ? (
                                        <div className="p-2 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] leading-relaxed font-sans">
                                          ⚠️ <strong>{locale === 'zh' ? '低换手警报' : 'Low Volume Alert'}</strong>：{locale === 'zh' ? `双端短板 24h 成交仅 ${usd(row.minVolume24h)}，出水承接能力脆弱，建议严格控制仓位。` : `24h min volume is only ${usd(row.minVolume24h)}.`}
                                        </div>
                                      ) : (row.buyVolume24h !== undefined && row.sellVolume24h !== undefined) ? (
                                        <div className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] leading-snug font-sans">
                                          ✓ {locale === 'zh' ? `双端池近 6h 均有真实买卖成交（卖端现金储备 ${usd(row.sellQuoteReserveUsd || 0)}，6h 量: ${usd(row.sellVolume6h || 0)}），具备真实流动性出水承接力。` : 'Both pools show active 6h trading activity with real absorption capacity.'}
                                        </div>
                                      ) : null}
                                    </div>
                                    <button
                                      onClick={() => onSelectOpp(row)}
                                      className="w-full py-1.5 rounded bg-[#f5c042] hover:bg-[#ffd24d] text-black font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 mt-2"
                                    >
                                      <FileEdit size={12} />
                                      <span>{locale === 'zh' ? '记录此套利操盘决策' : 'Record Arb Decision'}</span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                        })()}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* 卡片模式 */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {processedData.length === 0 ? (
            <div className="col-span-full py-16 text-center text-xs text-[var(--text-secondary)] terminal-panel">
              {tr('noOpps')}
            </div>
          ) : (
            processedData.map((opp) => (
              <OpportunityCard
                key={opp.uniqueKey}
                opp={opp}
                onSelect={(o) => onSelectOpp(o)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};
