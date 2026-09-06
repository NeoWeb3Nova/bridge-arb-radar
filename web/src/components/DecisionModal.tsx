import React, { useState, useEffect, useRef } from 'react';
import { OpportunityItem, LiveQuoteResult } from '../types';
import { usd, usdCompact, ago } from '../utils/format';
import { 
  X, Save, Plus, ArrowRight, History, RefreshCw, ExternalLink, 
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Clock, 
  DollarSign, Activity, Zap, ShieldAlert, ShieldCheck, Coins
} from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { VerdictBadge } from './VerdictBadge';
import { isStandardQuote } from '../utils/routeEstimator';

interface Props {
  item: OpportunityItem | null;
  onClose: () => void;
  onSaved: () => void;
}

export const DecisionModal: React.FC<Props> = ({ item, onClose, onSaved }) => {
  const { t: tr, locale } = useI18n();
  const [status, setStatus] = useState<string>('todo');
  const [logText, setLogText] = useState('');
  const [pnlDelta, setPnlDelta] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // 实时验价相关状态
  const [liveQuote, setLiveQuote] = useState<LiveQuoteResult | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const [principalUsd, setPrincipalUsd] = useState<number>(1000);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(10);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchLiveQuote = async (isManual = false) => {
    if (!item) return;
    setLoadingLive(true);
    try {
      const p = new URLSearchParams({
        symbol: item.symbol,
        buyChain: item.buyChain,
        buyAddress: item.buyAddress || '',
        buyPairAddress: item.buyPairAddress || '',
        sellChain: item.sellChain,
        sellAddress: item.sellAddress || '',
        sellPairAddress: item.sellPairAddress || '',
        snapshotBuyPrice: String(item.buyPrice || ''),
        snapshotSellPrice: String(item.sellPrice || ''),
        snapshotSpreadPct: String(item.spreadPct || ''),
        snapshotTs: item.ts || '',
        amountUsd: String(principalUsd),
        force: isManual ? '1' : '0',
      });
      const res = await fetch(`/api/opportunity/live?${p.toString()}`);
      const data = await res.json();
      if (data.ok) {
        setLiveQuote(data);
      }
    } catch (e) {
      console.error('Failed to fetch live quote:', e);
    } finally {
      setLoadingLive(false);
      setCountdown(10);
    }
  };

  // 每次打开弹窗或标的切换时，初始化表单并立即触发实时二次验价
  useEffect(() => {
    if (item) {
      setStatus(item.decision?.status || 'todo');
      setLogText('');
      setPnlDelta('');
      setLiveQuote(null);
      fetchLiveQuote(true);
    }
  }, [item]);

  // 本金切换时重新测算
  useEffect(() => {
    if (item && liveQuote) {
      fetchLiveQuote(false);
    }
  }, [principalUsd]);

  // 自动倒计时与定时轮询
  useEffect(() => {
    if (!item || !autoRefresh) return;
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchLiveQuote(false);
          return 10;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [item, autoRefresh, principalUsd]);

  if (!item) return null;

  const currentPnl = item.decision?.realizedPnlUsd || 0;
  const journal = item.decision?.journal || [];

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logText.trim() && pnlDelta === '' && status === (item.decision?.status || 'todo')) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      if (logText.trim() || pnlDelta !== '') {
        await fetch('/api/decisions/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: item.symbol,
            buyChain: item.buyChain,
            sellChain: item.sellChain,
            text: logText.trim() || '更新状态',
            status,
            pnlDeltaUsd: pnlDelta !== '' ? Number(pnlDelta) : undefined,
          }),
        });
      } else {
        await fetch('/api/decisions/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: item.symbol,
            buyChain: item.buyChain,
            sellChain: item.sellChain,
            status,
          }),
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  // 一键将实时验价结果填入操盘笔记
  const insertLiveQuoteToNote = () => {
    if (!liveQuote?.live) return;
    const { buyPrice, sellPrice, spreadPct, buyDex, sellDex } = liveQuote.live;
    const text = `【实时现货验价】买入: ${item.buyChainName} @${buyPrice} (${buyDex || 'DEX'}) → 卖出: ${item.sellChainName} @${sellPrice} (${sellDex || 'DEX'})，实时价差: ${spreadPct > 0 ? '+' : ''}${spreadPct.toFixed(2)}%，扣除跨链成本预估净利: ${usd(liveQuote.simulation?.netProfitUsd || 0)}`;
    setLogText(text);
  };

  const isLive = !!liveQuote?.live;
  const live = liveQuote?.live;
  const drift = liveQuote?.drift;
  const bridge = liveQuote?.bridge;
  const sim = liveQuote?.simulation;
  const quoteStatus = liveQuote?.status || 'UNAVAILABLE';

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="terminal-panel w-full max-w-2xl rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] border border-[var(--border-subtle)]">
        {/* 头部：标的与实时验价标识 */}
        <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="font-bold text-base text-[var(--text-primary)] flex items-center gap-2">
              <span>{item.symbol}</span>
              <VerdictBadge verdict={item.verdict} size="xs" />
            </h3>

            {/* 实时验价状态指示胶囊 */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[10px] font-mono">
              {loadingLive ? (
                <span className="flex items-center gap-1 text-sky-400">
                  <RefreshCw size={10} className="animate-spin" />
                  <span>代币现价与链上实时询价中...</span>
                </span>
              ) : isLive ? (
                <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>LIVE 现货实时行情</span>
                </span>
              ) : (
                <span className="text-[var(--text-muted)]">快照数据</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 自动刷新开关 */}
            <label className="hidden sm:flex items-center gap-1 text-[10px] text-[var(--text-muted)] cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={autoRefresh} 
                onChange={(e) => setAutoRefresh(e.target.checked)} 
                className="rounded border-[var(--border-subtle)] accent-[#f5c042] cursor-pointer"
              />
              <span>自动轮询 {autoRefresh ? `(${countdown}s)` : ''}</span>
            </label>

            {/* 手动刷新按钮 */}
            <button
              onClick={() => fetchLiveQuote(true)}
              disabled={loadingLive}
              className="px-2 py-1 rounded bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="重新向 DEX 与跨链聚合器拉取最新实时盘口"
            >
              <RefreshCw size={11} className={loadingLive ? 'animate-spin text-[#f5c042]' : ''} />
              <span className="hidden sm:inline">刷新报价</span>
            </button>

            <button 
              onClick={onClose} 
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded hover:bg-[var(--bg-surface)] transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 内容滚动区 */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs">

          {/* 1. 实时时效性与风控预警横幅 */}
          {quoteStatus === 'TRAP_POOL' && (
            <div className="p-3.5 rounded-lg bg-rose-500/15 border border-rose-500/50 text-rose-200 flex items-start gap-2.5 animate-pulse">
              <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1 grow">
                <div className="font-bold text-xs text-rose-300 flex items-center justify-between">
                  <span>🚨 严重风险拦截：检测到高额手续费陷阱流动性池 (Trap Pool / 杀猪盘)</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-600/40 text-rose-100 font-extrabold border border-rose-400/60">
                    池费高达 {Math.max((live?.buyPoolFee || 0), (live?.sellPoolFee || 0), (item.buyPoolFee || 0), (item.sellPoolFee || 0)) * 100}%
                  </span>
                </div>
                <div className="text-[11px] text-rose-200/90 leading-relaxed">
                  {liveQuote?.statusMessage || `DEX Screener 等行情软件未直接标示此 Uniswap V4 / 陷阱池的高额兑换手续费。虽然代币合约显示 0% 税，但单次兑换池子即扣除巨额手续费，表面毛利差实为诱饵陷阱，实际执行必亏！`}
                </div>
              </div>
            </div>
          )}

          {quoteStatus === 'ACTIVE' && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-start gap-2.5">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 grow">
                <div className="font-bold text-xs text-emerald-400 flex items-center justify-between">
                  <span>机会当前仍然有效（实测净利为正）</span>
                  <span className="font-mono text-[11px]">实时价差: +{live?.spreadPct.toFixed(2)}%</span>
                </div>
                <div className="text-[11px] text-emerald-300/80">
                  {liveQuote?.statusMessage}
                </div>
              </div>
            </div>
          )}

          {quoteStatus === 'INVERTED' && (
            <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-200 flex items-start gap-2.5 animate-pulse">
              <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 grow">
                <div className="font-bold text-xs text-rose-400 flex items-center justify-between">
                  <span>⚠️ 警惕：价差已抹平或倒挂！切勿盲目入场！</span>
                  <span className="font-mono text-[11px]">现价差: {live?.spreadPct.toFixed(2)}%</span>
                </div>
                <div className="text-[11px] text-rose-200/90">
                  买入端现价已上涨或卖出端价格已下跌，两端现货价格已平价反转。套利窗口已关闭，强行执行将直接产生亏损！
                </div>
              </div>
            </div>
          )}

          {quoteStatus === 'NARROWED' && (
            <div className="p-3 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 grow">
                <div className="font-bold text-xs text-amber-400 flex items-center justify-between">
                  <span>⚠️ 注意：价差已收窄，利润不足以覆盖跨链成本</span>
                  <span className="font-mono text-[11px]">现价差: +{live?.spreadPct.toFixed(2)}%</span>
                </div>
                <div className="text-[11px] text-amber-200/90">
                  {liveQuote?.statusMessage}。建议继续观察，等待价差再次拉开或改用更低成本通道。
                </div>
              </div>
            </div>
          )}

          {quoteStatus === 'LIQUIDITY_DROP' && (
            <div className="p-3 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-200 flex items-start gap-2.5">
              <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 grow">
                <div className="font-bold text-xs text-amber-400">⚠️ 池子流动性不足预警</div>
                <div className="text-[11px] text-amber-200/90">{liveQuote?.statusMessage}</div>
              </div>
            </div>
          )}

          {/* 非标准计价配对结算提示横幅 */}
          {item.sellQuoteSymbol && !isStandardQuote(item.sellQuoteSymbol) && (
            <div className="p-3 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-200 flex items-start gap-2.5">
              <Coins size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5 grow text-xs">
                <div className="font-bold text-amber-300 flex items-center justify-between">
                  <span>非标准计价配对结算提示</span>
                  <span className="font-mono text-[11px]">最终结算资产: {item.sellQuoteSymbol}</span>
                </div>
                <div className="text-[11px] text-amber-200/90 leading-relaxed">
                  卖出端交易池计价币为 <strong className="font-mono text-white">{item.sellQuoteSymbol}</strong>。套利卖出后到账的是 <strong className="font-mono text-white">{item.sellQuoteSymbol}</strong>（而非 USDC/USDT 稳定币）。若需换回稳定币，需在 {item.sellChainName} 额外进行一次兑换。
                </div>
              </div>
            </div>
          )}

          {/* 2. 买卖两端现货行情：快照 vs 实时现价深度比对 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] font-medium">
              <span>两端 DEX 现货价格穿透比对</span>
              <span className="text-[10px] text-[var(--text-muted)] font-mono">
                雷达发现于 {ago(item.ts)} ({new Date(item.ts || Date.now()).toLocaleTimeString()})
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 买入端卡片 */}
              <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-[#f5c042]/15 text-[#f5c042] border border-[#f5c042]/30">
                      买入腿
                    </span>
                    <span className="font-bold text-[var(--text-primary)] text-xs">{item.buyChainName}</span>
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">({live?.buyDex || item.buyDex || 'DEX'}{item.buyQuoteSymbol ? ` · ${item.symbol}/${item.buyQuoteSymbol}` : ''})</span>
                  </div>
                  {item.buyUrl && (
                    <a
                      href={live?.buyPairUrl || item.buyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-[#f5c042] hover:underline flex items-center gap-0.5"
                    >
                      <span>买入池</span>
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>

                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)]">实时现货单价</div>
                    <div className="font-mono-num text-lg font-bold text-[var(--text-primary)]">
                      {usd(live?.buyPrice || item.buyPrice)}
                    </div>
                    {item.buyPriceNative !== undefined && item.buyPriceNative !== null && item.buyQuoteSymbol && (
                      <div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">
                        1 {item.symbol} = {item.buyPriceNative.toFixed(4)} {item.buyQuoteSymbol}
                      </div>
                    )}
                  </div>
                  {drift && drift.buyPriceDeltaPct !== 0 && (
                    <div className="text-right">
                      <div className="text-[10px] text-[var(--text-muted)]">较发现时</div>
                      <div className={`font-mono text-xs font-bold flex items-center gap-0.5 ${
                        drift.buyPriceDeltaPct > 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}>
                        {drift.buyPriceDeltaPct > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        <span>{drift.buyPriceDeltaPct > 0 ? '+' : ''}{drift.buyPriceDeltaPct.toFixed(2)}%</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-[var(--border-subtle)]/60 space-y-1 text-[10px] text-[var(--text-muted)] font-mono">
                  <div className="flex items-center justify-between">
                    <span>快照价: {usd(item.buyPrice)}</span>
                    <span>池深: {usdCompact(live?.buyLiquidityUsd || item.minLiquidityUsd)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-0.5 border-t border-[var(--border-subtle)]/30">
                    <span>流动性池手续费:</span>
                    {(() => {
                      const buyFee = live?.buyPoolFee ?? item.buyPoolFee ?? item.security?.buySecurity?.poolFee ?? 0.003;
                      const isBuyTrap = buyFee >= 0.05 || (item.buyPoolFee != null && item.buyPoolFee >= 0.05) || !!item.security?.buySecurity?.isTrapPool;
                      return (
                        <span className={`font-bold ${isBuyTrap ? 'text-rose-400 animate-pulse' : (buyFee > 0.01 ? 'text-amber-400' : 'text-emerald-400')}`}>
                          {(buyFee * 100).toFixed(1)}%
                          {isBuyTrap ? ' 🚨陷阱池' : ''}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="flex items-center justify-between">
                    <span>代币合约交易税:</span>
                    <span className={(live?.buyTax || 0) > 0 ? 'text-amber-400 font-bold' : 'text-emerald-400'}>
                      {((live?.buyTax || 0) * 100).toFixed(1)}% (买入税)
                    </span>
                  </div>
                </div>
              </div>

              {/* 卖出端卡片 */}
              <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      卖出腿
                    </span>
                    <span className="font-bold text-[var(--text-primary)] text-xs">{item.sellChainName}</span>
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">({live?.sellDex || item.sellDex || 'DEX'}{item.sellQuoteSymbol ? ` · ${item.symbol}/${item.sellQuoteSymbol}` : ''})</span>
                  </div>
                  {item.sellUrl && (
                    <a
                      href={live?.sellPairUrl || item.sellUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-[#f5c042] hover:underline flex items-center gap-0.5"
                    >
                      <span>卖出池</span>
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>

                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)]">实时现货单价</div>
                    <div className="font-mono-num text-lg font-bold text-[var(--text-primary)]">
                      {usd(live?.sellPrice || item.sellPrice)}
                    </div>
                    {item.sellPriceNative !== undefined && item.sellPriceNative !== null && item.sellQuoteSymbol && (
                      <div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">
                        1 {item.symbol} = {item.sellPriceNative.toFixed(4)} {item.sellQuoteSymbol}
                      </div>
                    )}
                  </div>
                  {drift && drift.sellPriceDeltaPct !== 0 && (
                    <div className="text-right">
                      <div className="text-[10px] text-[var(--text-muted)]">较发现时</div>
                      <div className={`font-mono text-xs font-bold flex items-center gap-0.5 ${
                        drift.sellPriceDeltaPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {drift.sellPriceDeltaPct >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        <span>{drift.sellPriceDeltaPct > 0 ? '+' : ''}{drift.sellPriceDeltaPct.toFixed(2)}%</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-[var(--border-subtle)]/60 space-y-1 text-[10px] text-[var(--text-muted)] font-mono">
                  <div className="flex items-center justify-between">
                    <span>快照价: {usd(item.sellPrice)}</span>
                    <span>池深: {usdCompact(live?.sellLiquidityUsd || item.minLiquidityUsd)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-0.5 border-t border-[var(--border-subtle)]/30">
                    <span>流动性池手续费:</span>
                    {(() => {
                      const sellFee = live?.sellPoolFee ?? item.sellPoolFee ?? item.security?.sellSecurity?.poolFee ?? 0.003;
                      const isSellTrap = sellFee >= 0.05 || (item.sellPoolFee != null && item.sellPoolFee >= 0.05) || !!item.security?.sellSecurity?.isTrapPool;
                      return (
                        <span className={`font-bold ${isSellTrap ? 'text-rose-400 animate-pulse' : (sellFee > 0.01 ? 'text-amber-400' : 'text-emerald-400')}`}>
                          {(sellFee * 100).toFixed(1)}%
                          {isSellTrap ? ' 🚨陷阱池' : ''}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="flex items-center justify-between">
                    <span>代币合约交易税:</span>
                    <span className={(live?.sellTax || 0) > 0 ? 'text-amber-400 font-bold' : 'text-emerald-400'}>
                      {((live?.sellTax || 0) * 100).toFixed(1)}% (卖出税)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 3. 实时跨链通道费用与净盈亏动态试算 */}
          <div className="p-3.5 rounded-lg bg-[var(--bg-elevated)]/40 border border-[var(--border-subtle)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Zap size={14} className="text-[#f5c042]" />
                <span>实时净利润与通道模拟测算</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[var(--text-muted)] mr-1">本金:</span>
                {[500, 1000, 2000, 5000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setPrincipalUsd(amt)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
                      principalUsd === amt
                        ? 'bg-[#f5c042] text-black font-bold'
                        : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-base)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <div className="text-[10px] text-[var(--text-muted)]">实时毛价差</div>
                <div className={`font-mono-num font-bold text-sm mt-0.5 ${
                  (live?.spreadPct ?? item.spreadPct) > 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {(live?.spreadPct ?? item.spreadPct) > 0 ? '+' : ''}{(live?.spreadPct ?? item.spreadPct).toFixed(2)}%
                </div>
              </div>

              <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <div className="text-[10px] text-[var(--text-muted)]">毛收益 ({principalUsd}U)</div>
                <div className="font-mono-num font-bold text-sm text-[var(--text-primary)] mt-0.5">
                  {usd(sim?.grossProfitUsd || ((item.spreadPct / 100) * principalUsd))}
                </div>
              </div>

              <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <div className="text-[10px] text-[var(--text-muted)]">
                  跨链总成本 {bridge ? `(~${bridge.etaSeconds}s)` : ''}
                </div>
                <div className="font-mono-num font-bold text-sm text-rose-400 mt-0.5">
                  -{usd(sim?.totalCostUsd || bridge?.totalCostUsd || 4.5)}
                </div>
              </div>

              <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <div className="text-[10px] text-[var(--text-muted)]">预计净利润</div>
                <div className={`font-mono-num font-extrabold text-sm mt-0.5 ${
                  (sim?.netProfitUsd ?? 0) > 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {(sim?.netProfitUsd ?? 0) > 0 ? '+' : ''}{usd(sim?.netProfitUsd || 0)}
                </div>
              </div>
            </div>

            {/* 全链路费用摩擦拆解：跨链成本 vs DEX池费 vs 代币合约税 */}
            <div className="p-2.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-1.5 text-[11px] font-mono">
              <div className="flex items-center justify-between text-[var(--text-secondary)] font-sans font-semibold">
                <span>摩擦成本构成明细:</span>
                <span className="text-[var(--text-muted)] text-[10px] font-mono">总损耗: -{usd(sim?.totalCostUsd || bridge?.totalCostUsd || 4.5)}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-[var(--border-subtle)]/50 text-[10px]">
                <div className="bg-[var(--bg-base)]/70 p-1.5 rounded">
                  <div className="text-[var(--text-muted)]">跨链通道费 (Gas+桥):</div>
                  <div className="text-[var(--text-primary)] font-bold mt-0.5">
                    -{usd(sim?.bridgeCostUsd || bridge?.totalCostUsd || 4.5)}
                  </div>
                </div>
                <div className="bg-[var(--bg-base)]/70 p-1.5 rounded">
                  <div className="text-[var(--text-muted)] flex items-center justify-between">
                    <span>DEX流动性池手续费:</span>
                    {sim?.isTrapPool && (
                      <span className="text-[8px] bg-rose-500/20 text-rose-300 px-1 rounded">高费陷阱</span>
                    )}
                  </div>
                  <div className={`font-bold mt-0.5 ${sim?.isTrapPool ? 'text-rose-400 font-extrabold' : 'text-[var(--text-primary)]'}`}>
                    -{usd(sim?.dexFrictionCostUsd || 0)}
                  </div>
                </div>
                <div className="bg-[var(--bg-base)]/70 p-1.5 rounded">
                  <div className="text-[var(--text-muted)]">代币合约交易税:</div>
                  <div className={`font-bold mt-0.5 ${((live?.buyTax || 0) + (live?.sellTax || 0)) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {((live?.buyTax || 0) + (live?.sellTax || 0)) > 0 ? `-${usd(((live?.buyTax || 0) + (live?.sellTax || 0)) * principalUsd)}` : '$0.00 (0%税)'}
                  </div>
                </div>
              </div>
            </div>

            {bridge && (
              <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono px-1">
                <span>直连路由: {bridge.bridgeName} ({bridge.isLiveQuote ? '实时 Gas & 协议费已锁定' : '通道测算'})</span>
                <span>净收益率: <b className={(sim?.netYieldPct ?? 0) > 0 ? 'text-emerald-400' : 'text-rose-400'}>{(sim?.netYieldPct ?? 0) > 0 ? '+' : ''}{sim?.netYieldPct}%</b></span>
              </div>
            )}
          </div>

          {/* 4. 代币税 vs 交易池手续费 双重风控透视卡片 */}
          <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-sky-400" />
                <span>双重风控审计：代币合约税 (Token Tax) vs 交易池手续费 (Pool Swap Fee)</span>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] font-mono">GoPlus & GeckoTerminal 双核验</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)]/60 space-y-1">
                <div className="flex justify-between items-center text-[var(--text-secondary)] font-sans font-semibold">
                  <span>① 代币智能合约税 (Token Tax):</span>
                  <span className={((live?.buyTax || 0) === 0 && (live?.sellTax || 0) === 0) ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                    {((live?.buyTax || 0) === 0 && (live?.sellTax || 0) === 0) ? '0% 无税 ✓' : `买${((live?.buyTax || 0)*100).toFixed(1)}% / 卖${((live?.sellTax || 0)*100).toFixed(1)}%`}
                  </span>
                </div>
                <div className="text-[10px] text-[var(--text-muted)] font-sans leading-relaxed">
                  由代币智能合约代码规定。在代币发生转账或兑换时由代币合约扣留，非貔貅且 0% 买卖税表示代币合约层无恶意扣税。
                </div>
              </div>

              <div className={`p-2 rounded border space-y-1 ${
                ((live?.buyPoolFee || item.buyPoolFee || 0) >= 0.05 || (live?.sellPoolFee || item.sellPoolFee || 0) >= 0.05)
                  ? 'bg-rose-500/10 border-rose-500/30'
                  : 'bg-[var(--bg-base)] border-[var(--border-subtle)]/60'
              }`}>
                <div className="flex justify-between items-center text-[var(--text-secondary)] font-sans font-semibold">
                  <span>② DEX 流动性池手续费 (Pool Swap Fee):</span>
                  <span className={`font-bold ${
                    ((live?.buyPoolFee || item.buyPoolFee || 0) >= 0.05 || (live?.sellPoolFee || item.sellPoolFee || 0) >= 0.05)
                      ? 'text-rose-400 animate-pulse'
                      : 'text-emerald-400'
                  }`}>
                    买入 {(((live?.buyPoolFee ?? item.buyPoolFee) ?? 0.003) * 100).toFixed(1)}% / 卖出 {(((live?.sellPoolFee ?? item.sellPoolFee) ?? 0.003) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="text-[10px] text-[var(--text-muted)] font-sans leading-relaxed">
                  由 DEX 流动性池（如 Uniswap V4 / Hook 池）规定。<strong>注意：DEX Screener 默认不展示此费率</strong>，如果池子创建者设置 10% 或更高手续费，利差将被完全吞噬。
                </div>
              </div>
            </div>
          </div>

          {/* 5. 决策操盘状态与复盘日志 */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[var(--text-primary)] text-xs">执行状态与操盘日志记录</span>
              {isLive && (
                <button
                  type="button"
                  onClick={insertLiveQuoteToNote}
                  className="text-[10px] text-[#f5c042] hover:underline flex items-center gap-1 cursor-pointer"
                  title="自动将上方实时行情的最新价格与价差填入本次笔记"
                >
                  <Plus size={11} />
                  <span>一键填入最新报价</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[var(--bg-surface)] p-2.5 rounded border border-[var(--border-subtle)]">
                <div className="text-[10px] text-[var(--text-secondary)] mb-1">执行状态</div>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-2 py-1 text-xs text-[var(--text-primary)] font-medium focus:outline-none focus:border-[#f5c042]"
                >
                  <option value="todo">待定 (Todo)</option>
                  <option value="watching">👀 观察中 (Watching)</option>
                  <option value="executed">⚡ 已执行 (Executed)</option>
                  <option value="closed">💰 已结算 (Closed)</option>
                  <option value="dropped">🛑 放弃 (Dropped)</option>
                </select>
              </div>

              <div className="bg-[var(--bg-surface)] p-2.5 rounded border border-[var(--border-subtle)]">
                <div className="text-[10px] text-[var(--text-secondary)] mb-1">该标的已实现盈亏</div>
                <div className={`font-mono-num text-base font-bold ${currentPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {currentPnl >= 0 ? '+' : ''}{usd(currentPnl)}
                </div>
              </div>
            </div>

            <form onSubmit={handleSave} className="space-y-2.5 bg-[var(--bg-surface)] p-3 rounded border border-[var(--border-subtle)]">
              <div>
                <textarea
                  value={logText}
                  onChange={(e) => setLogText(e.target.value)}
                  placeholder="记录操作过程与复盘笔记：例如「已在买端成交 1,000 U，正通过 Relay 跨链至目标链出货...」"
                  rows={2}
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded p-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
                />
              </div>

              <div>
                <label className="text-[10px] text-[var(--text-secondary)] block mb-1">本次产生的真实净盈亏 Δ USD (盈利记正数，亏损记负数)：</label>
                <input
                  type="number"
                  step="0.01"
                  value={pnlDelta}
                  onChange={(e) => setPnlDelta(e.target.value)}
                  placeholder="+25.50 或 -5.20"
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-2.5 py-1 font-mono text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
                />
              </div>
            </form>

            {/* 历史操盘日志流 */}
            {journal.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[var(--text-secondary)] font-bold flex items-center gap-1 text-[11px]">
                  <History size={12} className="text-[var(--text-muted)]" />
                  <span>历史复盘记录 ({journal.length})</span>
                </div>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 font-mono text-[10px]">
                  {journal.map((j, i) => (
                    <div key={i} className="bg-[var(--bg-surface)] p-2 rounded border border-[var(--border-subtle)] space-y-0.5">
                      <div className="flex items-center justify-between text-[var(--text-muted)]">
                        <span>{new Date(j.ts).toLocaleString()}</span>
                        {j.pnlDeltaUsd != null && (
                          <span className={`font-bold ${j.pnlDeltaUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {j.pnlDeltaUsd >= 0 ? '+' : ''}{usd(j.pnlDeltaUsd)}
                          </span>
                        )}
                      </div>
                      <div className="text-[var(--text-primary)] font-sans text-[11px]">{j.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>

        {/* 底部按钮栏 */}
        <div className="p-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 flex items-center justify-between gap-2">
          <div className="text-[10px] text-[var(--text-muted)] font-mono">
            {liveQuote?.checkedAt ? `报价时间: ${new Date(liveQuote.checkedAt).toLocaleTimeString()}` : ''}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs cursor-pointer"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="impeccable-btn-primary flex items-center gap-1.5 px-4 py-1.5 text-xs tracking-tight cursor-pointer disabled:opacity-50"
            >
              <Save size={13} />
              <span>{saving ? '保存中...' : '提交记录'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
