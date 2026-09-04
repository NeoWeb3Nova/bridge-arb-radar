import React, { useEffect, useState } from 'react';
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
  Sun, Moon, Languages, Sparkles
} from 'lucide-react';
import { ago } from './utils/format';
import { useTheme } from './context/ThemeContext';
import { useI18n } from './context/I18nContext';

export const App: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { locale, toggleLocale, t: tr } = useI18n();
  const [tab, setTab] = useState<'dash' | 'feed' | 'wallets' | 'tokens' | 'spread' | 'decisions'>('dash');
  const [state, setState] = useState<AppState | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<WalletItem | null>(null);
  const [selectedOpp, setSelectedOpp] = useState<OpportunityItem | null>(null);
  const [scanning, setScanning] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    es.addEventListener('opportunities', () => fetchState());
    es.onerror = () => setSseConnected(false);

    return () => es.close();
  }, []);

  const handleScan = async () => {
    setScanning(true);
    try {
      await fetch('/api/scan', { method: 'POST' });
    } catch (e) {
      console.error(e);
      setScanning(false);
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
              onClick={() => setTab(item.id as any)}
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
              <div className="terminal-panel p-4">
                <div className="text-[11px] text-[var(--text-secondary)] font-medium tracking-tight mb-1">{tr('mTransfers')}</div>
                <div className="font-mono-num text-2xl font-bold text-[var(--text-primary)]">
                  {state?.counts.transfers.toLocaleString() || '0'}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-1">{tr('mTransfersSub')} {state?.counts.transfers24h || 0} {tr('mTransfersUnit')}</div>
              </div>

              <div className="terminal-panel p-4">
                <div className="text-[11px] text-[var(--text-secondary)] font-medium tracking-tight mb-1">{tr('mWallets')}</div>
                <div className="font-mono-num text-2xl font-bold text-[var(--text-primary)]">
                  {state?.counts.wallets.toLocaleString() || '0'}
                </div>
                <div className="text-[10px] text-[#45c4b0] mt-1">{tr('mWalletsSub')}: {state?.counts.walletsA || 0} {tr('mWalletsUnit')}</div>
              </div>

              <div className="terminal-panel p-4">
                <div className="text-[11px] text-[var(--text-secondary)] font-medium tracking-tight mb-1">{tr('mOpps')}</div>
                <div className="font-mono-num text-2xl font-bold text-[#f5c042]">
                  {state?.counts.opportunities || '0'}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-1">{tr('mOppsSub')}</div>
              </div>

              <div className="terminal-panel p-4">
                <div className="text-[11px] text-[var(--text-secondary)] font-medium tracking-tight mb-1">{tr('mDecisions')}</div>
                <div className="font-mono-num text-2xl font-bold text-[#45c4b0]">
                  {state?.counts.decisions || '0'}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-1">{tr('mDecisionsSub')}</div>
              </div>
            </div>

            {/* 跨链套利交易执行矩阵 DataMatrix */}
            <ArbitrageMatrix
              opportunities={state?.opportunities || []}
              onSelectOpp={(opp) => setSelectedOpp(opp)}
              sseConnected={sseConnected}
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
        {tab === 'tokens' && <TokensView />}
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
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};
export default App;
