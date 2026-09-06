import React, { useEffect, useState, useRef } from 'react';
import { AppState, WalletItem, OpportunityItem } from './types';
import { OpportunityCard } from './components/OpportunityCard';
import { ArbitrageMatrix } from './components/ArbitrageMatrix';
import { WalletDrawer } from './components/WalletDrawer';
import { DecisionModal } from './components/DecisionModal';
import { FeedTable } from './components/FeedTable';
import { WalletsView } from './components/WalletsView';
import { TokensView } from './components/TokensView';
import { SpreadChecker } from './components/SpreadChecker';
import { DecisionLedger } from './components/DecisionLedger';
import { SettingsModal } from './components/SettingsModal';
import { 
  Radar, Play, Radio, Layers, 
  TrendingUp, BookOpen, Activity, Settings, 
  Coins, WalletCards, ArrowLeftRight, Clock, ShieldCheck, CheckCircle,
  Sun, Moon, Languages, Sparkles, X
} from 'lucide-react';
import { ago } from './utils/format';
import { useTheme } from './context/ThemeContext';
import { useI18n } from './context/I18nContext';
import { playOpportunitySound, sendDesktopNotification } from './utils/notification';

export const App: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { locale, toggleLocale, t: tr } = useI18n();
  const [tab, setTab] = useState<'dash' | 'feed' | 'wallets' | 'tokens' | 'spread' | 'decisions'>('dash');
  const [state, setState] = useState<AppState | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<WalletItem | null>(null);
  const [selectedOpp, setSelectedOpp] = useState<OpportunityItem | null>(null);
  const [matrixFilterSymbol, setMatrixFilterSymbol] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alertOpportunity, setAlertOpportunity] = useState<OpportunityItem | null>(null);

  const settingsRef = useRef(state?.settings);
  useEffect(() => {
    settingsRef.current = state?.settings;
  }, [state?.settings]);

  useEffect(() => {
    if (!alertOpportunity) return;
    const timer = setTimeout(() => {
      setAlertOpportunity(null);
    }, 12000);
    return () => clearTimeout(timer);
  }, [alertOpportunity]);

  const fetchState = async () => {
    try {
      const res = await fetch('/api/state');
      const data = await res.json();
      if (data.ok) {
        setState(data);
        setScanning(data.scanning);
      }
    } catch (e) {
      console.error('Failed to load state', e);
    }
  };

  useEffect(() => {
    fetchState();

    const es = new EventSource('/api/events');
    es.addEventListener('connected', () => setSseConnected(true));
    es.addEventListener('scan_completed', () => {
      setScanning(false);
      fetchState();
    });
    es.addEventListener('opportunities', (ev: MessageEvent) => {
      fetchState();
      try {
        const payload = JSON.parse(ev.data);
        const items = (payload?.items || []) as OpportunityItem[];
        if (items.length > 0) {
          const notifs = settingsRef.current?.notifications;
          const minSpread = Number(notifs?.minSpreadPct ?? 1.0);
          const valid = items.filter((o) => {
            if (!o) return false;
            if (o.verdict === 'fake' || o.isSymbolCollision || (o as any).collisionRisk) return false;
            return (Number(o.spreadPct) || 0) >= minSpread;
          });

          if (valid.length > 0) {
            const best = valid[0];
            const webConfig = notifs?.web;
            const isWebEnabled = webConfig ? webConfig.enabled !== false : true;
            const isSoundEnabled = webConfig ? webConfig.sound !== false : true;

            if (isWebEnabled) {
              if (isSoundEnabled) {
                playOpportunitySound();
              }
              const title = `🎯 发现跨链套利机会: ${best.symbol} (+${(Number(best.spreadPct) || 0).toFixed(2)}%)`;
              const body = `买入: ${best.buyChainName || best.buyChain} → 卖出: ${best.sellChainName || best.sellChain} | 评级: ${best.qualityGrade || 'A'}级`;
              sendDesktopNotification(title, {
                body,
                onClick: () => {
                  setTab('dash');
                  setMatrixFilterSymbol(best.symbol);
                },
              });
              setAlertOpportunity(best);
            }
          }
        }
      } catch (err) {
        console.warn('Error handling opportunities event:', err);
      }
    });
    es.onerror = () => setSseConnected(false);

    return () => es.close();
  }, []);

  useEffect(() => {
    if (!scanning) return;
    const pollTimer = setInterval(() => {
      fetch('/api/state')
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) {
            setState(d);
            if (!d.scanning) setScanning(false);
          }
        })
        .catch(() => {});
    }, 3500);

    const fallbackTimer = setTimeout(() => {
      setScanning(false);
      fetchState();
    }, 45000);

    return () => {
      clearInterval(pollTimer);
      clearTimeout(fallbackTimer);
    };
  }, [scanning]);

  const handleScan = async () => {
    setScanning(true);
    try {
      await fetch('/api/scan', { method: 'POST' });
    } catch (e) {
      console.error(e);
    } finally {
      setScanning(false);
      fetchState();
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] flex flex-col font-sans transition-colors duration-200">
      {/* 顶部 Impeccable 极简典雅导航条 */}
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-15 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            {/* Impeccable 几何 Logo 标记 */}
            <div className="w-8 h-8 rounded bg-[#f5c042]/10 border border-[#f5c042]/30 flex items-center justify-center text-[#f5c042]">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M5 2.5 L13.5 2.5 L5.5 21.5 L5 21.5 Q2.5 21.5 2.5 19 L2.5 5 Q2.5 2.5 5 2.5 Z" />
                <path d="M16.5 2.5 L19 2.5 Q21.5 2.5 21.5 5 L21.5 19 Q21.5 21.5 19 21.5 L8.5 21.5 Z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-xl tracking-wider uppercase font-bold text-[var(--text-primary)] leading-none">
                  Bridge Arb Radar
                </span>
                <span className="px-1.5 py-0.2 rounded text-[9px] uppercase tracking-widest bg-[#f5c042]/15 text-[#f5c042] border border-[#f5c042]/30 font-bold">
                  Impeccable
                </span>
              </div>
              <div className="text-[11px] text-[var(--text-secondary)] tracking-tight hidden sm:block mt-0.5">
                {tr('tagline')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* 状态指示 */}
            <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)] border-r border-[var(--border-subtle)] pr-3">
              <div className="flex items-center gap-1.5 font-mono text-[11px] hidden md:flex">
                <Clock size={12} className="text-[var(--text-muted)]" />
                <span>{tr('lastScan')}: {ago(state?.lastScanAt)}</span>
              </div>
              <div className="flex items-center gap-1.5 font-medium">
                <span className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-[#45c4b0] shadow-sm shadow-[#45c4b0]/50' : 'bg-[#6e695e]'}`} />
                <span className="hidden lg:inline">{sseConnected ? tr('sseReady') : tr('sseOffline')}</span>
              </div>
            </div>

            {/* 语言切换 */}
            <button
              onClick={toggleLocale}
              className="px-2 py-1 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-mono font-semibold transition cursor-pointer flex items-center gap-1"
              title="中英双语 / Language"
            >
              <Languages size={14} />
              <span>{locale === 'zh' ? 'EN' : '中'}</span>
            </button>

            {/* 主题切换 */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            {/* 设置按钮 */}
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
              title={tr('settingsTitle')}
            >
              <Settings size={15} />
            </button>

            {/* 金箔主操作按钮 */}
            <button
              onClick={handleScan}
              disabled={scanning}
              className="impeccable-btn-primary flex items-center gap-1.5 px-4 py-1.5 text-xs tracking-tight cursor-pointer disabled:opacity-50 ml-1"
            >
              <Play size={12} fill="currentColor" />
              <span>{scanning ? tr('scanningBtn') : tr('scanBtn')}</span>
            </button>
          </div>
        </div>

        {/* 导航标签 */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-6 text-xs font-medium border-t border-[var(--border-subtle)] overflow-x-auto">
          {[
            { id: 'dash', label: tr('tabDash'), icon: <Layers size={14} /> },
            { id: 'feed', label: tr('tabFeed'), icon: <Radio size={14} /> },
            { id: 'wallets', label: tr('tabWallets'), icon: <WalletCards size={14} /> },
            { id: 'tokens', label: tr('tabTokens'), icon: <Coins size={14} /> },
            { id: 'spread', label: tr('tabSpread'), icon: <ArrowLeftRight size={14} /> },
            { id: 'decisions', label: tr('tabDecisions'), icon: <BookOpen size={14} /> },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === 'dash' && tab !== 'dash') {
                  setMatrixFilterSymbol('');
                }
                setTab(item.id as any);
              }}
              className={`py-2.5 border-b-2 flex items-center gap-1.5 transition whitespace-nowrap cursor-pointer tracking-tight ${
                tab === item.id 
                  ? 'border-[#f5c042] text-[#f5c042] font-semibold' 
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>
      </header>

      {/* 主视图区 */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {tab === 'dash' && (
          <div className="space-y-6">
            {/* 核心指标展台 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              {(() => {
                const tokensCount = state?.counts.tokens || 0;
                const unknownCount = state?.counts.unknownTokens || 0;
                const verifiedCount = Math.max(0, tokensCount - unknownCount);
                return (
                  <div
                    className="terminal-panel p-4 cursor-pointer hover:border-[#f5c042]/40 transition group"
                    onClick={() => setTab('tokens')}
                    title={tr('mTokensTooltip')}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[11px] text-[var(--text-secondary)] font-medium tracking-tight">{tr('mTokens')}</div>
                      {unknownCount > 0 ? (
                        <span
                          className="px-1.5 py-0.5 text-[9px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded tracking-tight"
                          title={`${unknownCount} 个待核验链上新币`}
                        >
                          {unknownCount} {tr('mTokensUnknown')}
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded tracking-tight">
                          {tr('mTokensVerified')}
                        </span>
                      )}
                    </div>
                    <div className="font-mono-num text-2xl font-bold text-[var(--text-primary)] flex items-baseline gap-1.5">
                      {tokensCount.toLocaleString()}
                      <span className="text-xs font-normal text-[var(--text-muted)]">
                        {tr('mTokensUnit')}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-1 flex items-center justify-between">
                      <span className="text-[#45c4b0]">{tr('mTokensSub')}: {verifiedCount.toLocaleString()} {tr('mTokensUnit')}</span>
                      <span className="text-[var(--text-muted)] group-hover:text-[#f5c042] transition text-[10px]">
                        代币库 ➔
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div 
                className="terminal-panel p-4 cursor-pointer hover:border-[#45c4b0]/40 transition group"
                onClick={() => setTab('wallets')}
                title="点击前往「聪明钱包」查看深度特征画像与评分榜单"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[11px] text-[var(--text-secondary)] font-medium tracking-tight">{tr('mWallets')}</div>
                  <span className="text-[10px] text-[var(--text-muted)] group-hover:text-[#45c4b0] transition">
                    钱包画像 ➔
                  </span>
                </div>
                <div className="font-mono-num text-2xl font-bold text-[var(--text-primary)]">
                  {state?.counts.wallets.toLocaleString() || '0'}
                </div>
                <div className="text-[10px] text-[#45c4b0] mt-1">{tr('mWalletsSub')}: {state?.counts.walletsA || 0} {tr('mWalletsUnit')}</div>
              </div>

              <div 
                className="terminal-panel p-4 cursor-pointer hover:border-[#f5c042]/40 transition group"
                onClick={() => setTab('spread')}
                title="点击前往「价差矩阵」查看全网实时套利路线与执行明细"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[11px] text-[var(--text-secondary)] font-medium tracking-tight">{tr('mOpps')}</div>
                  <span className="text-[10px] text-[var(--text-muted)] group-hover:text-[#f5c042] transition">
                    价差矩阵 ➔
                  </span>
                </div>
                <div className="font-mono-num text-2xl font-bold text-[#f5c042]">
                  {state?.counts.opportunities || '0'}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-1">{tr('mOppsSub')}</div>
              </div>

              <div
                className="terminal-panel p-4 cursor-pointer hover:border-[#45c4b0]/40 transition group"
                onClick={() => setTab('decisions')}
                title={`已人工决策标的：${state?.counts.decisions || 0} 个，累计已记操盘日志：${state?.counts.decisionLogs || 0} 条，已实现盈亏：${(state?.counts.realizedPnlUsd || 0) >= 0 ? '+' : ''}${(state?.counts.realizedPnlUsd || 0).toFixed(2)} USD`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[11px] text-[var(--text-secondary)] font-medium tracking-tight">{tr('mDecisions')}</div>
                  {(state?.counts.decisions || 0) > 0 && (
                    <span className="px-1.5 py-0.2 text-[9px] font-semibold bg-[#45c4b0]/15 text-[#45c4b0] border border-[#45c4b0]/30 rounded">
                      {state?.counts.decisions} {tr('mDecisionsUnit')}
                    </span>
                  )}
                </div>
                <div className="font-mono-num text-2xl font-bold text-[#45c4b0]">
                  {state?.counts.decisions || '0'}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-1 flex items-center justify-between">
                  <span>
                    {(state?.counts.decisionLogs || 0) > 0
                      ? `${tr('mDecisionsSub')} ${state?.counts.decisionLogs} 条`
                      : (state?.counts.decisions || 0) > 0
                      ? `${state?.counts.decisions} 个标的跟踪中`
                      : tr('mDecisionsEmpty')}
                  </span>
                  {(state?.counts.realizedPnlUsd || 0) !== 0 && (
                    <span className={`font-mono font-bold ${(state?.counts.realizedPnlUsd || 0) >= 0 ? 'text-[#45c4b0]' : 'text-[#e65138]'}`}>
                      {(state?.counts.realizedPnlUsd || 0) >= 0 ? '+' : ''}${(state?.counts.realizedPnlUsd || 0).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 跨链套利交易执行矩阵 DataMatrix */}
            <ArbitrageMatrix
              opportunities={state?.opportunities || []}
              onSelectOpp={(opp) => setSelectedOpp(opp)}
              filterSymbol={matrixFilterSymbol}
              onClearFilter={() => setMatrixFilterSymbol('')}
              sseConnected={sseConnected}
              stablecoinsWhitelist={state?.settings?.stablecoins}
            />

            {/* 高分聪明钱包 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <Activity size={15} className="text-[#45c4b0]" />
                  {tr('topWallets')}
                </h2>
                <button
                  onClick={() => setTab('wallets')}
                  className="text-xs text-[#f5c042] hover:underline font-semibold cursor-pointer"
                >
                  {tr('viewAllWallets')}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {state?.topWallets && state.topWallets.map((w) => (
                  <div
                    key={w.address}
                    onClick={() => setSelectedWallet(w)}
                    className="terminal-panel p-3.5 cursor-pointer transition flex items-center justify-between group"
                  >
                    <div>
                      <div className="font-mono text-xs font-semibold text-[var(--text-primary)] group-hover:text-[#f5c042] transition">
                        {w.address.slice(0, 6)}...{w.address.slice(-4)}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] mt-1 flex items-center gap-2">
                        <span className="text-[#45c4b0] font-mono-num font-medium">{tr('cyclesCount')} {w.capitalCycles}</span>
                        <span className="text-[var(--text-muted)]">·</span>
                        <span className="text-[var(--text-secondary)] font-mono-num">{w.bridgeCount} {tr('bridgesCount')}</span>
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <span className={`font-mono-num font-bold text-xs px-2 py-0.5 rounded border ${
                        w.score >= 90 ? 'text-amber-400 bg-amber-400/15 border-amber-400/30' :
                        w.score >= 75 ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' :
                        w.score >= 50 ? 'text-sky-400 bg-sky-500/15 border-sky-500/30' :
                        'text-[#45c4b0] bg-[#45c4b0]/10 border border-[#45c4b0]/20'
                      }`}>
                        {w.grade ? `${w.grade} · ` : ''}{w.score} {tr('scoreUnit')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'feed' && <FeedTable />}
        {tab === 'wallets' && <WalletsView onSelectWallet={(w) => setSelectedWallet(w)} />}
        {tab === 'tokens' && (
          <TokensView 
            onNavigateToDash={() => {
              setMatrixFilterSymbol('');
              setTab('dash');
            }}
            onViewInMatrix={(symbol, opp) => {
              setMatrixFilterSymbol(symbol);
              setTab('dash');
              if (opp) {
                setState((prev) => {
                  if (!prev) return prev;
                  const filtered = (prev.opportunities || []).filter(
                    (o) => !(o.symbol === opp.symbol && o.buyChain === opp.buyChain && o.sellChain === opp.sellChain)
                  );
                  return {
                    ...prev,
                    opportunities: [opp, ...filtered],
                  };
                });
              }
              fetchState();
            }}
          />
        )}
        {tab === 'spread' && <SpreadChecker />}
        {tab === 'decisions' && <DecisionLedger />}
      </main>

      {/* 钱包侧边抽屉 */}
      <WalletDrawer wallet={selectedWallet} onClose={() => setSelectedWallet(null)} />

      {/* 决策与操盘记录弹窗 */}
      <DecisionModal
        item={selectedOpp}
        onClose={() => setSelectedOpp(null)}
        onSaved={fetchState}
      />

      {/* 数据源与代理设置弹窗 */}
      <SettingsModal 
        isOpen={settingsOpen} 
        onClose={() => setSettingsOpen(false)} 
        onSaveSuccess={fetchState}
      />

      {/* 实时套利机会浮层告警 */}
      {alertOpportunity && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300 max-w-sm w-full bg-[var(--bg-surface)] border border-[#f5c042]/50 rounded-xl shadow-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-bold text-xs text-[#f5c042] uppercase tracking-wider">
                🎯 捕获跨链套利机会
              </span>
            </div>
            <button
              onClick={() => setAlertOpportunity(null)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer p-0.5"
            >
              <X size={15} />
            </button>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono font-bold text-base text-[var(--text-primary)]">
              {alertOpportunity.symbol}
            </span>
            <span className="font-mono font-bold text-base text-emerald-400">
              +{Number(alertOpportunity.spreadPct).toFixed(2)}%
            </span>
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] flex items-center justify-between">
            <span>
              {alertOpportunity.buyChainName || alertOpportunity.buyChain} →{' '}
              {alertOpportunity.sellChainName || alertOpportunity.sellChain}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-[#f5c042]/10 text-[#f5c042] border border-[#f5c042]/20 font-mono text-[10px] font-bold">
              {alertOpportunity.qualityGrade || 'A'}级
            </span>
          </div>
          <div className="pt-1 flex items-center justify-end gap-2">
            <button
              onClick={() => {
                setTab('dash');
                setMatrixFilterSymbol(alertOpportunity.symbol);
                setAlertOpportunity(null);
              }}
              className="px-3 py-1 bg-[#f5c042] text-black font-semibold text-xs rounded hover:opacity-90 transition cursor-pointer"
            >
              前往机会矩阵查看
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
export default App;
