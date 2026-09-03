import React, { useState } from 'react';
import { usd } from '../utils/format';
import { VerdictBadge } from './VerdictBadge';
import { Search, ExternalLink, ArrowRight } from 'lucide-react';
import { AdjudicationVerdict } from '../types';
import { useI18n } from '../context/I18nContext';

export const SpreadChecker: React.FC = () => {
  const { t: tr } = useI18n();
  const [symbol, setSymbol] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleSearch = async () => {
    if (!symbol.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/spread/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: symbol.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (data.ok) {
        setResult(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 搜索器 */}
      <div className="terminal-panel p-4 rounded-lg space-y-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            {tr('spTitle')}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {tr('spDesc')}
          </p>
        </div>

        <div className="flex items-center gap-2 max-w-md">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder={tr('spInputPh')}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full bg-slate-950/80 dark:bg-slate-950/80 border border-slate-800 rounded-md pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 uppercase font-mono font-bold focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition disabled:opacity-50 cursor-pointer"
          >
            {loading ? tr('spCheckingBtn') : tr('spCheckBtn')}
          </button>
        </div>
      </div>

      {/* 比价结果 */}
      {result && (
        <div className="space-y-4">
          {result.best ? (
            <div className="terminal-panel p-4 rounded-lg border-l-4 border-l-emerald-500">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-base text-slate-100">{result.best.symbol}</span>
                    <VerdictBadge verdict={result.best.verdict as AdjudicationVerdict} />
                  </div>
                  <div className="text-xs text-slate-300 flex items-center gap-2">
                    <span>{tr('spBuyAt')} <b className="text-blue-500 dark:text-blue-400">{result.best.buyChainName}</b> {tr('spBuyAction')} ({usd(result.best.buyPrice)})</span>
                    <ArrowRight size={13} className="text-slate-500" />
                    <span>{tr('spSellAt')} <b className="text-emerald-500 dark:text-emerald-400">{result.best.sellChainName}</b> {tr('spSellAction')} ({usd(result.best.sellPrice)})</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono-num text-2xl font-extrabold text-emerald-500 dark:text-emerald-400">
                    +{result.best.spreadPct.toFixed(2)}%
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono-num">
                    {tr('spLiquidity')} {usd(result.best.minLiquidityUsd)}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="terminal-panel p-4 rounded-lg text-center text-xs text-slate-400">
              {tr('spNoSpread')}
            </div>
          )}

          {/* 全部报价明细表 */}
          <div className="terminal-panel rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs text-slate-300 font-mono-num">
              <thead className="bg-slate-950/80 text-slate-400 font-medium tracking-tight text-[11px] border-b border-slate-800 font-sans">
                <tr>
                  <th className="py-2.5 px-3">{tr('spThChain')}</th>
                  <th className="py-2.5 px-3">{tr('spThDex')}</th>
                  <th className="py-2.5 px-3">合约地址 (Contract)</th>
                  <th className="py-2.5 px-3 text-right">{tr('spThPrice')}</th>
                  <th className="py-2.5 px-3 text-right">{tr('spThLiq')}</th>
                  <th className="py-2.5 px-3 text-right">{tr('spThVol')}</th>
                  <th className="py-2.5 px-3 text-center">{tr('spThVerdict')}</th>
                  <th className="py-2.5 px-3 text-center">{tr('spThLink')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {(result.quotes || []).map((q: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-800/40 transition duration-150">
                    <td className="py-2 px-3 font-sans font-medium text-slate-200">{q.chain}</td>
                    <td className="py-2 px-3 font-sans text-slate-400">{q.dex || 'DEX'}</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-400">
                      {q.tokenAddress ? (
                        <span title={q.tokenAddress}>{q.tokenAddress.slice(0, 6)}...{q.tokenAddress.slice(-4)}</span>
                      ) : '—'}
                    </td>
                    <td className="py-2 px-3 text-right font-bold text-slate-100">{usd(q.priceUsd)}</td>
                    <td className="py-2 px-3 text-right text-slate-300">{usd(q.liquidityUsd)}</td>
                    <td className="py-2 px-3 text-right text-slate-400 font-bold">{usd(q.volume24h)}</td>
                    <td className="py-2 px-3 text-center font-sans">
                      <VerdictBadge verdict={q.verdict} size="xs" />
                    </td>
                    <td className="py-2 px-3 text-center font-sans">
                      <div className="flex items-center justify-center gap-1.5">
                        {q.pairUrl && (
                          <a
                            href={q.pairUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 text-slate-500 hover:text-blue-400 inline-flex transition"
                            title="打开 DEX 池子 (DexScreener)"
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                        {q.explorerUrl && (
                          <a
                            href={q.explorerUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 text-slate-500 hover:text-emerald-400 inline-flex transition"
                            title="打开区块链浏览器"
                          >
                            <ExternalLink size={12} className="rotate-45" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
