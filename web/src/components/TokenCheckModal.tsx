import React, { useState } from 'react';
import { OpportunityItem, SecurityCheckResult, AdjudicationVerdict } from '../types';
import { usd, usdCompact, short } from '../utils/format';
import { VerdictBadge } from './VerdictBadge';
import { 
  X, ExternalLink, ArrowRight, ShieldCheck, ShieldAlert, 
  Copy, Check, Sparkles, TrendingUp, Layers, CheckCircle2, AlertCircle
} from 'lucide-react';
import { useI18n } from '../context/I18nContext';

export interface TokenCheckReport {
  token: {
    chain: string;
    address: string;
    symbol: string;
  };
  result: {
    quotes: Array<{
      chain: string;
      dex: string;
      priceUsd: number;
      liquidityUsd?: number;
      volume24h?: number;
      pairUrl?: string;
      verdict: AdjudicationVerdict;
      explorerUrl?: string;
      tokenAddress?: string;
    }>;
    best?: OpportunityItem | null;
    adjudicated?: boolean;
    anchor?: { price: number; name: string; source: string } | null;
    verdicts?: Array<{ chain: string; address: string; verdict: string; reason: string }>;
  };
  security?: SecurityCheckResult | null;
}

interface Props {
  report: TokenCheckReport | null;
  onClose: () => void;
  onNavigateToDash?: () => void;
  onSelectOpp?: (opp: OpportunityItem) => void;
}

