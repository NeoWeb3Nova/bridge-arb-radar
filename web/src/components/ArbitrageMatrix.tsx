import React, { useState, useEffect, useRef, useMemo } from 'react';
import { OpportunityItem } from '../types';
import { usd, usdCompact, agoSec } from '../utils/format';
import { calculateNetArb, resolveBridgeRoute, LiveQuoteData } from '../utils/routeEstimator';
import { VerdictBadge } from './VerdictBadge';
import { OpportunityCard } from './OpportunityCard';
import { 
  ArrowRight, ExternalLink, Copy, Check, FileEdit, 
  ChevronDown, ChevronUp, Search, Filter, ArrowUpDown, 
  Sparkles, ShieldCheck, ShieldAlert, Layers, LayoutGrid, Table, DollarSign,
  TrendingUp, CheckCircle, AlertTriangle, RefreshCw, Clock, X, Coins
} from 'lucide-react';
import { useI18n } from '../context/I18nContext';

interface Props {
  opportunities: OpportunityItem[];
  onSelectOpp: (opp: OpportunityItem) => void;
  sseConnected?: boolean;
  filterSymbol?: string;
  onClearFilter?: () => void;
}

type SortField = 'score' | 'netProfit' | 'spread' | 'liquidity' | 'volume' | 'time';
type SortOrder = 'desc' | 'asc';
type VerdictFilter = 'all' | 'verified' | 'clean';
type QuoteFilter = 'all' | 'standard' | 'non_standard';

