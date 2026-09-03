import React from 'react';
import { OpportunityItem } from '../types';
import { usd } from '../utils/format';
import { VerdictBadge } from './VerdictBadge';
import { ArrowRight, ExternalLink, Activity, Copy, Check } from 'lucide-react';

interface Props {
  opp: OpportunityItem;
  onSelect?: (opp: OpportunityItem) => void;
}

export const OpportunityCard: React.FC<Props> = ({ opp, onSelect }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = (e: React.MouseEvent, text: string | null) => {
    e.stopPropagation();
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isPositive = opp.spreadPct >= 1.5;

  return (
    <div
      onClick={() => onSelect?.(opp)}
      className="terminal-panel p-4 transition duration-150 cursor-pointer flex flex-col justify-between group"
    >
      <div>
        {/* 顶部标题与裁决 */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-slate-100 text-base tracking-tight truncate">{opp.symbol}</span>
            <VerdictBadge verdict={opp.verdict} size="xs" />
          </div>
          <div className="text-right shrink-0">
            <span className={`font-mono-num font-extrabold text-base ${isPositive ? 'text-[#f5c042]' : 'text-[#a39e93]'}`}>
              +{opp.spreadPct.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* 买入卖出对比腿 */}
        <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-2 bg-[#070604]/60 dark:bg-[#070604]/60 rounded p-2.5 border border-white/[0.06] mb-3">
          {/* 买入腿 */}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] text-[#a39e93] font-medium mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f5c042]" />
              <span className="truncate">{opp.buyChainName}</span>
            </div>
            <div className="font-mono-num font-bold text-slate-200 text-xs truncate">
              {usd(opp.buyPrice)}
            </div>
            <div className="text-[10px] text-[#6e695e] mt-0.5 truncate flex items-center gap-1">
              <span>{opp.buyDex || 'DEX'}</span>
              {opp.buyAddress && (
                <button
                  onClick={(e) => handleCopy(e, opp.buyAddress)}
                  className="hover:text-slate-300 transition"
                  title="Copy contract"
                >
                  {copied ? <Check size={10} className="text-[#45c4b0]" /> : <Copy size={10} />}
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center justify-center px-1 text-[#6e695e]">
            <ArrowRight size={13} />
          </div>

          {/* 卖出腿 */}
          <div className="min-w-0 text-right">
            <div className="flex items-center justify-end gap-1.5 text-[11px] text-[#a39e93] font-medium mb-1">
              <span className="truncate">{opp.sellChainName}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#45c4b0]" />
            </div>
            <div className="font-mono-num font-bold text-slate-200 text-xs truncate">
              {usd(opp.sellPrice)}
            </div>
            <div className="text-[10px] text-[#6e695e] mt-0.5 truncate flex items-center justify-end gap-1">
              <span>{opp.sellDex || 'DEX'}</span>
              {opp.sellAddress && (
                <button
                  onClick={(e) => handleCopy(e, opp.sellAddress)}
                  className="hover:text-slate-300 transition"
                  title="Copy contract"
                >
                  <Copy size={10} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 底部属性与快捷链接 */}
      <div className="flex items-center justify-between text-[11px] text-[#a39e93] pt-2 border-t border-white/[0.06] font-mono-num">
        <span className="flex items-center gap-1">
          <Activity size={12} className="text-[#6e695e] shrink-0" />
          Depth {usd(opp.minLiquidityUsd)}
        </span>

        <div className="flex items-center gap-2">
          {opp.buyUrl && (
            <a
              href={opp.buyUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="px-1.5 py-0.5 rounded bg-white/[0.04] hover:bg-[#f5c042]/15 text-[#a39e93] hover:text-[#f5c042] border border-white/[0.08] transition flex items-center gap-1 text-[10px]"
            >
              <span>DexScreener</span>
              <ExternalLink size={10} />
            </a>
          )}
          {opp.buyExplorer && (
            <a
              href={opp.buyExplorer}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[#a39e93] hover:text-white border border-white/[0.08] transition"
            >
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