export const TokenCheckModal: React.FC<Props> = ({ 
  report, 
  onClose, 
  onNavigateToDash,
  onSelectOpp 
}) => {
  const { locale } = useI18n();
  const [copied, setCopied] = useState(false);

  if (!report) return null;

  const { token, result, security } = report;
  const best = result.best;
  const quotes = result.quotes || [];

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleGoToOpportunity = () => {
    if (best) {
      onSelectOpp?.(best);
    } else {
      onNavigateToDash?.();
    }
    onClose();
  };

  const isFakeOrCollision = !!best && (
    best.verdict === 'fake' ||
    best.collisionRisk === true ||
    best.isSymbolCollision === true ||
    best.spreadPct > 100 ||
    (best.sellQuoteReserveUsd !== undefined && best.sellQuoteReserveUsd < 300)
  );

  // 计算多链最高价与最低价点差
  const validQuotes = quotes.filter(q => q && q.priceUsd > 0);
  let maxQuoteSpread = 0;
  if (validQuotes.length >= 2) {
    const minP = Math.min(...validQuotes.map(q => q.priceUsd));
    const maxP = Math.max(...validQuotes.map(q => q.priceUsd));
    if (minP > 0) maxQuoteSpread = ((maxP - minP) / minP) * 100;
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div 
        className="terminal-panel rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col border border-[var(--border-subtle)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#f5c042]/15 border border-[#f5c042]/30 flex items-center justify-center text-[#f5c042]">
              <Sparkles size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-base text-[var(--text-primary)]">
                  {token.symbol || '未知代币'}
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-sans font-medium bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                  {token.chain}
                </span>
                {security && (
                  security.isHoneypot ? (
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-rose-500/25 text-rose-300 border border-rose-500/40 flex items-center gap-1 animate-pulse">
                      <ShieldAlert size={10} className="text-rose-400" />
                      <span>{locale === 'zh' ? '高危貔貅' : 'Honeypot'}</span>
                    </span>
                  ) : security.riskLevel === 'warning' ? (
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                      <ShieldAlert size={10} className="text-amber-400" />
                      <span>{locale === 'zh' ? '有税/限制' : 'Tax'}</span>
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                      <ShieldCheck size={10} className="text-emerald-400" />
                      <span>{locale === 'zh' ? '0%税安全' : '0% Tax'}</span>
                    </span>
                  )
                )}
              </div>
              <div className="text-[11px] font-mono text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                <span>{short(token.address, 10)}</span>
                <button 
                  onClick={() => handleCopy(token.address)}
                  className="hover:text-[var(--text-primary)] transition"
                  title="复制合约地址"
                >
                  {copied ? <Check size={11} className="text-[#45c4b0]" /> : <Copy size={11} />}
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center transition cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容滚动区 */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* 1. 核心套利产出卡片 (发现机会 VS 未发现机会) */}
          {/* 1. 核心套利产出卡片 (真实机会 VS 假套利拦截 VS 无套利空间) */}
          {best && !isFakeOrCollision ? (
            <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  <span className="font-bold text-sm text-emerald-400">
                    {locale === 'zh' ? '🎯 成功捕获跨链套利机会！' : '🎯 Cross-Chain Arbitrage Opportunity Found!'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    +{best.spreadPct.toFixed(2)}% 价差
                  </span>
                </div>

                {typeof best.qualityScore === 'number' && (
                  <div className={`px-2 py-0.5 rounded font-mono font-bold text-xs border flex items-center gap-1 ${
                    best.qualityScore >= 85 ? 'bg-amber-400/20 text-amber-300 border-amber-400/40' :
                    best.qualityScore >= 70 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                    best.qualityScore >= 50 ? 'bg-sky-500/20 text-sky-300 border-sky-500/30' :
                    'bg-slate-500/20 text-slate-300 border-slate-500/30'
                  }`}>
                    <span>{best.qualityGrade} 级</span>
                    <span>{best.qualityScore} 分</span>
                    <span className="text-[10px] font-normal font-sans ml-1 text-[var(--text-muted)]">
                      ({best.scoreComment})
                    </span>
                  </div>
                )}
              </div>

              {/* 买卖路线指示 */}
              <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-2 p-2.5 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] font-mono-num">
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] font-sans">
                    {locale === 'zh' ? '低价买入腿' : 'Buy Leg'}
                  </div>
                  <div className="font-bold text-[var(--text-primary)] text-sm">
                    {best.buyChainName} · {best.buyDex}
                  </div>
                  {best.buyTokenName && (
                    <div className="text-[10px] text-[var(--text-secondary)] font-sans truncate" title={best.buyTokenName}>
                      {best.buyTokenName}
                    </div>
                  )}
                  <div className="text-[#f5c042] font-semibold mt-0.5">
                    {usd(best.buyPrice)}
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center px-1 text-[var(--text-muted)]">
                  <span className="text-[8px] font-mono uppercase mb-0.5">Bridge</span>
                  <div className="w-6 h-5 rounded bg-[var(--bg-elevated)] flex items-center justify-center text-emerald-400 border border-[var(--border-subtle)]">
                    <ArrowRight size={11} />
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] text-[var(--text-muted)] font-sans">
                    {locale === 'zh' ? '高价卖出腿' : 'Sell Leg'}
                  </div>
                  <div className="font-bold text-[var(--text-primary)] text-sm">
                    {best.sellChainName} · {best.sellDex}
                  </div>
                  {best.sellTokenName && (
                    <div className="text-[10px] text-[var(--text-secondary)] font-sans truncate" title={best.sellTokenName}>
                      {best.sellTokenName}
                    </div>
                  )}
                  <div className="text-emerald-400 font-bold mt-0.5">
                    {usd(best.sellPrice)}
                  </div>
                </div>
              </div>

              {/* 底部联动提示与按钮 */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                  <span>
                    {locale === 'zh' 
                      ? '该机会已自动同步并沉淀至首页【跨链机会矩阵】，可在矩阵中精算 Gas 与滑点' 
                      : 'Opportunity automatically synced to Arbitrage Matrix.'}
                  </span>
                </div>
                <button
                  onClick={handleGoToOpportunity}
                  className="px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-600 text-black font-bold text-xs transition flex items-center gap-1 cursor-pointer shadow"
                >
                  <span>{locale === 'zh' ? '前往机会矩阵查看' : 'View in Matrix'}</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
          ) : isFakeOrCollision ? (
            <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/30 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert size={16} className="text-rose-400 shrink-0" />
                  <span className="font-bold text-sm text-rose-400">
                    {locale === 'zh' ? '🚨 假套利拦截 · 证实为同名不同币 (Symbol Collision)' : '🚨 Fake Arbitrage Blocked · Symbol Collision'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    +{best.spreadPct.toFixed(1)}% 虚假纸面价差
                  </span>
                </div>

                <div className="px-2 py-0.5 rounded font-mono font-bold text-xs border flex items-center gap-1 bg-rose-500/20 text-rose-300 border-rose-500/30">
                  <span>D 级 · 0 分</span>
                  <span className="text-[10px] font-normal font-sans ml-1 text-rose-300/80">
                    ({best.scoreComment || '假套利 · 无承兑通道'})
                  </span>
                </div>
              </div>

              {/* 警示说明框 */}
              <div className="p-2.5 rounded bg-rose-950/40 border border-rose-500/30 text-[11px] text-rose-200/95 leading-relaxed font-sans">
                <div className="font-bold flex items-center gap-1 mb-1 text-rose-300">
                  <span>⚠️ 为什么这不是真实套利机会？</span>
                </div>
                <div>
                  虽然两条链上的代币符号均为 <strong className="text-white font-mono">{token.symbol}</strong>，但经链上元数据与流动性深度穿透核验，证实两端属于<strong>两个完全独立的代币项目或操纵假池</strong>。
                  两链之间<strong>不存在任何可通兑互换的跨链桥通道</strong>。若在低价链买入尝试跨链，资产将无法入账或直接归零！系统已对该虚假价差实施安全阻断。
                </div>
              </div>

              {/* 买卖两端资产比对 */}
              <div className="grid grid-cols-[1fr,auto,1fr] items-center gap-2 p-2.5 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] font-mono-num">
                <div>
                  <div className="text-[10px] text-[var(--text-muted)] font-sans">
                    {locale === 'zh' ? '低价端代币' : 'Low Price Leg'}
                  </div>
                  <div className="font-bold text-[var(--text-primary)] text-sm">
                    {best.buyChainName} · {best.buyDex}
                  </div>
                  <div className="text-[10px] text-[var(--text-secondary)] font-sans truncate" title={best.buyTokenName || ''}>
                    项目: {best.buyTokenName || token.symbol}
                  </div>
                  <div className="text-[#f5c042] font-semibold mt-0.5">
                    {usd(best.buyPrice)}
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center px-1 text-rose-400">
                  <span className="text-[8px] font-mono uppercase mb-0.5 text-rose-400/80">无承兑通道</span>
                  <div className="w-6 h-5 rounded bg-rose-500/20 flex items-center justify-center text-rose-400 border border-rose-500/40">
                    <X size={12} />
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] text-[var(--text-muted)] font-sans">
                    {locale === 'zh' ? '高价端代币' : 'High Price Leg'}
                  </div>
                  <div className="font-bold text-[var(--text-primary)] text-sm">
                    {best.sellChainName} · {best.sellDex}
                  </div>
                  <div className="text-[10px] text-[var(--text-secondary)] font-sans truncate" title={best.sellTokenName || ''}>
                    项目: {best.sellTokenName || token.symbol}
                  </div>
                  <div className="text-rose-400 font-bold mt-0.5">
                    {usd(best.sellPrice)}
                  </div>
                </div>
              </div>

              {/* 底部拦截反馈 */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="text-[11px] text-rose-300/80 flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-emerald-400 shrink-0" />
                  <span>
                    {locale === 'zh' 
                      ? '系统已阻断该虚假信号，未将其沉淀至首页套利矩阵，有效杜绝误操作亏损' 
                      : 'Blocked from Arbitrage Matrix to prevent loss.'}
                  </span>
                </div>
                <span className="px-3 py-1 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold text-xs">
                  {locale === 'zh' ? '🛡️ 已安全拦截 (杜绝损失)' : '🛡️ Blocked'}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-lg bg-[var(--bg-elevated)]/60 border border-[var(--border-subtle)] space-y-2">
              <div className="flex items-center gap-2">
                <AlertCircle size={15} className="text-amber-400" />
                <span className="font-bold text-sm text-[var(--text-primary)]">
                  {locale === 'zh' ? '当前暂无跨链套利空间' : 'No Arbitrage Opportunity Found'}
                </span>
              </div>
              <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed font-sans">
                {validQuotes.length <= 1 ? (
                  <span>
                    该代币仅在 <strong>{token.chain}</strong> 链检测到有效 DEX 流动性池（{validQuotes[0]?.dex || 'DEX'}），尚未在其他链部署或无公开交易池，因此无法构建跨链套利闭环。
                  </span>
                ) : maxQuoteSpread < 0.5 ? (
                  <span>
                    已穿透扫描全网 <strong>{validQuotes.length}</strong> 条链的实时价格，各链价格高度联动一致（全网最大点差仅 <strong>+{maxQuoteSpread.toFixed(2)}%</strong>，低于 0.5% 门槛），处于健康平水状态，无利可图。
                  </span>
                ) : (
                  <span>
                    已核验全网报价，部分链价格偏离过大被裁决过滤，或短板流动性/交易量未达最低安全门槛。
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 2. GoPlus 智能合约代码安全审计卡片 */}
          {security && (
            <div className={`p-3 rounded-lg border space-y-2 ${
              security.isHoneypot
                ? 'bg-rose-500/10 border-rose-500/30'
                : security.riskLevel === 'warning'
                ? 'bg-amber-500/10 border-amber-500/25'
                : 'bg-emerald-500/10 border-emerald-500/20'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  {security.isHoneypot ? (
                    <ShieldAlert size={14} className="text-rose-400" />
                  ) : (
                    <ShieldCheck size={14} className="text-emerald-400" />
                  )}
                  <span>GoPlus 智能合约代码安全体检报告</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  security.isHoneypot
                    ? 'bg-rose-500/25 text-rose-300'
                    : security.riskLevel === 'warning'
                    ? 'bg-amber-500/25 text-amber-300'
                    : 'bg-emerald-500/20 text-emerald-300'
                }`}>
                  {security.isHoneypot ? '🚨 貔貅高危 (Honeypot)' : (security.riskLevel === 'warning' ? '⚠️ 代码存在风险限制' : '✓ 代码体检通过 · 0%税')}
                </span>
              </div>

              <div className="text-[11px] text-[var(--text-secondary)]">
                {security.riskReason}
              </div>

              {/* 双端或单端安全细节 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono pt-1 border-t border-[var(--border-subtle)]/40">
                {security.buySecurity && (
                  <div className="bg-[var(--bg-base)]/60 p-2 rounded border border-[var(--border-subtle)]/40 space-y-0.5">
                    <div className="font-sans font-bold text-[var(--text-primary)]">
                      {token.chain} 合约体检:
                    </div>
                    <div>貔貅代码: {security.buySecurity.isHoneypot ? '是 (无法卖出) ⚠️' : '否 ✓'}</div>
                    <div>交易税率: 买 {((security.buySecurity.buyTax || 0) * 100).toFixed(1)}% / 卖 {((security.buySecurity.sellTax || 0) * 100).toFixed(1)}%</div>
                    <div>开源状态: {security.buySecurity.isOpenSource ? '已开源 ✓' : '闭源 ⚠️'}</div>
                    {security.buySecurity.isBlacklisted && <div className="text-amber-400">含黑名单函数 ⚠️</div>}
                  </div>
                )}
                {security.sellSecurity && (
                  <div className="bg-[var(--bg-base)]/60 p-2 rounded border border-[var(--border-subtle)]/40 space-y-0.5">
                    <div className="font-sans font-bold text-[var(--text-primary)]">
                      卖出端合约体检:
                    </div>
                    <div>貔貅代码: {security.sellSecurity.isHoneypot ? '是 (无法卖出) ⚠️' : '否 ✓'}</div>
                    <div>交易税率: 买 {((security.sellSecurity.buyTax || 0) * 100).toFixed(1)}% / 卖 {((security.sellSecurity.sellTax || 0) * 100).toFixed(1)}%</div>
                    <div>开源状态: {security.sellSecurity.isOpenSource ? '已开源 ✓' : '闭源 ⚠️'}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. 全链 DEX 实时报价与池深表格 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-[var(--text-primary)] flex items-center gap-1.5">
                <Layers size={13} className="text-blue-400" />
                <span>全链 DEX 实时报价与池深 ({quotes.length} 条)</span>
              </span>
              <span className="text-[10px] text-[var(--text-muted)] font-mono">
                DexScreener 毫秒级链上穿透
              </span>
            </div>

            <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
              <table className="w-full text-left text-[11px] font-mono-num">
                <thead className="bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-b border-[var(--border-subtle)] font-sans text-[10px]">
                  <tr>
                    <th className="py-2 px-2.5">链 / DEX</th>
                    <th className="py-2 px-2.5">实时价格 (USD)</th>
                    <th className="py-2 px-2.5">流动性池深 (TVL)</th>
                    <th className="py-2 px-2.5">24h 成交量</th>
                    <th className="py-2 px-2.5 text-center">状态裁决</th>
                    <th className="py-2 px-2.5 text-right font-sans">链上核验</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {quotes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-6 text-[var(--text-muted)] font-sans">
                        未在主流链检索到活跃 DEX 交易对
                      </td>
                    </tr>
                  ) : (
                    quotes.map((q, idx) => (
                      <tr key={idx} className="hover:bg-[var(--bg-elevated)]/40 transition">
                        <td className="py-2 px-2.5 font-sans">
                          <div className="font-bold text-[var(--text-primary)]">{q.chain}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">{q.dex}</div>
                        </td>
                        <td className="py-2 px-2.5 font-bold text-[var(--text-primary)]">
                          {q.priceUsd > 0 ? usd(q.priceUsd) : '—'}
                        </td>
                        <td className="py-2 px-2.5 text-[var(--text-secondary)]">
                          {q.liquidityUsd ? usd(q.liquidityUsd) : '—'}
                        </td>
                        <td className="py-2 px-2.5 text-[var(--text-muted)]">
                          {q.volume24h ? usdCompact(q.volume24h) : '—'}
                        </td>
                        <td className="py-2 px-2.5 text-center">
                          <VerdictBadge verdict={q.verdict} size="xs" />
                        </td>
                        <td className="py-2 px-2.5 text-right">
                          <div className="inline-flex items-center gap-1">
                            {q.pairUrl && (
                              <a
                                href={q.pairUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] hover:text-[#f5c042] text-[10px] flex items-center gap-0.5 border border-[var(--border-subtle)]"
                                title="打开 DEX 行情图表"
                              >
                                <span>DEX</span>
                                <ExternalLink size={9} />
                              </a>
                            )}
                            {q.explorerUrl && (
                              <a
                                href={q.explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] hover:text-blue-400 text-[10px] flex items-center gap-0.5 border border-[var(--border-subtle)]"
                                title="打开官方 Explorer 验证合约"
                              >
                                <span>Scan</span>
                                <ExternalLink size={9} />
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 底部按钮栏 */}
        <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 flex items-center justify-between shrink-0">
          <span className="text-[10px] text-[var(--text-muted)] font-mono">
            核验时间: {new Date().toLocaleTimeString()}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] text-xs font-medium cursor-pointer transition"
            >
              {locale === 'zh' ? '关闭' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