export const ArbitrageMatrix: React.FC<Props> = ({ 
  opportunities, 
  onSelectOpp, 
  sseConnected = true,
  filterSymbol,
  onClearFilter,
}) => {
  const { locale, t: tr } = useI18n();

  // 1. Controls State
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [capitalUsd, setCapitalUsd] = useState<number>(1000);
  const [customCapital, setCustomCapital] = useState<string>('1000');
  const [chainFilter, setChainFilter] = useState<string>('all');
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all');
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('netProfit');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [isFolded, setIsFolded] = useState<boolean>(true);
  const [isModuleCollapsed, setIsModuleCollapsed] = useState<boolean>(false);
  const DEFAULT_FOLD_COUNT = 8;

  // Sync external filterSymbol
  useEffect(() => {
    if (filterSymbol) {
      setSearchQuery(filterSymbol);
      setChainFilter('all');
      setVerdictFilter('all');
      const match = opportunities.find(
        (o) => o.symbol.toLowerCase() === filterSymbol.toLowerCase()
      );
      if (match) {
        setExpandedKey(`${match.symbol}-${match.buyChain}-${match.sellChain}`);
      }
    }
  }, [filterSymbol, opportunities]);

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
        symbol: opp.symbol,
        buyChain: opp.buyChain,
        sellChain: opp.sellChain,
        buyAddress: opp.buyAddress || '',
        buyPairAddress: opp.buyPairAddress || '',
        sellAddress: opp.sellAddress || '',
        sellPairAddress: opp.sellPairAddress || '',
        snapshotBuyPrice: String(opp.buyPrice || ''),
        snapshotSellPrice: String(opp.sellPrice || ''),
        snapshotSpreadPct: String(opp.spreadPct || ''),
        snapshotTs: opp.ts || '',
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
          opp.buyBaseReserveUsd,
          opp.security,
          opp.buyPoolFee ?? undefined,
          opp.sellPoolFee ?? undefined,
          undefined,
          undefined,
          opp.buyQuoteSymbol,
          opp.sellQuoteSymbol,
          opp.buyPriceNative,
          opp.sellPriceNative,
          opp.buyQuotePriceUsd,
          opp.sellQuotePriceUsd
        );
        return {
          ...opp,
          netCalc,
          uniqueKey: key,
        };
      })
      .filter((item) => {
        if (quoteFilter === 'standard') {
          if (item.netCalc.isNonStandardQuote) return false;
        } else if (quoteFilter === 'non_standard') {
          if (!item.netCalc.isNonStandardQuote) return false;
        }
        return true;
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

  // 折叠计算：默认仅渲染 TOP 8 精选标的；搜索/过滤时自动全展开
  const visibleData = useMemo(() => {
    if (!isFolded || searchQuery.trim() || chainFilter !== 'all' || verdictFilter !== 'all') {
      return processedData;
    }
    if (expandedKey) {
      const idx = processedData.findIndex((o) => o.uniqueKey === expandedKey);
      if (idx >= DEFAULT_FOLD_COUNT) {
        return processedData;
      }
    }
    return processedData.slice(0, DEFAULT_FOLD_COUNT);
  }, [processedData, isFolded, searchQuery, chainFilter, verdictFilter, expandedKey]);

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
            <button
              type="button"
              onClick={() => setIsModuleCollapsed(!isModuleCollapsed)}
              className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2 hover:text-[#f5c042] transition cursor-pointer text-left group"
              title={isModuleCollapsed ? '点击展开执行矩阵' : '点击折叠执行矩阵'}
            >
              <TrendingUp size={16} className="text-[#f5c042]" />
              <span>{tr('dmTitle')}</span>
              {isModuleCollapsed ? (
                <ChevronDown size={14} className="text-[var(--text-muted)] group-hover:text-[#f5c042] transition" />
              ) : (
                <ChevronUp size={14} className="text-[var(--text-muted)] group-hover:text-[#f5c042] transition" />
              )}
            </button>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#45c4b0]/10 border border-[#45c4b0]/25 text-[10px] font-mono font-semibold text-[#45c4b0]">
              <span className={`w-1.5 h-1.5 rounded-full bg-[#45c4b0] ${sseConnected ? 'animate-pulse-dot' : ''}`} />
              <span>{sseConnected ? tr('dmLiveTracking') : 'OFFLINE'}</span>
            </div>
            <span className="text-[11px] text-[var(--text-muted)] font-mono">
              ({processedData.length} {locale === 'zh' ? '条套利路径' : 'routes'}{isModuleCollapsed ? (locale === 'zh' ? ' · 已收起' : ' · Collapsed') : ''})
            </span>
            {!isModuleCollapsed && processedData.length > DEFAULT_FOLD_COUNT && !searchQuery.trim() && chainFilter === 'all' && verdictFilter === 'all' && (
              <button
                type="button"
                onClick={() => setIsFolded(!isFolded)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[#f5c042] border border-[var(--border-subtle)] transition cursor-pointer ml-1"
                title={isFolded ? '点击展开全部标的' : '点击折叠至前 8 条'}
              >
                <span>{isFolded ? (locale === 'zh' ? `展开全部 (${processedData.length})` : 'Show All') : (locale === 'zh' ? '折叠至前 8 条' : 'Top 8')}</span>
                {isFolded ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
              </button>
            )}
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
        {!isModuleCollapsed && (
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
                className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-md pl-7 pr-7 py-1 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] uppercase font-mono font-medium focus:outline-none focus:border-[#f5c042]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    onClearFilter?.();
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5 rounded cursor-pointer transition"
                  title="清除搜索"
                >
                  <X size={12} />
                </button>
              )}
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

            {/* 计价配对币过滤 */}
            <select
              value={quoteFilter}
              onChange={(e) => setQuoteFilter(e.target.value as QuoteFilter)}
              className={`bg-[var(--bg-base)] border rounded-md px-2 py-1 text-xs focus:outline-none focus:border-[#f5c042] ${
                quoteFilter !== 'all'
                  ? 'border-[#f5c042] text-[#f5c042] font-semibold'
                  : 'border-[var(--border-subtle)] text-[var(--text-primary)]'
              }`}
              title="按计价代币类型筛选套利机会"
            >
              <option value="all">{locale === 'zh' ? '全部计价币' : 'All Quote Tokens'}</option>
              <option value="standard">{locale === 'zh' ? '仅主流配对 (USDT/USDC/ETH)' : 'Standard Only (USDT/USDC/ETH)'}</option>
              <option value="non_standard">{locale === 'zh' ? '仅小币/非标配对' : 'Non-Standard Quotes Only'}</option>
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
      )}
    </div>

      {/* 主展示区：表格模式 OR 卡片模式 */}
      {!isModuleCollapsed && (
        <>
          {viewMode === 'table' ? (
        <div className="terminal-panel rounded-lg overflow-hidden border border-[var(--border-subtle)]">
          <div className="overflow-x-auto w-full">
            <table className="w-full table-fixed min-w-[1020px] text-left text-xs text-[var(--text-primary)]">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[6%]" />
                <col className="w-[15.5%]" />
                <col className="w-[10.5%]" />
                <col className="w-[15.5%]" />
                <col className="w-[8.5%]" />
                <col className="w-[11.5%]" />
                <col className="w-[11%]" />
                <col className="w-[6.5%]" />
              </colgroup>
              <thead className="bg-[var(--bg-elevated)]/70 text-[var(--text-secondary)] font-medium tracking-tight text-[11px] border-b border-[var(--border-subtle)] select-none">
                <tr>
                  <th 
                    onClick={() => toggleSort('time')}
                    className="py-2.5 px-3 cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center gap-1 truncate">
                      <span>{tr('dmColAsset')}</span>
                      <ArrowUpDown size={11} className="text-[var(--text-muted)] shrink-0" />
                    </div>
                  </th>
                  <th 
                    onClick={() => toggleSort('score')}
                    className="py-2.5 px-2 cursor-pointer hover:text-[var(--text-primary)] text-center"
                  >
                    <div className="flex items-center justify-center gap-1 truncate">
                      <span>{tr('thArbScore')}</span>
                      <ArrowUpDown size={11} className={sortField === 'score' ? 'text-[#f5c042] shrink-0' : 'text-[var(--text-muted)] shrink-0'} />
                    </div>
                  </th>
                  <th className="py-2.5 px-2.5 truncate">{tr('dmColBuyLeg')}</th>
                  <th className="py-2.5 px-2.5 truncate">{tr('dmColBridgeRoute')}</th>
                  <th className="py-2.5 px-2.5 truncate">{tr('dmColSellLeg')}</th>
                  <th 
                    onClick={() => toggleSort('spread')}
                    className="py-2.5 px-2 cursor-pointer hover:text-[var(--text-primary)]"
                  >
                    <div className="flex items-center gap-1 truncate">
                      <span>{tr('dmColSpread')}</span>
                      <ArrowUpDown size={11} className="text-[var(--text-muted)] shrink-0" />
                    </div>
                  </th>
                  <th 
                    onClick={() => toggleSort('netProfit')}
                    className="py-2.5 px-2.5 cursor-pointer hover:text-[var(--text-primary)] text-right"
                  >
                    <div className="flex items-center justify-end gap-1 truncate">
                      <span className="truncate">{tr('dmColNetProfit')} ({usd(capitalUsd, 0)})</span>
                      <ArrowUpDown size={11} className="text-[#45c4b0] shrink-0" />
                    </div>
                  </th>
                  <th 
                    onClick={() => toggleSort('liquidity')}
                    className="py-2.5 px-2.5 cursor-pointer hover:text-[var(--text-primary)] text-right"
                  >
                    <div className="flex items-center justify-end gap-1 truncate">
                      <span className="truncate">{tr('dmColLiquidity')} / {locale === 'zh' ? '成交量' : 'Vol'}</span>
                      <ArrowUpDown size={11} className={sortField === 'liquidity' || sortField === 'volume' ? 'text-[#45c4b0] shrink-0' : 'text-[var(--text-muted)] shrink-0'} />
                    </div>
                  </th>
                  <th className="py-2.5 px-2 text-center">{tr('dmColAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {processedData.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-16 text-[var(--text-muted)] text-xs">
                      {searchQuery ? (
                        <div className="space-y-2">
                          <p>{locale === 'zh' ? `未在当前雷达机会库中匹配到代币「${searchQuery}」的跨链套利路线` : `No opportunities found matching "${searchQuery}"`}</p>
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery('');
                              onClearFilter?.();
                            }}
                            className="text-[#f5c042] hover:underline font-semibold cursor-pointer"
                          >
                            {locale === 'zh' ? '清除筛选查看全部机会' : 'Clear search and view all'}
                          </button>
                        </div>
                      ) : (
                        tr('noOpps')
                      )}
                    </td>
                  </tr>
                ) : (
                  visibleData.map((row) => {
                    const isExpanded = expandedKey === row.uniqueKey;
                    const flash = flashMap[row.uniqueKey];
                    const flashClass = flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : '';
                    const isNetPositive = row.netCalc.isProfitable;
                    const liveQ = liveQuotes[row.uniqueKey];
                    const currentBuyPrice = liveQ?.live?.buyPrice || row.buyPrice;
                    const currentSellPrice = liveQ?.live?.sellPrice || row.sellPrice;
                    const currentSpreadPct = liveQ?.live?.spreadPct !== undefined ? liveQ.live.spreadPct : row.spreadPct;
                    const hasLivePrice = !!liveQ?.live;

                    return (
                      <React.Fragment key={row.uniqueKey}>
                        <tr 
                          onClick={() => setExpandedKey(isExpanded ? null : row.uniqueKey)}
                          className={`hover:bg-[var(--bg-elevated)]/50 transition duration-150 cursor-pointer ${flashClass} ${
                            isExpanded ? 'bg-[var(--bg-elevated)]/30' : ''
                          }`}
                        >
                          {/* 1. 资产与认证 */}
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectOpp(row);
                                }}
                                className="font-bold text-[var(--text-primary)] hover:text-[#f5c042] font-mono text-sm tracking-tight cursor-pointer hover:underline transition-colors"
                                title={locale === 'zh' ? '点击查看标的实时行情与操盘' : 'Click to view live quote & trade'}
                              >
                                {row.symbol}
                              </span>
                              <VerdictBadge verdict={row.verdict} size="xs" />
                              {row.security && (
                                row.security.isHoneypot ? (
                                  <span 
                                    className="px-1 py-0.2 rounded text-[8px] font-mono font-bold bg-rose-500/25 text-rose-300 border border-rose-500/40 flex items-center gap-0.5 animate-pulse"
                                    title={`🚨 智能合约貔貅高危:\n${row.security.riskReason}`}
                                  >
                                    <ShieldAlert size={9} className="text-rose-400" />
                                    <span>{locale === 'zh' ? '貔貅' : 'Honeypot'}</span>
                                  </span>
                                ) : row.security.riskLevel === 'warning' ? (
                                  <span 
                                    className="px-1 py-0.2 rounded text-[8px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-0.5"
                                    title={`⚠️ 代码风控提醒:\n${row.security.riskReason}`}
                                  >
                                    <ShieldAlert size={9} className="text-amber-400" />
                                    <span>{locale === 'zh' ? '有税' : 'Tax'}</span>
                                  </span>
                                ) : (
                                  <span 
                                    className="px-1 py-0.2 rounded text-[8px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-0.5"
                                    title={`✓ 智能合约代码体检通过:\n0%买卖税 · 无貔貅限制`}
                                  >
                                    <ShieldCheck size={9} className="text-emerald-400" />
                                    <span>{locale === 'zh' ? '0%税' : '0% Tax'}</span>
                                  </span>
                                )
                              )}
                              {(row.poolFeeTrap || row.netCalc.isTrapPool || (row.buyPoolFee && row.buyPoolFee >= 0.05) || (row.sellPoolFee && row.sellPoolFee >= 0.05)) && (
                                <span 
                                  className="px-1 py-0.2 rounded text-[8px] font-mono font-bold bg-rose-600/30 text-rose-200 border border-rose-500/50 flex items-center gap-0.5 animate-pulse"
                                  title={`🚨 高费率陷阱池 (Trap Pool):\n流动性池收取高达 ${Math.max(row.buyPoolFee || 0, row.sellPoolFee || 0) * 100}% 的交易手续费，实际无法获利！`}
                                >
                                  <AlertTriangle size={9} className="text-rose-400" />
                                  <span>{locale === 'zh' ? `陷阱 ${Math.max((row.buyPoolFee || 0), (row.sellPoolFee || 0)) * 100}%` : `Trap ${Math.max((row.buyPoolFee || 0), (row.sellPoolFee || 0)) * 100}%`}</span>
                                </span>
                              )}
                              {row.netCalc.isNonStandardQuote && (
                                <span 
                                  className="px-1 py-0.2 rounded text-[8px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-0.5"
                                  title={`⚠️ 非稳定币结算：卖出变现到手为「${row.netCalc.settlementAsset}」（非USDC/USDT）。若需换回稳定币，需在${row.sellChainName}再进行一次 Swap`}
                                >
                                  <Coins size={8} className="text-amber-400" />
                                  <span>产出: {row.netCalc.settlementAsset}</span>
                                </span>
                              )}
                              {row.netCalc.isCrossQuote && (
                                <span 
                                  className="px-1 py-0.2 rounded text-[8px] font-mono font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30"
                                  title={`🔀 跨配对套利：买端池为 ${row.symbol}/${row.buyQuoteSymbol || 'Quote'}，卖端池为 ${row.symbol}/${row.sellQuoteSymbol || 'Quote'}`}
                                >
                                  🔀 跨配对
                                </span>
                              )}
                              {row.decision?.status && (
                                <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-[#45c4b0]/15 text-[#45c4b0] border border-[#45c4b0]/25">
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
                          <td className="py-2.5 px-2 text-center">
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
                              <span className="text-[9px] text-[var(--text-muted)] mt-0.5 truncate max-w-[72px]" title={row.netCalc.scoreComment}>
                                {row.netCalc.scoreComment}
                              </span>
                            </div>
                          </td>

                          {/* 2. 买入腿 */}
                          <td className="py-2.5 px-2.5">
                            <div className="flex items-center gap-1 min-w-0">
                              <span className={`px-1 py-0.2 rounded text-[9px] font-bold uppercase border shrink-0 ${chainBadgeColor(row.buyChain)}`}>
                                {row.buyChain}
                              </span>
                              <span className="text-[11px] text-[var(--text-secondary)] font-medium truncate" title={`${row.buyDex || 'DEX'}${row.buyQuoteSymbol ? ` · ${row.symbol}/${row.buyQuoteSymbol}` : ''}`}>
                                {row.buyDex || 'DEX'}{row.buyQuoteSymbol ? ` · ${row.symbol}/${row.buyQuoteSymbol}` : ''}
                              </span>
                              {row.netCalc.buyPoolFeeRate >= 0.05 ? (
                                <span className="px-1 py-0.2 rounded text-[8px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0" title={`⚠️ 高费率池：Swap手续费 ${(row.netCalc.buyPoolFeeRate * 100).toFixed(1)}%`}>
                                  {(row.netCalc.buyPoolFeeRate * 100).toFixed(0)}%费
                                </span>
                              ) : row.netCalc.buyPoolFeeRate > 0.01 ? (
                                <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/25 shrink-0" title={`池手续费: ${(row.netCalc.buyPoolFeeRate * 100).toFixed(2)}%`}>
                                  {(row.netCalc.buyPoolFeeRate * 100).toFixed(1)}%
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1 mt-1 flex-wrap min-w-0">
                              <span className="font-mono-num font-bold text-xs text-[var(--text-primary)] shrink-0">
                                {usd(currentBuyPrice)}
                              </span>
                              {hasLivePrice && (
                                <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0" title="实时代币现货单价">
                                  LIVE
                                </span>
                              )}
                              {row.buyPriceNative !== undefined && row.buyPriceNative !== null && row.buyQuoteSymbol && (
                                <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/25 shrink-0" title={`买入原生计价: 1 ${row.symbol} = ${row.buyPriceNative.toFixed(4)} ${row.buyQuoteSymbol}`}>
                                  1={row.buyPriceNative.toFixed(2)}{row.buyQuoteSymbol}
                                </span>
                              )}
                              {row.buyAddress && (
                                <div className="flex items-center gap-1 text-[10px] font-mono text-[var(--text-muted)] ml-auto shrink-0">
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
                          <td className="py-2.5 px-2.5">
                            <div className="flex items-center gap-1 min-w-0">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border shrink-0 ${row.netCalc.route.badgeClass}`}>
                                {row.netCalc.route.bridgeName}
                              </span>
                              <span className="text-[11px] text-[var(--text-secondary)] font-mono shrink-0">
                                ~{row.netCalc.route.etaMinutes}m
                              </span>
                              {row.netCalc.isLiveQuote && (
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" title="链上实时询价已打通" />
                              )}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] font-mono-num mt-1 flex items-center gap-1 truncate">
                              <span>{locale === 'zh' ? (row.netCalc.isLiveQuote ? '实时费' : '预估费') : (row.netCalc.isLiveQuote ? 'Live Fee' : 'Est. Fee')}:</span>
                              <span className={row.netCalc.isLiveQuote ? 'text-emerald-400 font-bold' : ''}>
                                ~{usd(row.netCalc.estGasUsd + row.netCalc.estBridgeFeeUsd)}
                              </span>
                            </div>
                          </td>

                          {/* 4. 卖出腿 */}
                          <td className="py-2.5 px-2.5">
                            <div className="flex items-center gap-1 min-w-0">
                              <span className={`px-1 py-0.2 rounded text-[9px] font-bold uppercase border shrink-0 ${chainBadgeColor(row.sellChain)}`}>
                                {row.sellChain}
                              </span>
                              <span className="text-[11px] text-[var(--text-secondary)] font-medium truncate" title={`${row.sellDex || 'DEX'}${row.sellQuoteSymbol ? ` · ${row.symbol}/${row.sellQuoteSymbol}` : ''}`}>
                                {row.sellDex || 'DEX'}{row.sellQuoteSymbol ? ` · ${row.symbol}/${row.sellQuoteSymbol}` : ''}
                              </span>
                              {row.netCalc.sellPoolFeeRate >= 0.05 ? (
                                <span className="px-1 py-0.2 rounded text-[8px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0" title={`⚠️ 高费率池：Swap手续费 ${(row.netCalc.sellPoolFeeRate * 100).toFixed(1)}%`}>
                                  {(row.netCalc.sellPoolFeeRate * 100).toFixed(0)}%池费
                                </span>
                              ) : row.netCalc.sellPoolFeeRate > 0.01 ? (
                                <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/25 shrink-0" title={`池手续费: ${(row.netCalc.sellPoolFeeRate * 100).toFixed(2)}%`}>
                                  {(row.netCalc.sellPoolFeeRate * 100).toFixed(1)}%
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1 mt-1 flex-wrap min-w-0">
                              <span className="font-mono-num font-bold text-xs text-[var(--text-primary)] shrink-0">
                                {usd(currentSellPrice)}
                              </span>
                              {hasLivePrice && (
                                <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0" title="实时代币现货单价">
                                  LIVE
                                </span>
                              )}
                              {row.sellPriceNative !== undefined && row.sellPriceNative !== null && row.sellQuoteSymbol && (
                                <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/25 shrink-0" title={`卖出原生计价: 1 ${row.symbol} = ${row.sellPriceNative.toFixed(4)} ${row.sellQuoteSymbol}`}>
                                  1={row.sellPriceNative.toFixed(2)}{row.sellQuoteSymbol}
                                </span>
                              )}
                              {row.sellAddress && (
                                <div className="flex items-center gap-1 text-[10px] font-mono text-[var(--text-muted)] ml-auto shrink-0">
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
                          <td className="py-2.5 px-2 font-mono-num">
                            <div className={`font-bold text-xs truncate ${currentSpreadPct <= 0 ? 'text-rose-400 animate-pulse' : 'text-[#f5c042]'}`}>
                              {currentSpreadPct <= 0 ? `🚨 倒挂 ${currentSpreadPct.toFixed(2)}%` : `+${currentSpreadPct.toFixed(2)}%`}
                            </div>
                            {row.netCalc.isNonStandardQuote && row.netCalc.quoteTokenSpreadPct !== null ? (
                              <div className="text-[9px] text-amber-300 font-bold mt-0.5 truncate" title={`基于实际结算币(${row.netCalc.settlementAsset})计算的真实利差（消除跨链计价币本身的合成汇率偏差）`}>
                                真实: +{row.netCalc.quoteTokenSpreadPct.toFixed(2)}% {row.netCalc.settlementAsset}
                              </div>
                            ) : (
                              <div className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate">
                                Δ {row.netCalc.priceDelta >= 0 ? '+' : ''}{usd(row.netCalc.priceDelta)}
                              </div>
                            )}
                          </td>

                          {/* 6. 预估净利 */}
                          <td className="py-2.5 px-2.5 text-right font-mono-num">
                            {row.netCalc.isNonStandardQuote ? (
                              <div className="space-y-0.5">
                                <div className="font-bold text-xs text-amber-300 font-mono truncate">
                                  +{row.netCalc.quoteTokenSpreadPct !== null ? row.netCalc.quoteTokenSpreadPct.toFixed(2) : row.netCalc.netRoiPct.toFixed(2)}% {row.netCalc.settlementAsset}
                                </div>
                                {row.netCalc.isProfitableFullCycle ? (
                                  <div className="text-[9px] text-[#45c4b0] font-semibold truncate" title={`投入 $${capitalUsd} USDC 全闭环 (含2次额外Swap及主网Gas) 净得: +${usd(row.netCalc.netProfitUsdFullCycle)}`}>
                                    USD全闭环: +{usd(row.netCalc.netProfitUsdFullCycle)}
                                  </div>
                                ) : (
                                  <div className="text-[9px] text-rose-400 font-semibold truncate" title={`投入 $${capitalUsd} USDC 全闭环: 额外兑换与主网Gas磨损 -$${row.netCalc.extraFrictionUsd}，导致净亏损 ${usd(row.netCalc.netProfitUsdFullCycle)}`}>
                                    USD全闭环: {usd(row.netCalc.netProfitUsdFullCycle)} 倒挂
                                  </div>
                                )}
                              </div>
                            ) : isNetPositive ? (
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
                          <td className="py-2.5 px-2.5 text-right font-mono-num">
                            <div 
                              className="font-semibold text-xs text-[var(--text-primary)] cursor-help truncate" 
                              title={`短板深度: ${usd(row.minLiquidityUsd)} | 买入池: ${usd(row.buyLiquidityUsd || row.minLiquidityUsd)} | 卖出池: ${usd(row.sellLiquidityUsd || row.minLiquidityUsd)} | 建议单笔上限: ${usd(row.netCalc.maxSafeCapacityUsd)}`}
                            >
                              {usdCompact(row.minLiquidityUsd)}
                              <span className="text-[10px] text-[var(--text-muted)] font-normal ml-1">
                                ({locale === 'zh' ? '深度' : 'Depth'})
                              </span>
                            </div>
                            <div className="text-[10px] mt-0.5 truncate">
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
                                  className="px-1 py-0.2 rounded bg-rose-500/25 text-rose-300 border border-rose-500/50 text-[8px] font-bold font-sans"
                                  title={`致命单边池：卖出池 ${row.sellQuoteSymbol || '现金'} 储备仅 $${row.sellQuoteReserveUsd.toFixed(2)} (仅占池 ${( (row.sellQuoteRatio || 0) * 100).toFixed(1)}%)！TVL 是单边代币虚标，实际无法承兑变现`}
                                >
                                  ⚠️ 现金枯竭
                                </span>
                              ) : row.minVolume6h === 0 ? (
                                <span 
                                  className="px-1 py-0.2 rounded bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[8px] font-bold font-sans"
                                  title={`近6小时短板池成交为$0 (买端6h: ${usd(row.buyVolume6h || 0)}, 卖端6h: ${usd(row.sellVolume6h || 0)})！极高概率为无对手盘的死池或虚假陈旧挂单`}
                                >
                                  ⚠️ 6h零成交
                                </span>
                              ) : (row.minVolume24h !== undefined && row.minVolume24h < 500) ? (
                                <span 
                                  className="px-1 py-0.2 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[8px] font-sans"
                                  title={`24小时成交量仅 ${usd(row.minVolume24h || 0)}，换手严重不足`}
                                >
                                  ⚠️ 24h低量
                                </span>
                              ) : row.minVolume24h !== undefined ? (
                                <span 
                                  className={`text-[8px] ${row.minVolume24h >= 50000 ? 'text-emerald-400 font-semibold' : 'text-[var(--text-muted)]'}`}
                                  title={`24h短板量: ${usd(row.minVolume24h)} | 6h短板量: ${usd(row.minVolume6h || 0)}`}
                                >
                                  24h: {usdCompact(row.minVolume24h)}
                                </span>
                              ) : null}
                            </div>
                          </td>

                          {/* 8. 操作与展开 */}
                          <td className="py-2.5 px-2 text-center">
                            <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => onSelectOpp(row)}
                                className="px-1.5 py-1 rounded bg-[#f5c042]/15 hover:bg-[#f5c042]/25 text-[#f5c042] border border-[#f5c042]/30 text-[10px] font-semibold transition cursor-pointer flex items-center gap-0.5 shrink-0"
                                title={locale === 'zh' ? '查看标的实时行情与操盘' : 'Open Trade Console'}
                              >
                                <FileEdit size={10} />
                                <span>{tr('dmTrack')}</span>
                              </button>
                              <button
                                onClick={() => setExpandedKey(isExpanded ? null : row.uniqueKey)}
                                className="p-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition cursor-pointer shrink-0"
                                title={isExpanded ? tr('dmCollapse') : tr('dmExpand')}
                              >
                                {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
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
                              <td colSpan={9} className="p-4 border-t border-[var(--border-subtle)] max-w-full min-w-0">
                                <div className="w-full max-w-full min-w-0 space-y-3">
                                {/* 杀猪盘/高费陷阱池极高风险警告横幅 */}
                                {(row.netCalc.isTrapPool || liveData?.isTrapPool || liveData?.status === 'TRAP_POOL' || row.poolFeeTrap) && (
                                  <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/40 flex items-start gap-2.5 text-rose-300 min-w-0">
                                    <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5 animate-bounce" />
                                    <div className="text-xs space-y-1 grow min-w-0">
                                      <div className="font-bold text-rose-200 flex items-center justify-between flex-wrap gap-1">
                                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                                          <span>🚨 严重风控拦截：检测到高费率陷阱流动性池 (Trap Pool / 杀猪盘)</span>
                                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-rose-600/40 text-rose-100 font-extrabold border border-rose-400/60 shrink-0">
                                            池费高达 {Math.max((row.buyPoolFee || 0), (row.sellPoolFee || 0), (liveData?.live?.buyPoolFee || 0), (liveData?.live?.sellPoolFee || 0)) * 100}%
                                          </span>
                                        </div>
                                      </div>
                                      <div className="text-[11px] leading-relaxed text-rose-200/90 font-mono break-words">
                                        {liveData?.details?.trapWarning || (
                                          <>
                                            <strong>DEX Screener 行情盲区：</strong>DEX Screener 默认未展示此 Uniswap V4 / Hook 池的高额手续费（代币合约虽显示 0% 税，但流动性池 Swap Fee 高达 <strong>{Math.max((row.buyPoolFee || 0), (row.sellPoolFee || 0), (liveData?.live?.buyPoolFee || 0), (liveData?.live?.sellPoolFee || 0)) * 100}%</strong>）。
                                            单笔兑换池费将直接吞噬全部利差并造成严重亏损，请放弃执行！
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* 链上实时询价打通状态横幅 */}
                                <div className="px-3.5 py-2.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] flex flex-col md:flex-row md:items-center justify-between gap-2.5 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    {isQuoting ? (
                                      <div className="flex items-center gap-2 text-sky-400 text-xs font-mono min-w-0 flex-wrap">
                                        <RefreshCw size={13} className="animate-spin text-sky-400 shrink-0" />
                                        <span>1. 正在获取两端 DEX 代币实时现价 ➔ 2. 链上跨链通道费用询价中...</span>
                                      </div>
                                    ) : row.netCalc.isLiveQuote ? (
                                      <div className="flex flex-wrap items-center gap-2 text-xs min-w-0">
                                        <span className="flex items-center gap-1.5 font-bold text-emerald-400 shrink-0">
                                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                          实时询价已打通 ({row.netCalc.route.bridgeName})
                                        </span>
                                        {liveData?.live && (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
                                            代币现价: 买入 {usd(liveData.live.buyPrice)} / 卖出 {usd(liveData.live.sellPrice)} ({liveData.live.spreadPct > 0 ? `+${liveData.live.spreadPct.toFixed(2)}%` : `${liveData.live.spreadPct.toFixed(2)}%`})
                                          </span>
                                        )}
                                        {liveData?.tokenAmount && (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-sky-500/15 text-sky-300 border border-sky-500/25">
                                            搬运折合: {liveData.tokenAmount.toLocaleString()} {row.symbol}
                                          </span>
                                        )}
                                        {liveData?.status === 'TRAP_POOL' && (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-600/30 text-rose-200 border border-rose-500/50 animate-pulse">
                                            🚨 陷阱池 (高池费)
                                          </span>
                                        )}
                                        {liveData?.status === 'INVERTED' && (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                                            🚨 价差已倒挂
                                          </span>
                                        )}
                                        {liveData?.status === 'NARROWED' && (
                                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                            ⚠️ 价差收窄
                                          </span>
                                        )}
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

                                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                                    {liveData?.details?.gasTokens && liveData.details.gasTokens.length > 0 && (
                                      <span className="text-[10px] font-mono text-[var(--text-secondary)] hidden xl:inline">
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

                                {/* 非标准计价代币资产结算与全闭环分析卡片 */}
                                {row.netCalc.isNonStandardQuote && (
                                  <div className="p-3 rounded-lg bg-[var(--bg-base)] border border-amber-500/30 space-y-2 min-w-0">
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                      <div className="flex items-center gap-2 text-xs font-bold text-amber-300 min-w-0">
                                        <Coins size={14} className="text-amber-400 shrink-0" />
                                        <span className="break-words">非标准配对资产结算与全闭环分析 ({row.symbol}/{row.buyQuoteSymbol} ➔ {row.symbol}/{row.sellQuoteSymbol})</span>
                                      </div>
                                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold shrink-0">
                                        最终结算资产: {row.netCalc.settlementAsset}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed break-words">
                                      {locale === 'zh' ? (
                                        <>
                                          <strong>资产结算穿透：</strong>此机会在卖出端 ({row.sellChainName}) 的交易对为 <strong>{row.symbol}/{row.sellQuoteSymbol}</strong>。
                                          套利执行后，用户钱包中<strong>实际收到的结算资产为 {row.netCalc.settlementAsset}</strong>（而非 USDT/USDC）。
                                          {row.netCalc.quoteTokenSpreadPct !== null && (
                                            <span>
                                              两端计价代币同为 {row.netCalc.settlementAsset} 时，真实代币本位利差为 <strong className="text-amber-300 font-mono">+{row.netCalc.quoteTokenSpreadPct.toFixed(2)}% {row.netCalc.settlementAsset}</strong>（排除了不同链 {row.netCalc.settlementAsset} 自身合成汇率偏差）。
                                            </span>
                                          )}
                                        </>
                                      ) : (
                                        <>
                                          <strong>Settlement Asset Notice:</strong> The sell leg pool is <strong>{row.symbol}/{row.sellQuoteSymbol}</strong>.
                                          Upon completion, you will hold <strong>{row.netCalc.settlementAsset}</strong> (not USDC/USDT).
                                          {row.netCalc.quoteTokenSpreadPct !== null && (
                                            <span> Real native spread is <strong className="text-amber-300 font-mono">+{row.netCalc.quoteTokenSpreadPct.toFixed(2)}% {row.netCalc.settlementAsset}</strong>.</span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                    <div className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-1.5 text-[11px] font-mono min-w-0">
                                      <div className="text-[10px] font-sans font-bold text-[var(--text-primary)]">
                                        {locale === 'zh' ? '双重操盘视角收益测算:' : 'Dual Perspective Calculations:'}
                                      </div>
                                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[10px] bg-[var(--bg-base)]/60 p-1.5 rounded min-w-0">
                                        <span className="text-[var(--text-secondary)] font-sans break-words">
                                          视角 A · {row.netCalc.settlementAsset} 本位持有者 (直接赚取代币):
                                        </span>
                                        <span className="font-bold text-amber-300 shrink-0">
                                          +{row.netCalc.quoteTokenSpreadPct !== null ? row.netCalc.quoteTokenSpreadPct.toFixed(2) : row.netCalc.netRoiPct.toFixed(2)}% {row.netCalc.settlementAsset} (无需额外兑换)
                                        </span>
                                      </div>
                                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[10px] bg-[var(--bg-base)]/60 p-1.5 rounded min-w-0">
                                        <span className="text-[var(--text-secondary)] font-sans break-words">
                                          视角 B · USD 稳定币全闭环 (USDC ➔ {row.buyQuoteSymbol} ➔ {row.symbol} ➔ 桥 ➔ {row.symbol} ➔ {row.sellQuoteSymbol} ➔ USDC):
                                        </span>
                                        <span className={`font-bold shrink-0 flex items-center flex-wrap gap-1 ${row.netCalc.isProfitableFullCycle ? 'text-[#45c4b0]' : 'text-rose-400'}`}>
                                          <span>{row.netCalc.isProfitableFullCycle ? '+' : ''}{usd(row.netCalc.netProfitUsdFullCycle)} ({row.netCalc.netRoiPctFullCycle.toFixed(2)}% ROI)</span>
                                          <span className="text-[9px] text-[var(--text-muted)] font-normal">
                                            (额外 2x Swap 及主网 Gas 磨损 -{usd(row.netCalc.extraFrictionUsd)})
                                          </span>
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 min-w-0">
                                  {/* 执行流水线 */}
                                  <div className="space-y-2 min-w-0">
                                    <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                                      <Sparkles size={13} className="text-[#f5c042] shrink-0" />
                                      <span className="truncate">{tr('dmExecutionPlan')}</span>
                                    </div>
                                    <div className="space-y-1.5 text-[11px] min-w-0">
                                      <div className="flex items-center justify-between p-2 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] gap-2 min-w-0">
                                        <div className="min-w-0 flex-1">
                                          <span className="text-[var(--text-muted)] font-mono">1. 买入: </span>
                                          <span className="font-semibold text-[var(--text-primary)] break-words">{row.buyChainName} · {row.buyDex}{row.buyQuoteSymbol ? ` (${row.symbol}/${row.buyQuoteSymbol})` : ''}</span>
                                          <div className="text-[10px] text-[var(--text-muted)] font-mono-num mt-0.5 break-words">
                                            投入 <span className="text-[#f5c042] font-bold">${capitalUsd} USD</span>
                                            {row.netCalc.isNonStandardQuote && (
                                              <span> (折合 ~{((capitalUsd / (row.buyQuotePriceUsd || 1))).toLocaleString(undefined, { maximumFractionDigits: 1 })} {row.buyQuoteSymbol})</span>
                                            )} ➔ 买入 <span className="text-[var(--text-primary)] font-bold">{row.netCalc.tokensBought.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> {row.symbol} (单价 {usd(row.buyPrice)})
                                          </div>
                                        </div>
                                        {row.buyUrl && (
                                          <a href={row.buyUrl} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] hover:text-[#f5c042] text-[10px] flex items-center gap-1 border border-[var(--border-subtle)] shrink-0">
                                            <span>DEX</span>
                                            <ExternalLink size={10} />
                                          </a>
                                        )}
                                      </div>

                                      <div className="flex items-center justify-between p-2 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] gap-2 min-w-0">
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-[var(--text-muted)] font-mono">2. 跨链: </span>
                                            <span className="font-semibold text-[#45c4b0]">{row.netCalc.route.bridgeName}</span>
                                            {row.netCalc.isLiveQuote && (
                                              <span className="px-1 py-0.2 rounded text-[8px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0">
                                                LIVE
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-[10px] text-[var(--text-muted)] font-mono-num mt-0.5 break-words">
                                            转移 <span className="text-[var(--text-primary)] font-bold">{row.netCalc.tokensBought.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> {row.symbol} ➔ ~{row.netCalc.route.etaMinutes}m · 损耗 ~{usd(row.netCalc.estGasUsd + row.netCalc.estBridgeFeeUsd)}
                                          </div>
                                        </div>
                                        <a href={row.netCalc.route.bridgeUrl} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] hover:text-[#45c4b0] text-[10px] flex items-center gap-1 border border-[var(--border-subtle)] shrink-0">
                                          <span>Bridge</span>
                                          <ExternalLink size={10} />
                                        </a>
                                      </div>

                                      <div className="flex items-center justify-between p-2 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] gap-2 min-w-0">
                                        <div className="min-w-0 flex-1">
                                          <span className="text-[var(--text-muted)] font-mono">3. 卖出: </span>
                                          <span className="font-semibold text-[var(--text-primary)] break-words">{row.sellChainName} · {row.sellDex}{row.sellQuoteSymbol ? ` (${row.symbol}/${row.sellQuoteSymbol})` : ''}</span>
                                          <div className="text-[10px] text-[var(--text-muted)] font-mono-num mt-0.5 break-words">
                                            卖出全部代币 ➔ 变现回款 <span className="text-[#45c4b0] font-bold">{usd(row.netCalc.grossRevenueUsd)} USD</span> (单价 {usd(row.sellPrice)})
                                            {row.netCalc.isNonStandardQuote && (
                                              <div className="text-[9px] text-amber-300 font-mono mt-0.5 break-words">
                                                ⚠️ 到账结算资产为 ~{((row.netCalc.grossRevenueUsd / (row.sellQuotePriceUsd || 1))).toLocaleString(undefined, { maximumFractionDigits: 1 })} {row.sellQuoteSymbol} (非稳定币)
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                        {row.sellUrl && (
                                          <a href={row.sellUrl} target="_blank" rel="noreferrer" className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] hover:text-[#f5c042] text-[10px] flex items-center gap-1 border border-[var(--border-subtle)] shrink-0">
                                            <span>DEX</span>
                                            <ExternalLink size={10} />
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* 全链路成本与收益精算 */}
                                  <div className="space-y-2 min-w-0">
                                    <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                                      <DollarSign size={13} className="text-[#45c4b0] shrink-0" />
                                      <span className="truncate">{tr('dmCostBreakdown')} (${capitalUsd} USD)</span>
                                    </div>
                                    <div className="p-2.5 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] space-y-1.5 text-[11px] font-mono-num min-w-0">
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
                                      <div className="flex justify-between items-center text-[var(--text-muted)] text-[10px] gap-1">
                                        <span className="flex items-center gap-1 min-w-0 flex-wrap">
                                          <span className="truncate">DEX 池手续费:</span>
                                          <span className="text-[9px] font-mono opacity-80 whitespace-nowrap">
                                            (买 {(row.netCalc.buyPoolFeeRate * 100).toFixed(1)}% / 卖 {(row.netCalc.sellPoolFeeRate * 100).toFixed(1)}%)
                                          </span>
                                          {row.netCalc.isTrapPool && (
                                            <span className="px-1 rounded text-[8px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/30 whitespace-nowrap">高费陷阱</span>
                                          )}
                                        </span>
                                        <span className={`font-mono-num font-semibold shrink-0 ${row.netCalc.isTrapPool ? 'text-rose-400 font-bold' : 'text-[var(--text-primary)]'}`}>
                                          -{usd(row.netCalc.estDexSwapFeesUsd)}
                                        </span>
                                      </div>
                                      {row.netCalc.estTokenTaxUsd > 0 && (
                                        <div className="flex justify-between text-[var(--text-muted)] text-[10px]">
                                          <span className="flex items-center gap-1">
                                            <span>代币合约交易税:</span>
                                            <span className="text-[9px] font-mono opacity-80">
                                              (买 {(row.netCalc.buyTokenTaxRate * 100).toFixed(1)}% / 卖 {(row.netCalc.sellTokenTaxRate * 100).toFixed(1)}%)
                                            </span>
                                          </span>
                                          <span className="font-mono-num font-semibold text-amber-400">
                                            -{usd(row.netCalc.estTokenTaxUsd)}
                                          </span>
                                        </div>
                                      )}
                                      <div className="pt-1.5 border-t border-[var(--border-subtle)] flex justify-between font-bold text-xs">
                                        <span className="text-[var(--text-primary)]">{tr('dmNetRealized')}:</span>
                                        <span className={row.netCalc.isProfitable ? 'text-[#45c4b0]' : 'text-amber-500'}>
                                          {row.netCalc.isProfitable ? '+' : ''}{usd(row.netCalc.netProfitUsd)}
                                        </span>
                                      </div>
                                      {/* 非标准计价全闭环核算 */}
                                      {row.netCalc.isNonStandardQuote && (
                                        <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] space-y-1 bg-amber-500/10 p-2 rounded text-[10px] min-w-0">
                                          <div className="font-bold text-amber-300 flex items-center justify-between">
                                            <span>结算产出与闭环核算:</span>
                                            <span className="font-mono">产出: {row.netCalc.settlementAsset}</span>
                                          </div>
                                          <div className="flex justify-between text-[var(--text-secondary)]">
                                            <span>① {row.netCalc.settlementAsset} 币本位净利:</span>
                                            <span className="font-bold text-amber-300">
                                              +{row.netCalc.quoteTokenSpreadPct !== null ? row.netCalc.quoteTokenSpreadPct.toFixed(2) : row.netCalc.netRoiPct.toFixed(2)}% {row.netCalc.settlementAsset}
                                            </span>
                                          </div>
                                          <div className="flex justify-between text-[var(--text-muted)]">
                                            <span>② 额外 2x Swap 与主网 Gas (USD闭环):</span>
                                            <span className="font-mono text-rose-400">-{usd(row.netCalc.extraFrictionUsd)}</span>
                                          </div>
                                          <div className="flex justify-between font-bold pt-1 border-t border-amber-500/20">
                                            <span>USD 全闭环净利:</span>
                                            <span className={row.netCalc.isProfitableFullCycle ? 'text-[#45c4b0]' : 'text-rose-400'}>
                                              {row.netCalc.isProfitableFullCycle ? '+' : ''}{usd(row.netCalc.netProfitUsdFullCycle)} ({row.netCalc.netRoiPctFullCycle.toFixed(2)}%)
                                            </span>
                                          </div>
                                        </div>
                                      )}
                                      {/* 实时桥费明细项 */}
                                      {liveData?.details?.feeDetails && liveData.details.feeDetails.length > 0 && (
                                        <div className="p-1.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[9px] font-mono text-[var(--text-muted)] space-y-0.5 min-w-0 break-words">
                                          <span className="text-[#45c4b0] font-bold">链上费用明细: </span>
                                          <span className="break-all">{liveData.details.feeDetails.join(' | ')}</span>
                                        </div>
                                      )}
                                      {/* 币数对照提示框 */}
                                      <div className="mt-2 p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] leading-relaxed font-sans break-words min-w-0">
                                        <span className="text-[#f5c042] font-bold">💡 币数对照：</span>若按数量搬 1,000 个代币，所需本金仅为 <span className="font-mono-num font-bold text-[var(--text-primary)]">{usd(row.netCalc.token1kCost)}</span>，卖出到手 <span className="font-mono-num font-bold text-[var(--text-primary)]">{usd(row.netCalc.token1kRevenue)}</span>，毛利 <span className="font-mono-num font-bold text-[#45c4b0]">+{usd(row.netCalc.token1kProfit)}</span>（回报率同样为 +{row.spreadPct.toFixed(2)}%）。当前测算为按 ${capitalUsd} USD 现金本金（折合 {row.netCalc.tokensBought.toLocaleString(undefined, { maximumFractionDigits: 1 })} 个币）推演。
                                      </div>
                                    </div>
                                  </div>

                                  {/* 安全与风控校验 */}
                                  <div className="space-y-2 min-w-0">
                                    <div className="text-xs font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                                      <ShieldCheck size={13} className="text-sky-400 shrink-0" />
                                      <span className="truncate">{locale === 'zh' ? '风控与裁决审计' : 'Risk & Security Audit'}</span>
                                    </div>
                                    <div className="p-2.5 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] space-y-2 text-[11px] min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                                        <span className="text-[var(--text-muted)] shrink-0">{locale === 'zh' ? '裁决结果:' : 'Verdict:'}</span>
                                        <VerdictBadge verdict={row.verdict} size="xs" />
                                      </div>
                                      <div className="text-[10px] text-[var(--text-secondary)] leading-relaxed break-words">
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

                                      {/* GoPlus 智能合约貔貅与交易池代码安全体检 */}
                                      {row.security && (() => {
                                        const buyFee = liveData?.live?.buyPoolFee ?? row.netCalc.buyPoolFeeRate ?? row.buyPoolFee ?? row.security.buySecurity?.poolFee ?? 0.003;
                                        const sellFee = liveData?.live?.sellPoolFee ?? row.netCalc.sellPoolFeeRate ?? row.sellPoolFee ?? row.security.sellSecurity?.poolFee ?? 0.003;
                                        const isBuyTrap = buyFee >= 0.05 || !!row.security.buySecurity?.isTrapPool || (row.buyPoolFee != null && row.buyPoolFee >= 0.05);
                                        const isSellTrap = sellFee >= 0.05 || !!row.security.sellSecurity?.isTrapPool || (row.sellPoolFee != null && row.sellPoolFee >= 0.05);
                                        const hasTrap = isBuyTrap || isSellTrap || row.netCalc.isTrapPool || liveData?.isTrapPool || liveData?.status === 'TRAP_POOL' || row.poolFeeTrap;

                                        return (
                                          <div className={`p-2 rounded border space-y-1.5 min-w-0 ${
                                            row.security.isHoneypot
                                              ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                                              : hasTrap
                                              ? 'bg-rose-500/15 border-rose-500/40 text-rose-200'
                                              : row.security.riskLevel === 'warning'
                                              ? 'bg-amber-500/10 border-amber-500/25 text-amber-200'
                                              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                                          }`}>
                                            <div className="flex items-center justify-between text-[11px] font-sans font-bold gap-1 min-w-0">
                                              <div className="flex items-center gap-1 min-w-0">
                                                {(row.security.isHoneypot || hasTrap) ? <ShieldAlert size={12} className="text-rose-400 shrink-0" /> : <ShieldCheck size={12} className="text-emerald-400 shrink-0" />}
                                                <span className="truncate">GoPlus & DEX 交易池安全审计:</span>
                                              </div>
                                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono shrink-0 ${
                                                row.security.isHoneypot
                                                  ? 'bg-rose-500/25 text-rose-300 font-bold animate-pulse'
                                                  : hasTrap
                                                  ? 'bg-rose-600/30 text-rose-200 font-bold animate-pulse border border-rose-500/40'
                                                  : row.security.riskLevel === 'warning'
                                                  ? 'bg-amber-500/20 text-amber-300'
                                                  : 'bg-emerald-500/20 text-emerald-300'
                                              }`}>
                                                {row.security.isHoneypot ? '🚨 貔貅高危' : (hasTrap ? '🚨 高费陷阱池' : (row.security.riskLevel === 'warning' ? '⚠️ 存在风险' : '✓ 代码安全'))}
                                              </span>
                                            </div>

                                            <div className="text-[10px] leading-tight font-sans break-words">
                                              {hasTrap
                                                ? (liveData?.details?.trapWarning || `交易池手续费高达 ${(Math.max(buyFee, sellFee) * 100).toFixed(1)}%（DEX Screener 默认未展示），扣除池费后无法套利，切勿执行！`)
                                                : row.security.riskReason}
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[9px] font-mono pt-1 border-t border-[var(--border-subtle)]/50 min-w-0">
                                              <div className="bg-[var(--bg-base)]/60 p-1.5 rounded space-y-0.5 min-w-0">
                                                <div className="font-sans font-semibold text-[var(--text-secondary)] flex justify-between items-center gap-1 min-w-0">
                                                  <span className="shrink-0">买入端 ({row.buyChain}):</span>
                                                  {(liveData?.live?.buyPoolType || row.security.buySecurity?.poolType || row.buyPoolType) && (
                                                    <span className="text-[8px] font-mono px-1 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border-subtle)] truncate max-w-[95px]" title={liveData?.live?.buyPoolType || row.security.buySecurity?.poolType || row.buyPoolType}>
                                                      {liveData?.live?.buyPoolType || row.security.buySecurity?.poolType || row.buyPoolType}
                                                    </span>
                                                  )}
                                                </div>
                                                <div className="truncate">貔貅风险: {row.security.buySecurity?.isHoneypot ? '是 ⚠️' : '否 ✓'}</div>
                                                <div className="truncate">代币税: 买 {((row.security.buySecurity?.buyTax || 0) * 100).toFixed(1)}% / 卖 {((row.security.buySecurity?.sellTax || 0) * 100).toFixed(1)}%</div>
                                                <div className="flex items-center gap-1">
                                                  <span>池手续费:</span>
                                                  <span className={`font-bold ${isBuyTrap ? 'text-rose-400 animate-pulse font-extrabold' : (buyFee > 0.01 ? 'text-amber-400' : 'text-emerald-400')}`}>
                                                    {(buyFee * 100).toFixed(1)}%
                                                    {isBuyTrap ? ' 🚨陷阱' : ''}
                                                  </span>
                                                </div>
                                                <div className="truncate">开源状态: {row.security.buySecurity?.isOpenSource ? '开源 ✓' : '闭源 ⚠️'}</div>
                                              </div>
                                              <div className="bg-[var(--bg-base)]/60 p-1.5 rounded space-y-0.5 min-w-0">
                                                <div className="font-sans font-semibold text-[var(--text-secondary)] flex justify-between items-center gap-1 min-w-0">
                                                  <span className="shrink-0">卖出端 ({row.sellChain}):</span>
                                                  {(liveData?.live?.sellPoolType || row.security.sellSecurity?.poolType || row.sellPoolType) && (
                                                    <span className="text-[8px] font-mono px-1 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border-subtle)] truncate max-w-[95px]" title={liveData?.live?.sellPoolType || row.security.sellSecurity?.poolType || row.sellPoolType}>
                                                      {liveData?.live?.sellPoolType || row.security.sellSecurity?.poolType || row.sellPoolType}
                                                    </span>
                                                  )}
                                                </div>
                                                <div className="truncate">貔貅风险: {row.security.sellSecurity?.isHoneypot ? '是 ⚠️' : '否 ✓'}</div>
                                                <div className="truncate">代币税: 买 {((row.security.sellSecurity?.buyTax || 0) * 100).toFixed(1)}% / 卖 {((row.security.sellSecurity?.sellTax || 0) * 100).toFixed(1)}%</div>
                                                <div className="flex items-center gap-1">
                                                  <span>池手续费:</span>
                                                  <span className={`font-bold ${isSellTrap ? 'text-rose-400 animate-pulse font-extrabold' : (sellFee > 0.01 ? 'text-amber-400' : 'text-emerald-400')}`}>
                                                    {(sellFee * 100).toFixed(1)}%
                                                    {isSellTrap ? ' 🚨陷阱' : ''}
                                                  </span>
                                                </div>
                                                <div className="truncate">开源状态: {row.security.sellSecurity?.isOpenSource ? '开源 ✓' : '闭源 ⚠️'}</div>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })()}

                                      {/* 双端流动性深度与 6h/24h 交易量审计 */}
                                      <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5 text-[10px] font-mono-num min-w-0">
                                        <div className="text-[11px] font-bold text-[var(--text-primary)] font-sans flex items-center justify-between gap-1 min-w-0">
                                          <span className="truncate">{locale === 'zh' ? '双端 Pair 资产储备与换手审计:' : 'Dual-Leg Pair Reserves & Volume:'}</span>
                                          <span className="text-[#f5c042] font-semibold shrink-0">{locale === 'zh' ? '建议单笔' : 'Max'} ≤ {usd(row.netCalc.maxSafeCapacityUsd)}</span>
                                        </div>

                                        {/* 买入池指标 */}
                                        <div className="bg-[var(--bg-surface)]/60 rounded p-1.5 space-y-1 border border-[var(--border-subtle)]/50 min-w-0">
                                          <div className="flex justify-between text-[var(--text-secondary)] font-sans font-semibold text-[10px]">
                                            <span>{locale === 'zh' ? '买入池' : 'Buy Pool'} ({row.buyChain}):</span>
                                            <span className="font-mono-num text-[var(--text-primary)]">TVL {usd(row.buyLiquidityUsd || row.minLiquidityUsd)}</span>
                                          </div>
                                          {row.buyQuoteReserveUsd !== undefined && (
                                            <div className="flex flex-col sm:flex-row sm:justify-between text-[var(--text-muted)] text-[9px] bg-[var(--bg-base)]/50 px-1 py-0.5 rounded gap-0.5 min-w-0">
                                              <span className="text-[var(--text-secondary)] shrink-0">Pair 构成:</span>
                                              <span className="truncate" title={`${row.symbol} 存量 ${usd(row.buyBaseReserveUsd || 0)} | ${row.buyQuoteSymbol || 'Quote'} 现金 ${usd(row.buyQuoteReserveUsd)} (${((row.buyQuoteRatio || 0.5) * 100).toFixed(0)}%)`}>
                                                {row.symbol} {usdCompact(row.buyBaseReserveUsd || 0)} | {row.buyQuoteSymbol || 'Quote'} {usdCompact(row.buyQuoteReserveUsd)} ({((row.buyQuoteRatio || 0.5) * 100).toFixed(0)}%)
                                              </span>
                                            </div>
                                          )}
                                          <div className="flex justify-between text-[var(--text-muted)] text-[9px]">
                                            <span>24h 成交: {usdCompact(row.buyVolume24h || 0)} ({row.buyTxns24h || 0} 笔)</span>
                                            <span>6h: {usdCompact(row.buyVolume6h || 0)}</span>
                                          </div>
                                        </div>

                                        {/* 卖出池指标 */}
                                        <div className="bg-[var(--bg-surface)]/60 rounded p-1.5 space-y-1 border border-[var(--border-subtle)]/50 min-w-0">
                                          <div className="flex justify-between text-[var(--text-secondary)] font-sans font-semibold text-[10px]">
                                            <span>{locale === 'zh' ? '卖出池' : 'Sell Pool'} ({row.sellChain}):</span>
                                            <span className="font-mono-num text-[var(--text-primary)]">TVL {usd(row.sellLiquidityUsd || row.minLiquidityUsd)}</span>
                                          </div>
                                          {row.sellQuoteReserveUsd !== undefined && (
                                            <div className="flex flex-col sm:flex-row sm:justify-between text-[var(--text-muted)] text-[9px] bg-[var(--bg-base)]/50 px-1 py-0.5 rounded gap-0.5 min-w-0">
                                              <span className="text-[var(--text-secondary)] shrink-0">Pair 构成:</span>
                                              <span className="truncate" title={`${row.symbol} ${usd(row.sellBaseReserveUsd || 0)} (${((1 - (row.sellQuoteRatio || 0.5)) * 100).toFixed(0)}%) | ${row.sellQuoteSymbol || 'Quote'} 现金 ${usd(row.sellQuoteReserveUsd)} (${((row.sellQuoteRatio || 0.5) * 100).toFixed(0)}%)`}>
                                                {row.symbol} {usdCompact(row.sellBaseReserveUsd || 0)} |{' '}
                                                <strong className={row.sellQuoteReserveUsd < 500 ? 'text-rose-400 font-mono' : 'text-emerald-400 font-mono'}>
                                                  {row.sellQuoteSymbol || 'Quote'} {usdCompact(row.sellQuoteReserveUsd)} ({((row.sellQuoteRatio || 0.5) * 100).toFixed(0)}%)
                                                </strong>
                                              </span>
                                            </div>
                                          )}
                                          <div className="flex justify-between text-[var(--text-muted)] text-[9px]">
                                            <span>24h 成交: {usdCompact(row.sellVolume24h || 0)} ({row.sellTxns24h || 0} 笔)</span>
                                            <span>6h: {usdCompact(row.sellVolume6h || 0)}</span>
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
                                          <div className="p-2 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] leading-relaxed font-sans break-words min-w-0">
                                            ⚠️ <strong>{locale === 'zh' ? '致命单边池 / 现金枯竭陷阱' : 'Illiquid Cash Reserve Drain'}</strong>：{locale === 'zh' ? `卖出池名义 TVL 虽标为 ${usd(row.sellLiquidityUsd || row.minLiquidityUsd)}，但其中 ${((1 - (row.sellQuoteRatio || 0)) * 100).toFixed(1)}% 均为待抛售的 ${row.symbol} 虚标市值！池内真实 ${row.sellQuoteSymbol || 'USDC'} 现金储备仅有 ${usd(row.sellQuoteReserveUsd)}！若您跨链卖出，该池最多只能兑付 ${usd(row.sellQuoteReserveUsd)}，将遭遇 >90% 毁灭性滑点归零！` : `Sell pool quote cash reserve is only ${usd(row.sellQuoteReserveUsd)}! High risk of total loss.`}
                                          </div>
                                        ) : row.sellVolume6h === 0 ? (
                                          <div className="p-2 rounded bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[10px] leading-relaxed font-sans break-words min-w-0">
                                            ⚠️ <strong>{locale === 'zh' ? '致命死池告警' : 'Dead Pool Alert'}</strong>：{locale === 'zh' ? '卖出池在近 6 小时内成交量为 $0.00！无真实对手盘买入。表面价差通常是由于挂牌无人交易的“幽灵陈旧挂单”，跨链后极难按此价变现！' : 'Sell pool has $0.00 volume in last 6h! High risk of stale zombie quotes.'}
                                          </div>
                                        ) : row.buyVolume6h === 0 ? (
                                          <div className="p-2 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] leading-relaxed font-sans break-words min-w-0">
                                            ⚠️ <strong>{locale === 'zh' ? '换手滞后提示' : 'Low Velocity Warning'}</strong>：{locale === 'zh' ? '买入池在近 6 小时内成交量为 $0.00，价格未随市场行情动态修正，注意潜在实际滑点。' : 'Buy pool has $0 volume in last 6h.'}
                                          </div>
                                        ) : (row.minVolume24h !== undefined && row.minVolume24h < 500) ? (
                                          <div className="p-2 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] leading-relaxed font-sans break-words min-w-0">
                                            ⚠️ <strong>{locale === 'zh' ? '低换手警报' : 'Low Volume Alert'}</strong>：{locale === 'zh' ? `双端短板 24h 成交仅 ${usd(row.minVolume24h)}，出水承接能力脆弱，建议严格控制仓位。` : `24h min volume is only ${usd(row.minVolume24h)}.`}
                                          </div>
                                        ) : (row.buyVolume24h !== undefined && row.sellVolume24h !== undefined) ? (
                                          <div className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] leading-snug font-sans break-words min-w-0">
                                            ✓ {locale === 'zh' ? `双端池近 6h 均有真实买卖成交（卖端现金储备 ${usd(row.sellQuoteReserveUsd || 0)}，6h 量: ${usd(row.sellVolume6h || 0)}），具备真实流动性出水承接力。` : 'Both pools show active 6h trading activity with real absorption capacity.'}
                                          </div>
                                        ) : null}
                                      </div>
                                      <button
                                        onClick={() => onSelectOpp(row)}
                                        className="w-full py-1.5 rounded bg-[#f5c042] hover:bg-[#ffd24d] text-black font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 mt-2 shrink-0"
                                      >
                                        <FileEdit size={12} />
                                        <span>{locale === 'zh' ? '记录此套利操盘决策' : 'Record Arb Decision'}</span>
                                      </button>
                                    </div>
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
              {searchQuery ? (
                <div className="space-y-2">
                  <p>{locale === 'zh' ? `未在当前雷达机会库中匹配到代币「${searchQuery}」的跨链套利路线` : `No opportunities found matching "${searchQuery}"`}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      onClearFilter?.();
                    }}
                    className="text-[#f5c042] hover:underline font-semibold cursor-pointer"
                  >
                    {locale === 'zh' ? '清除筛选查看全部机会' : 'Clear search and view all'}
                  </button>
                </div>
              ) : (
                tr('noOpps')
              )}
            </div>
          ) : (
            visibleData.map((opp) => (
              <OpportunityCard
                key={opp.uniqueKey}
                opp={opp}
                onSelect={(o) => onSelectOpp(o)}
              />
            ))
          )}
        </div>
      )}

      {/* 底部折叠/展开操作条 */}
      {processedData.length > DEFAULT_FOLD_COUNT && !searchQuery.trim() && chainFilter === 'all' && verdictFilter === 'all' && quoteFilter === 'all' && (
        <div className="flex items-center justify-center pt-1 pb-1">
          <button
            type="button"
            onClick={() => setIsFolded(!isFolded)}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[#f5c042]/50 text-xs font-semibold text-[var(--text-primary)] transition-all cursor-pointer shadow-sm group"
          >
            {isFolded ? (
              <>
                <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
                  {locale === 'zh'
                    ? `展开查看其余 ${processedData.length - visibleData.length} 个标的路线（当前展示前 ${visibleData.length} 条 · 共 ${processedData.length} 条）`
                    : `Show ${processedData.length - visibleData.length} more routes (Showing Top ${visibleData.length} of ${processedData.length})`}
                </span>
                <ChevronDown size={14} className="text-[#f5c042] group-hover:translate-y-0.5 transition-transform" />
              </>
            ) : (
              <>
                <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">
                  {locale === 'zh'
                    ? `收起标的列表（仅展示前 ${DEFAULT_FOLD_COUNT} 条高优路线）`
                    : `Collapse to Top ${DEFAULT_FOLD_COUNT} Routes`}
                </span>
                <ChevronUp size={14} className="text-[#f5c042] group-hover:-translate-y-0.5 transition-transform" />
              </>
            )}
          </button>
        </div>
      )}
        </>
      )}
    </div>
  );
};
