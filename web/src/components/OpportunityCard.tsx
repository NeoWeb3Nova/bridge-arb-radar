import React from 'react';
import { OpportunityItem } from '../types';
import { usd, usdCompact, agoSec } from '../utils/format';
import { VerdictBadge } from './VerdictBadge';
import { ArrowRight, ExternalLink, Activity, Copy, Check, FileEdit, ShieldCheck, ShieldAlert, Coins } from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { isStandardQuote } from '../utils/routeEstimator';

interface Props {
  opp: OpportunityItem;
  onSelect?: (opp: OpportunityItem) => void;
}

export const OpportunityCard: React.FC<Props> = ({ opp, onSelect }) => {
  const { locale } = useI18n();
  const [copiedBuy, setCopiedBuy] = React.useState(false);
  const [copiedSell, setCopiedSell] = React.useState(false);

  const handleCopy = (e: React.MouseEvent, text: string | null, isBuy: boolean) => {
    e.stopPropagation();
    if (!text) return;
    navigator.clipboard.writeText(text);
    if (isBuy) {
      setCopiedBuy(true);
      setTimeout(() => setCopiedBuy(false), 1500);
    } else {
      setCopiedSell(true);
      setTimeout(() => setCopiedSell(false), 1500);
    }
  };

  const isPositive = opp.spreadPct >= 1.5;
  const grossProfit1k = (opp.spreadPct / 100) * 1000;
  const priceDelta = opp.sellPrice - opp.buyPrice;

  return (
    <div
      onClick={() => onSelect?.(opp)}
      className="terminal-panel p-3.5 transition-all duration-150 cursor-pointer flex flex-col justify-between group hover:border-[#f5c042]/70 hover:shadow-lg"
    >
      <div>
        {/* 顶部标题、认证与价差收益 */}
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-[var(--text-primary)] group-hover:text-[#f5c042] text-base tracking-tight truncate transition-colors">
                {opp.symbol}
              </span>
              <VerdictBadge verdict={opp.verdict} size="xs" />
              {opp.sellQuoteSymbol && !isStandardQuote(opp.sellQuoteSymbol) && (
                <span 
                  className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1"
                  title={`⚠️ 结算资产为 ${opp.sellQuoteSymbol}（非USDC/USDT）`}
                >
                  <Coins size={9} className="text-amber-400" />
                  <span>产出: {opp.sellQuoteSymbol}</span>
                </span>
              )}
              {opp.security && (
                opp.security.isHoneypot ? (
                  <span 
                    className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-rose-500/25 text-rose-300 border border-rose-500/40 flex items-center gap-1 animate-pulse"
                    title={`🚨 智能合约貔貅高危:\n${opp.security.riskReason}`}
                  >
                    <ShieldAlert size={10} className="text-rose-400" />
                    <span>{locale === 'zh' ? '貔貅' : 'Honeypot'}</span>
                  </span>
                ) : opp.security.riskLevel === 'warning' ? (
                  <span 
                    className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1"
                    title={`⚠️ 代码风控提醒:\n${opp.security.riskReason}`}
                  >
                    <ShieldAlert size={10} className="text-amber-400" />
                    <span>{locale === 'zh' ? '有税' : 'Tax'}</span>
                  </span>
                ) : (
                  <span 
                    className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1"
                    title="✓ 智能合约代码体检通过: 0%买卖税 · 无貔貅限制"
                  >
                    <ShieldCheck size={10} className="text-emerald-400" />
                    <span>0%税</span>
                  </span>
                )
              )}
              {typeof opp.qualityScore === 'number' && (
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold border flex items-center gap-1 ${
                  opp.qualityScore >= 85 ? 'bg-amber-400/20 text-amber-400 border-amber-400/40 shadow-sm' :
                  opp.qualityScore >= 70 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                  opp.qualityScore >= 50 ? 'bg-sky-500/20 text-sky-400 border-sky-500/30' :
                  opp.qualityScore >= 25 ? 'bg-slate-500/20 text-slate-300 border-slate-500/30' :
                  'bg-rose-500/15 text-rose-400 border-rose-500/25'
                }`} title={opp.scoreComment || `套利可行性综合评分: ${opp.qualityScore}/100`}>
                  <span>{opp.qualityGrade || 'B'}</span>
                  <span>{opp.qualityScore}分</span>
                </span>
              )}
              {opp.decision?.status && (
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-[#45c4b0]/15 text-[#45c4b0] border border-[#45c4b0]/25">
                  {opp.decision.status}
                </span>
              )}
            </div>
            <div className="text-[11px] text-[var(--text-muted)] font-mono-num mt-0.5">
              {opp.sellQuoteSymbol && !isStandardQuote(opp.sellQuoteSymbol) ? (
                <span>
                  {locale === 'zh' ? '结算资产' : 'Settles in'}:{' '}
                  <span className="font-bold text-amber-300">
                    +{opp.spreadPct.toFixed(2)}% {opp.sellQuoteSymbol}
                  </span>
                </span>
              ) : (
                <span>
                  {locale === 'zh' ? '1,000 U 现金本金毛利' : 'Est. Profit / 1k USD'}:{' '}
                  <span className="font-bold text-emerald-500">
                    +{usd(grossProfit1k)}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className={`font-mono-num font-extrabold text-base leading-none ${isPositive ? 'text-[#f5c042]' : 'text-[var(--text-secondary)]'}`}>
              +{opp.spreadPct.toFixed(2)}%
            </div>
            <div className="text-[10px] text-[var(--text-muted)] font-mono-num mt-0.5 flex items-center justify-end gap-1">
              <span>Δ {priceDelta >= 0 ? '+' : ''}{usd(priceDelta)}</span>
              {opp.ts && (
                <span className="text-[9px] text-[var(--text-muted)] opacity-80" title={`快照时间: ${new Date(opp.ts).toLocaleTimeString()}`}>
                  · {agoSec(opp.ts, locale)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 买入卖出路由对比腿 */}
        <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-2 bg-[var(--bg-elevated)]/60 rounded-md p-2.5 border border-[var(--border-subtle)] mb-2.5">
          {/* 买入腿 (左侧) */}
          <div className="min-w-0">
            <div className="flex items-center gap-1 mb-1">
              <span className="px-1 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider bg-[#f5c042]/15 text-[#f5c042] border border-[#f5c042]/25">
                {locale === 'zh' ? '买入低' : 'BUY'}
              </span>
              <span className="text-[11px] text-[var(--text-secondary)] font-medium truncate" title={opp.buyChainName}>
                {opp.buyChainName}
              </span>
            </div>
            <div className="font-mono-num font-bold text-[var(--text-primary)] text-xs truncate">
              {usd(opp.buyPrice)}
            </div>
            {opp.buyPriceNative !== undefined && opp.buyPriceNative !== null && opp.buyQuoteSymbol && (
              <div className="text-[9px] text-[var(--text-muted)] font-mono truncate">
                1={opp.buyPriceNative.toFixed(2)}{opp.buyQuoteSymbol}
              </div>
            )}
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate flex items-center gap-1">
              <span className="truncate">{opp.buyDex || 'DEX'}{opp.buyQuoteSymbol ? ` · ${opp.symbol}/${opp.buyQuoteSymbol}` : ''}</span>
              {opp.buyAddress && (
                <button
                  onClick={(e) => handleCopy(e, opp.buyAddress, true)}
                  className="hover:text-[var(--text-primary)] transition shrink-0"
                  title={locale === 'zh' ? '复制买入链合约地址' : 'Copy contract address'}
                >
                  {copiedBuy ? <Check size={10} className="text-[#45c4b0]" /> : <Copy size={10} />}
                </button>
              )}
            </div>
          </div>

          {/* 中间跨链桥梁转移指示 */}
          <div className="flex flex-col items-center justify-center px-0.5 text-[var(--text-muted)]">
            <span className="text-[8px] font-mono tracking-tighter text-[var(--text-muted)] uppercase mb-0.5">
              {locale === 'zh' ? '跨链桥' : 'BRIDGE'}
            </span>
            <div className="flex items-center justify-center w-7 h-5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[#f5c042]">
              <ArrowRight size={11} />
            </div>
            <span className="text-[8px] font-mono text-[var(--text-muted)] mt-0.5">
              ➔
            </span>
          </div>

          {/* 卖出腿 (右侧) */}
          <div className="min-w-0 text-right">
            <div className="flex items-center justify-end gap-1 mb-1">
              <span className="text-[11px] text-[var(--text-secondary)] font-medium truncate" title={opp.sellChainName}>
                {opp.sellChainName}
              </span>
              <span className="px-1 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider bg-[#45c4b0]/15 text-[#45c4b0] border border-[#45c4b0]/25">
                {locale === 'zh' ? '卖出高' : 'SELL'}
              </span>
            </div>
            <div className="font-mono-num font-bold text-[var(--text-primary)] text-xs truncate">
              {usd(opp.sellPrice)}
            </div>
            {opp.sellPriceNative !== undefined && opp.sellPriceNative !== null && opp.sellQuoteSymbol && (
              <div className="text-[9px] text-[var(--text-muted)] font-mono truncate">
                1={opp.sellPriceNative.toFixed(2)}{opp.sellQuoteSymbol}
              </div>
            )}
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate flex items-center justify-end gap-1">
              <span className="truncate">{opp.sellDex || 'DEX'}{opp.sellQuoteSymbol ? ` · ${opp.symbol}/${opp.sellQuoteSymbol}` : ''}</span>
              {opp.sellAddress && (
                <button
                  onClick={(e) => handleCopy(e, opp.sellAddress, false)}
                  className="hover:text-[var(--text-primary)] transition shrink-0"
                  title={locale === 'zh' ? '复制卖出链合约地址' : 'Copy contract address'}
                >
                  {copiedSell ? <Check size={10} className="text-[#45c4b0]" /> : <Copy size={10} />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 底部属性与快捷链接 */}
      <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)] pt-2 border-t border-[var(--border-subtle)] font-mono-num gap-2">
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] truncate">
          <Activity size={11} className="text-[var(--text-muted)] shrink-0" />
          <span title={`短板流动性深度: ${usd(opp.minLiquidityUsd)}`}>
            {locale === 'zh' ? '深度' : 'Depth'} {usdCompact(opp.minLiquidityUsd)}
          </span>
          {opp.sellQuoteReserveUsd !== undefined && opp.sellQuoteReserveUsd < 500 ? (
            <span className="px-1 py-0.2 rounded bg-rose-500/25 text-rose-300 border border-rose-500/40 text-[9px] font-bold font-sans animate-pulse" title={`卖出池现金储备仅 $${opp.sellQuoteReserveUsd.toFixed(2)} (${opp.sellQuoteSymbol || 'Quote'})，单边代币无法变现`}>
              ⚠️ 现金仅${opp.sellQuoteReserveUsd.toFixed(0)}
            </span>
          ) : opp.minVolume6h === 0 ? (
            <span className="px-1 py-0.2 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[9px] font-bold font-sans animate-pulse" title="近6小时零成交(死池风险)">
              ⚠️ 6h死池
            </span>
          ) : (opp.minVolume24h !== undefined && opp.minVolume24h < 500) ? (
            <span className="px-1 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[9px] font-sans" title={`24h成交量仅 ${usd(opp.minVolume24h)}`}>
              ⚠️ 低量
            </span>
          ) : opp.minVolume24h !== undefined ? (
            <span className={`text-[9px] ${opp.minVolume24h >= 50000 ? 'text-emerald-400 font-semibold' : 'text-[var(--text-muted)]'}`} title={`24h短板量: ${usd(opp.minVolume24h)} | 6h: ${usd(opp.minVolume6h || 0)}`}>
              24h: {usdCompact(opp.minVolume24h)}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {opp.buyUrl && (
            <a
              href={opp.buyUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="px-1.5 py-0.5 rounded bg-[var(--bg-surface)] hover:bg-[#f5c042]/15 text-[var(--text-secondary)] hover:text-[#f5c042] border border-[var(--border-subtle)] transition flex items-center gap-1 text-[10px]"
              title="打开 DexScreener 查看行情"
            >
              <span>DEX</span>
              <ExternalLink size={9} />
            </a>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(opp);
            }}
            className="px-2 py-0.5 rounded bg-[#f5c042]/10 hover:bg-[#f5c042]/25 text-[#f5c042] border border-[#f5c042]/30 transition flex items-center gap-1 text-[10px] font-semibold cursor-pointer"
            title={locale === 'zh' ? '点击查看标的实时行情与操盘' : 'Trade & Details'}
          >
            <FileEdit size={10} />
            <span>{locale === 'zh' ? '操盘' : 'Track'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
