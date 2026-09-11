import React, { useEffect, useState } from 'react';
import { 
  ShieldCheck, AlertTriangle, RefreshCw, ChevronDown, ChevronUp, 
  ExternalLink, Zap, ArrowRight, ShieldAlert, CheckCircle2,
  HelpCircle, ArrowUpRight, Sliders, Calculator, Check, ArrowLeftRight,
  Shield, Layers
} from 'lucide-react';
import { DepegStatusResponse, DepegAlertItem, DepegTokenSummary } from '../types';

interface DepegRadarProps {
  mode?: 'compact' | 'full';
  onSelectToken?: (symbol: string) => void;
  onOpenFullView?: () => void;
  onOpenSettings?: () => void;
  enabled?: boolean;
}

export const DepegRadar: React.FC<DepegRadarProps> = ({ 
  mode = 'compact', 
  onSelectToken, 
  onOpenFullView,
  onOpenSettings,
  enabled = true
}) => {
  const [data, setData] = useState<DepegStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('USDC');
  const [selectedPlaybook, setSelectedPlaybook] = useState<DepegAlertItem | null>(null);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [calcPrincipal, setCalcPrincipal] = useState<number>(10000);

  const fetchDepegStatus = async (force = false) => {
    try {
      setLoading(true);
      const url = force ? '/api/depeg/refresh' : '/api/depeg/status';
      const method = force ? 'POST' : 'GET';
      const res = await fetch(url, { method });
      const json = await res.json();
      if (json && json.ok) {
        setData(json);
        if (json.alerts && json.alerts.length > 0 && !selectedPlaybook) {
          setSelectedPlaybook(json.alerts[0]);
        }
      }
    } catch (err) {
      console.warn('Failed to load depeg status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (enabled !== false) {
      fetchDepegStatus();
      const interval = setInterval(() => {
        if (!document.hidden) {
          fetchDepegStatus(false);
        }
      }, 35000);
      return () => clearInterval(interval);
    }
  }, [enabled]);

  const isDepegged = data?.status === 'depeg';
  const isWarning = data?.status === 'warning';
  const isDisabled = enabled === false || data?.status === 'disabled';
  const alertsCount = data?.alerts?.length || 0;

  const currentToken = data?.tokens?.find((t) => t.symbol === activeTab) || data?.tokens?.[0];

  // --------------------------------------------------------------------------
  // 模式 1：已在设置中关闭监控时的占位视图
  // --------------------------------------------------------------------------
  if (isDisabled) {
    if (mode === 'compact') {
      return (
        <div className="terminal-panel p-3 border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-xs text-[var(--text-secondary)]">
            <Shield className="w-4 h-4 text-[var(--text-muted)]" />
            <span>稳定币脱锚监控当前处于<strong className="text-[var(--text-primary)]">停用</strong>状态</span>
          </div>
          <button
            onClick={() => onOpenSettings?.()}
            className="text-xs text-[#f5c042] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" /> 前往配置开启
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="terminal-panel p-8 text-center border border-[var(--border-subtle)] space-y-4 max-w-xl mx-auto my-12">
          <div className="w-14 h-14 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center mx-auto text-[var(--text-muted)]">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-[var(--text-primary)]">稳定币脱锚专项监测已关闭</h3>
            <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto leading-relaxed">
              您当前在系统配置中关闭了稳定币脱锚监测功能。开启后系统将全天候多链扫描 USDC / USDT / DAI / PYUSD 挂钩状态，并自动生成 Circle CCTP 1:1 等刚性套利方案。
            </p>
          </div>
          <button
            onClick={() => onOpenSettings?.()}
            className="impeccable-btn-primary px-5 py-2 text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-lg"
          >
            <Sliders className="w-4 h-4" /> 前往设置页面开启
          </button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 模式 2：Compact 模式 (嵌入在概览看板 Dashboard 顶部)
  // --------------------------------------------------------------------------
  if (mode === 'compact') {
    return (
      <div className={`terminal-panel transition-all duration-300 overflow-hidden border ${
        isDepegged 
          ? 'border-rose-500/50 shadow-lg shadow-rose-950/20 bg-gradient-to-b from-rose-950/10 via-[var(--bg-surface)] to-[var(--bg-surface)]'
          : isWarning
          ? 'border-amber-500/40 shadow-md shadow-amber-950/20 bg-gradient-to-b from-amber-950/10 via-[var(--bg-surface)] to-[var(--bg-surface)]'
          : 'border-[var(--border-subtle)] hover:border-[#45c4b0]/40'
      }`}>
        <div className="p-3.5 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`relative w-9 h-9 rounded-lg flex items-center justify-center border transition-all ${
              isDepegged 
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-400' 
                : isWarning
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            }`}>
              {isDepegged ? (
                <ShieldAlert className="w-5 h-5 animate-pulse" />
              ) : isWarning ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <ShieldCheck className="w-5 h-5" />
              )}
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-surface)] ${
                isDepegged ? 'bg-rose-500 animate-ping' : isWarning ? 'bg-amber-500' : 'bg-emerald-400'
              }`} />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-1.5">
                  稳定币脱锚专项雷达
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                    Depeg Watch
                  </span>
                </h3>

                {isDepegged ? (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                    🚨 发现 {alertsCount} 笔脱锚套利机会
                  </span>
                ) : isWarning ? (
                  <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    ⚠️ 存在轻微跨链利差 ({alertsCount} 笔)
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 inline" />
                    各链挂钩健康 (偏离 ≤0.5%)
                  </span>
                )}
              </div>

              <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                全链原生合约多点核验 · 自动匹配 Circle CCTP 1:1、Maker PSM 等刚性套利通道
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="hidden lg:flex items-center gap-1.5 bg-[var(--bg-base)]/80 p-1 rounded-md border border-[var(--border-subtle)]">
              {data?.tokens?.slice(0, 4).map((t) => (
                <div 
                  key={t.symbol} 
                  className="px-2 py-1 rounded text-[11px] font-mono flex items-center gap-1.5 text-[var(--text-secondary)]"
                >
                  <span className="font-semibold text-[var(--text-primary)]">{t.symbol}</span>
                  <span className={`font-mono-num ${
                    Math.abs(t.medianPrice - 1.0) > 0.005 ? 'text-amber-400 font-bold' : 'text-[var(--text-muted)]'
                  }`}>
                    ${t.medianPrice.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={() => fetchDepegStatus(true)}
              disabled={loading}
              className="p-1.5 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer border border-transparent hover:border-[var(--border-subtle)] disabled:opacity-50"
              title="强制刷新稳定币全链行情"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#f5c042]' : ''}`} />
            </button>

            {onOpenFullView && (
              <button
                onClick={onOpenFullView}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[#f5c042]/10 hover:bg-[#f5c042]/20 text-[#f5c042] border border-[#f5c042]/30 font-semibold transition cursor-pointer"
              >
                <span>进入脱锚雷达标签页</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // 模式 3：Full 模式 (独立的脱锚雷达标签页 / Dedicated Depeg Tab)
  // --------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* 顶部主横幅面板 */}
      <div className={`terminal-panel p-5 sm:p-6 border transition-all ${
        isDepegged 
          ? 'border-rose-500/50 shadow-xl shadow-rose-950/20 bg-gradient-to-r from-rose-950/20 via-[var(--bg-surface)] to-[var(--bg-surface)]'
          : isWarning
          ? 'border-amber-500/40 shadow-lg shadow-amber-950/20 bg-gradient-to-r from-amber-950/20 via-[var(--bg-surface)] to-[var(--bg-surface)]'
          : 'border-[var(--border-subtle)]'
      }`}>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 ${
              isDepegged 
                ? 'bg-rose-500/20 border-rose-500/50 text-rose-400' 
                : isWarning
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
            }`}>
              {isDepegged ? (
                <ShieldAlert className="w-7 h-7 animate-pulse" />
              ) : isWarning ? (
                <AlertTriangle className="w-7 h-7" />
              ) : (
                <ShieldCheck className="w-7 h-7" />
              )}
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                  稳定币脱锚专项雷达 (Depeg Watch)
                </h1>

                {isDepegged ? (
                  <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
                    🚨 发现 {alertsCount} 笔脱锚套利机会
                  </span>
                ) : isWarning ? (
                  <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    ⚠️ 存在轻微跨链利差 ({alertsCount} 笔)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 inline" />
                    全网主流锚定健康 (挂钩偏差 ≤0.5%)
                  </span>
                )}
              </div>

              <p className="text-xs text-[var(--text-secondary)] leading-relaxed max-w-2xl">
                锁定全网 Canonical 官方原生合约，多节点并行核验 USDC / USDT / DAI / USDS / PYUSD。一旦检测到跨链价格分歧，自动结合 Circle CCTP 1:1、Maker PSM、借贷协议折价平账等刚性通道生成无滑点实操路径。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setShowInfoModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] transition cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>套利原理科普</span>
            </button>

            <button
              onClick={() => onOpenSettings?.()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] transition cursor-pointer"
              title="配置稳定币监控参数"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>监控参数</span>
            </button>

            <button
              onClick={() => fetchDepegStatus(true)}
              disabled={loading}
              className="impeccable-btn-primary flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? '正在复核全链...' : '立即复核'}</span>
            </button>
          </div>
        </div>

        {/* 顶部行情实时小卡片 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 mt-5 pt-4 border-t border-[var(--border-subtle)]/60">
          {data?.tokens?.map((t) => {
            const isTab = t.symbol === activeTab;
            const dev = Math.abs(t.medianPrice - 1.0);
            return (
              <div 
                key={t.symbol}
                onClick={() => setActiveTab(t.symbol)}
                className={`p-2.5 rounded-lg border transition cursor-pointer flex flex-col justify-between ${
                  isTab 
                    ? 'bg-[#f5c042]/10 border-[#f5c042]/40 shadow-sm' 
                    : 'bg-[var(--bg-base)]/50 border-[var(--border-subtle)] hover:border-[var(--border-subtle-hover)]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-[var(--text-primary)]">{t.symbol}</span>
                  {t.cctpSupported && (
                    <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-sky-500/20 text-sky-300">
                      CCTP
                    </span>
                  )}
                  {t.psmSupported && (
                    <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-purple-500/20 text-purple-300">
                      PSM
                    </span>
                  )}
                </div>
                <div className="flex items-baseline justify-between font-mono">
                  <span className="text-base font-bold text-[var(--text-primary)]">
                    ${t.medianPrice.toFixed(4)}
                  </span>
                  <span className={`text-[10px] ${dev > 0.005 ? 'text-amber-400 font-bold' : 'text-[var(--text-muted)]'}`}>
                    极差 +{t.maxSpreadPct.toFixed(2)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 实操脱锚套利方案卡片 (当存在利差时) */}
      {data?.alerts && data.alerts.length > 0 && (
        <div className="terminal-panel p-5 border border-rose-500/40 bg-gradient-to-br from-rose-950/20 via-[var(--bg-surface)] to-[var(--bg-surface)] space-y-4 shadow-xl">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-2.5 border-b border-rose-500/20">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
              <h2 className="text-sm font-bold text-rose-300 flex items-center gap-2">
                <span>实时脱锚套利路径 (Arbitrage Playbooks Ready)</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 text-rose-200 border border-rose-500/40">
                  {data.alerts.length} 个可执行窗口
                </span>
              </h2>
            </div>
            <span className="text-xs text-[var(--text-muted)]">
              脱锚利差受协议刚性 1:1 承兑保护，区别于普通 DEX 账面坏账
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {data.alerts.map((alert) => {
              const pb = alert.playbook;
              const isSelected = selectedPlaybook?.id === alert.id;
              return (
                <div 
                  key={alert.id}
                  onClick={() => setSelectedPlaybook(alert)}
                  className={`p-3.5 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                    isSelected 
                      ? 'bg-rose-950/30 border-rose-500/70 shadow-lg ring-1 ring-rose-500/40' 
                      : 'bg-[var(--bg-base)]/60 border-[var(--border-subtle)] hover:border-rose-500/40'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-[var(--text-primary)]">{alert.symbol}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 font-semibold">
                          {pb?.badge || '1:1 平价承兑'}
                        </span>
                      </div>
                      <span className="text-sm font-mono font-bold text-rose-400">
                        +{alert.spreadPct.toFixed(2)}%
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs font-mono py-2 px-2.5 rounded bg-[var(--bg-elevated)]/40 border border-[var(--border-subtle)]/40 my-2">
                      <div>
                        <div className="text-[10px] text-[var(--text-muted)]">买入 ({alert.buyChainName})</div>
                        <div className="text-emerald-400 font-bold text-sm">${alert.buyPrice.toFixed(4)}</div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-[var(--text-muted)]" />
                      <div className="text-right">
                        <div className="text-[10px] text-[var(--text-muted)]">卖出 ({alert.sellChainName})</div>
                        <div className="text-rose-400 font-bold text-sm">${alert.sellPrice.toFixed(4)}</div>
                      </div>
                    </div>

                    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mt-1 line-clamp-2">
                      {pb?.description}
                    </p>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-[var(--border-subtle)]/40 flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)]">
                      预估收益/1万U: <strong className="font-mono text-emerald-400">+{((calcPrincipal / alert.buyPrice) * alert.sellPrice - calcPrincipal).toFixed(1)} USD</strong>
                    </span>
                    <span className="text-[#f5c042] flex items-center gap-0.5 font-bold text-[11px]">
                      查看执行步骤 <ArrowUpRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 选中的 Playbook 执行步骤详情 */}
          {selectedPlaybook && (
            <div className="p-4 rounded-xl bg-[var(--bg-base)]/90 border border-rose-500/40 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-[var(--border-subtle)]/60">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#f5c042]" />
                  <span className="text-xs font-bold text-[var(--text-primary)]">
                    {selectedPlaybook.playbook?.name}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)] ml-2">
                    风控评级: <strong className="text-emerald-400">{selectedPlaybook.playbook?.riskLevel}</strong>
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs">
                    <Calculator className="w-3.5 h-3.5 text-[#f5c042]" />
                    <span className="text-[var(--text-muted)]">测算本金:</span>
                    <select
                      value={calcPrincipal}
                      onChange={(e) => setCalcPrincipal(Number(e.target.value))}
                      className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded px-2 py-0.5 text-xs text-[var(--text-primary)] font-mono focus:outline-none"
                    >
                      <option value={2000}>$2,000</option>
                      <option value={5000}>$5,000</option>
                      <option value={10000}>$10,000</option>
                      <option value={50000}>$50,000</option>
                      <option value={100000}>$100,000</option>
                    </select>
                  </div>

                  <button 
                    onClick={() => onSelectToken && onSelectToken(selectedPlaybook.symbol)}
                    className="text-xs text-[#f5c042] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    在执行矩阵中检索此资产 <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {selectedPlaybook.playbook?.steps?.map((st) => (
                  <div key={st.step} className="p-3 rounded-lg bg-[var(--bg-elevated)]/60 border border-[var(--border-subtle)] space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#f5c042]">
                      <span className="w-4 h-4 rounded-full bg-[#f5c042]/20 text-[#f5c042] flex items-center justify-center text-[10px]">
                        {st.step}
                      </span>
                      <span>{st.title}</span>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed pl-5.5">
                      {st.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 各链挂钩行情矩阵 (全量表格与卡片) */}
      <div className="terminal-panel p-5 border border-[var(--border-subtle)] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#45c4b0]" />
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              主流稳定币全链官方原生合约与实时挂钩矩阵
            </h3>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            {data?.tokens?.map((t) => (
              <button
                key={t.symbol}
                onClick={() => setActiveTab(t.symbol)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === t.symbol
                    ? 'bg-[#f5c042]/15 text-[#f5c042] font-bold border border-[#f5c042]/30'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] border border-transparent'
                }`}
              >
                <span>{t.symbol}</span>
                <span className="font-mono text-[10px] opacity-75">${t.medianPrice.toFixed(4)}</span>
              </button>
            ))}
          </div>
        </div>

        {currentToken && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] flex-wrap gap-2">
              <div>
                <strong className="text-[var(--text-primary)]">{currentToken.name}</strong>
                <span className="ml-2 text-[var(--text-muted)]">
                  中位数报价: <span className="font-mono text-[var(--text-primary)]">${currentToken.medianPrice.toFixed(4)}</span> · 最大多链极差: <span className="font-mono text-emerald-400">+{currentToken.maxSpreadPct.toFixed(2)}%</span>
                </span>
              </div>
              <div className="text-[11px] flex items-center gap-3">
                {currentToken.cctpSupported && (
                  <span className="text-sky-400 font-medium">● Circle CCTP 1:1 原生跨链</span>
                )}
                {currentToken.psmSupported && (
                  <span className="text-purple-400 font-medium">● MakerDAO PSM 1:1 承兑</span>
                )}
                {currentToken.oftSupported && (
                  <span className="text-blue-400 font-medium">● LayerZero OFT 1:1 桥接</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {currentToken.chains.map((c) => {
                const dev = c.deviationPct;
                const isSevere = Math.abs(dev) >= 1.2;
                const isMild = Math.abs(dev) >= 0.5;
                return (
                  <div 
                    key={c.chain} 
                    className={`p-3 rounded-lg border transition flex flex-col justify-between ${
                      isSevere
                        ? 'bg-rose-950/25 border-rose-500/50 shadow-md ring-1 ring-rose-500/30'
                        : isMild
                        ? 'bg-amber-950/25 border-amber-500/40 shadow-sm'
                        : 'bg-[var(--bg-elevated)]/50 border-[var(--border-subtle)] hover:border-[#45c4b0]/40'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-bold text-[var(--text-primary)]">{c.chainName}</span>
                        <span className={`font-mono text-[11px] font-bold ${
                          dev < -0.5 ? 'text-emerald-400' : dev > 0.5 ? 'text-rose-400' : 'text-[var(--text-muted)]'
                        }`}>
                          {dev > 0 ? `+${dev.toFixed(2)}%` : `${dev.toFixed(2)}%`}
                        </span>
                      </div>

                      <div className="font-mono-num text-xl font-bold text-[var(--text-primary)]">
                        ${c.price.toFixed(4)}
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-[var(--border-subtle)]/40 flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                      <span title={c.address}>{c.address.slice(0, 6)}...{c.address.slice(-4)}</span>
                      <a 
                        href={`https://debank.com/profile/${c.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#f5c042] hover:underline flex items-center gap-0.5"
                        title="在 DeBank 查验原生合约"
                      >
                        <span>核验</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 稳定币脱锚套利科普说明弹窗 */}
      {showInfoModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="terminal-panel max-w-lg w-full p-5 border border-[#f5c042]/40 bg-[var(--bg-surface)] space-y-3.5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
              <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#f5c042]" />
                为什么稳定币脱锚是绝佳的套利机会？
              </h3>
              <button 
                onClick={() => setShowInfoModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-[var(--text-secondary)] space-y-2.5 leading-relaxed">
              <p>
                普通代币跨链依赖第三方桥流动性，往往面临流动性枯竭或桥费磨损。但主流原生稳定币具备<strong className="text-[var(--text-primary)]">底层协议刚性兑换通道</strong>：
              </p>

              <div className="space-y-2">
                <div className="p-2 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)]">
                  <span className="font-bold text-[#f5c042]">1. Circle CCTP (原生跨链传输协议)：</span>
                  <span className="text-[var(--text-muted)] block mt-0.5">
                    USDC 在以太坊、Arbitrum、Base、Optimism、Solana 之间采用官方「销毁-铸造」模型，<strong>1:1 绝对平价</strong>跨链，无池子滑点。一旦某链 USDC 出现折价（如 $0.985），跨链搬砖即可稳收 1.5% 刚性利差。
                  </span>
                </div>

                <div className="p-2 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)]">
                  <span className="font-bold text-[#45c4b0]">2. MakerDAO / Sky PSM (锚定稳定模块)：</span>
                  <span className="text-[var(--text-muted)] block mt-0.5">
                    Maker 合约支持 DAI 与 USDC 以 1:1 无滑点兑换。当 DAI 出现微小利差时，直接交互 PSM 合约即可零滑点平价兑付。
                  </span>
                </div>

                <div className="p-2 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)]">
                  <span className="font-bold text-rose-400">3. 借贷协议负债折扣平账：</span>
                  <span className="text-[var(--text-muted)] block mt-0.5">
                    Aave / Compound 借贷中，债务账面永远按 $1.00 计价。在二级市场以折扣价购入对应稳定币偿还债务，直接节省等额本金负债。
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-2">
                ⚠️ 本雷达严格筛选 Canonical 原生代币合约，排除了无官方承兑通道的废弃包装代币（如 USDC.e 等），杜绝僵尸池虚假信号。
              </p>
            </div>

            <div className="text-right pt-1">
              <button
                onClick={() => setShowInfoModal(false)}
                className="impeccable-btn-primary px-4 py-1 text-xs cursor-pointer"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
