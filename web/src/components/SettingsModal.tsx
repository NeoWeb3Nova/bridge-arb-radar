import React, { useEffect, useState } from 'react';
import { 
  X, Globe, Shield, Save, Check, Bell, Send, 
  Volume2, AlertCircle, CheckCircle2, Sliders, ExternalLink, RefreshCw, Clock,
  Database, Trash2, AlertTriangle, Download, Loader2, Coins, Plus, CheckSquare, Square
} from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { playOpportunitySound, requestNotificationPermission, sendDesktopNotification } from '../utils/notification';
import { DEFAULT_MAJOR_STABLECOINS } from '../utils/routeEstimator';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaveSuccess?: () => void;
}

interface StorageStatus {
  backend: string;
  file: string;
  mainSizeBytes: number;
  walSizeBytes: number;
  backupCount: number;
  integrity: string;
  wal: boolean;
  rowCount?: {
    transfers: number;
    wallets: number;
    tokens: number;
    opportunities: number;
  };
}

interface StablecoinMeta {
  symbol: string;
  name: string;
  issuer: string;
  badge: string;
  badgeColor: string;
  desc: string;
}

const PRESET_STABLECOINS: StablecoinMeta[] = [
  {
    symbol: 'USDT',
    name: 'Tether USD',
    issuer: 'Tether Holdings',
    badge: '全球最大流动性',
    badgeColor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    desc: '全网交易对最广泛，市场占有率第一，跨链流动性底座'
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    issuer: 'Circle / Coinbase',
    badge: '合规审计标杆',
    badgeColor: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    desc: '贝莱德美债基金托管，受美国多州合规监管，透明度极高'
  },
  {
    symbol: 'USDG',
    name: 'Global Dollar',
    issuer: 'Paxos / Robinhood / Kraken',
    badge: '新加坡 MAS 监管',
    badgeColor: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    desc: '全球巨头联合打造的合规美元，星展银行存管，Robinhood/Kraken 深度支持'
  },
  {
    symbol: 'PYUSD',
    name: 'PayPal USD',
    issuer: 'PayPal / Paxos',
    badge: 'NYDFS 牌照',
    badgeColor: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    desc: '全球支付巨头 PayPal 官方合规稳定币，受纽约金融局直接监管'
  },
  {
    symbol: 'FDUSD',
    name: 'First Digital USD',
    issuer: 'First Digital Trust',
    badge: '香港受监管信托',
    badgeColor: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
    desc: '香港注册信托公司 100% 隔离存管，Binance 核心免手续费主力币'
  },
  {
    symbol: 'RLUSD',
    name: 'Ripple USD',
    issuer: 'Ripple Labs',
    badge: '企业级合规',
    badgeColor: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    desc: '纽约金融局 (NYDFS) 批准，专注机构跨国企业级清算'
  },
  {
    symbol: 'USDS',
    name: 'Sky Dollar (原 DAI 升级)',
    issuer: 'Sky Ecosystem (MakerDAO)',
    badge: '美债 RWA 储备',
    badgeColor: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    desc: 'MakerDAO 全新升级代币，含超额加密抵押与合规短期美债储备'
  },
  {
    symbol: 'DAI',
    name: 'MakerDAO Multi-Collateral DAI',
    issuer: 'MakerDAO / Sky',
    badge: '去中心化储备',
    badgeColor: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    desc: '历史最悠久、经受数轮牛熊考验的超额抵押去中心化稳定币'
  },
  {
    symbol: 'USDC.E',
    name: 'Bridged USDC (Official Canonical)',
    issuer: 'Arbitrum / Avalanche 官方跨链桥',
    badge: 'L2 官方包装',
    badgeColor: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    desc: '各 EVM 链官方桥接的 USDC 包装代币，在链上与原生 USDC 1:1 等值'
  },
  {
    symbol: 'USDCE',
    name: 'Bridged USDC (Alternative notation)',
    issuer: 'DEX 常用包装',
    badge: 'AMM 记账符号',
    badgeColor: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    desc: '部分 DEX 流动性池使用的记账符号'
  },
  {
    symbol: 'USDT.E',
    name: 'Bridged USDT (Official Canonical)',
    issuer: 'Layer2 官方跨链桥',
    badge: 'L2 官方包装',
    badgeColor: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    desc: '各链官方跨链桥接包装 USDT'
  },
];

export const SettingsModal: React.FC<Props> = ({ isOpen, onClose, onSaveSuccess }) => {
  const { locale, t: tr } = useI18n();
  const [activeTab, setActiveTab] = useState<'notifications' | 'scan' | 'proxy' | 'stablecoins' | 'storage'>('notifications');

  // Proxy & Keys
  const [proxyUrl, setProxyUrl] = useState('');
  const [useProxy, setUseProxy] = useState(true);
  const [rangeKey, setRangeKey] = useState('');
  const [lifiKey, setLifiKey] = useState('');
  const [etherscanKey, setEtherscanKey] = useState('');

  // Notifications
  const [webEnabled, setWebEnabled] = useState(true);
  const [webSound, setWebSound] = useState(true);
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgBotToken, setTgBotToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [minSpreadPct, setMinSpreadPct] = useState('1.0');

  // Scan & Schedule
  const [scanAutoEnabled, setScanAutoEnabled] = useState(true);
  const [scanIntervalMin, setScanIntervalMin] = useState('5');
  const [scanLookbackHours, setScanLookbackHours] = useState('24');

  // Storage & Database Reset
  const [storageData, setStorageData] = useState<StorageStatus | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  // Triple confirmation modal state
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmInput, setResetConfirmInput] = useState('');
  const [resetKeepSettings, setResetKeepSettings] = useState(true);
  const [resetUnderstood, setResetUnderstood] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);

  // Interactive feedback & Bot Info
  const [botInfo, setBotInfo] = useState<{ id?: number; username?: string; first_name?: string } | null>(null);
  const [detectingChatId, setDetectingChatId] = useState(false);
  const [tgTesting, setTgTesting] = useState(false);
  const [tgTestResult, setTgTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [webTestNotice, setWebTestNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Stablecoins Whitelist
  const [selectedStables, setSelectedStables] = useState<string[]>(DEFAULT_MAJOR_STABLECOINS);
  const [customStableInput, setCustomStableInput] = useState('');

  const toggleStable = (sym: string) => {
    const s = sym.toUpperCase().trim();
    if (selectedStables.includes(s)) {
      setSelectedStables(selectedStables.filter((x) => x !== s));
    } else {
      setSelectedStables([...selectedStables, s]);
    }
  };

  const handleAddCustomStable = () => {
    const s = customStableInput.toUpperCase().trim();
    if (!s) return;
    if (!selectedStables.includes(s)) {
      setSelectedStables([...selectedStables, s]);
    }
    setCustomStableInput('');
  };

  const handleRemoveCustomStable = (sym: string) => {
    setSelectedStables(selectedStables.filter((x) => x !== sym));
  };

  const handleResetToDefaultStables = () => {
    setSelectedStables([...DEFAULT_MAJOR_STABLECOINS]);
  };

  const handleSelectAllStables = () => {
    const all = Array.from(new Set([...DEFAULT_MAJOR_STABLECOINS, ...selectedStables]));
    setSelectedStables(all);
  };

  const checkBotInfo = async (token: string) => {
    if (!token || !token.includes(':')) {
      setBotInfo(null);
      return;
    }
    try {
      const res = await fetch('/api/notifications/get-bot-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: token.trim() }),
      });
      const data = await res.json();
      if (data.ok && data.bot) {
        setBotInfo(data.bot);
      } else {
        setBotInfo(null);
      }
    } catch {
      setBotInfo(null);
    }
  };

  const fetchStorageStatus = async () => {
    setStorageLoading(true);
    try {
      const res = await fetch('/api/storage');
      const data = await res.json();
      if (data.ok) {
        setStorageData(data);
      }
    } catch (e) {
      console.error('Failed to load storage status:', e);
    } finally {
      setStorageLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setTgTestResult(null);
    setWebTestNotice(null);
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.settings) {
          const s = d.settings;
          setProxyUrl(s.proxyUrl || '');
          setUseProxy(s.useProxy !== false);
          setRangeKey(s.keys?.range || '');
          setLifiKey(s.keys?.lifi || '');
          setEtherscanKey(s.keys?.etherscan || '');

          if (s.scan) {
            setScanAutoEnabled(s.scan.autoEnabled !== false);
            setScanIntervalMin(String(s.scan.intervalMin ?? 5));
            setScanLookbackHours(String(s.scan.lookbackHours ?? 24));
          }

          if (s.notifications) {
            setWebEnabled(s.notifications.web?.enabled !== false);
            setWebSound(s.notifications.web?.sound !== false);
            setTgEnabled(!!s.notifications.telegram?.enabled);
            const token = s.notifications.telegram?.botToken || '';
            setTgBotToken(token);
            setTgChatId(s.notifications.telegram?.chatId || '');
            if (s.notifications.minSpreadPct !== undefined) {
              setMinSpreadPct(String(s.notifications.minSpreadPct));
            }
            if (token) {
              checkBotInfo(token);
            }
          }

          if (Array.isArray(s.stablecoins) && s.stablecoins.length > 0) {
            setSelectedStables(s.stablecoins);
          }
        }
      })
      .catch((err) => console.error('Error fetching settings:', err));
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && activeTab === 'storage') {
      fetchStorageStatus();
    }
  }, [isOpen, activeTab]);

  const handleSelectAllChannels = () => {
    setWebEnabled(true);
    setWebSound(true);
    setTgEnabled(true);
  };

  const handleDisableAllChannels = () => {
    setWebEnabled(false);
    setTgEnabled(false);
  };

  const handleTestWeb = async () => {
    setWebTestNotice(null);
    const perm = await requestNotificationPermission();
    if (webSound) {
      playOpportunitySound();
    }
    if (perm === 'granted') {
      sendDesktopNotification('【Bridge Arb Radar】网页通知测试', {
        body: '测试成功！系统已获取桌面通知权限，发现套利机会时将即时弹窗。',
      });
      setWebTestNotice('✅ 网页桌面通知与提示音测试成功！权限状态：已授权');
    } else if (perm === 'denied') {
      setWebTestNotice('⚠️ 桌面通知权限被浏览器阻止，请在地址栏左侧网站设置中允许通知');
    } else {
      setWebTestNotice('ℹ️ 桌面通知尚未授权，已播放测试提示音');
    }
    setTimeout(() => setWebTestNotice(null), 5000);
  };

  const handleDetectChatId = async () => {
    setDetectingChatId(true);
    setTgTestResult(null);
    try {
      const res = await fetch('/api/notifications/get-chat-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: tgBotToken.trim() }),
      });
      const data = await res.json();
      if (data.bot) setBotInfo(data.bot);

      if (data.ok && data.chatId) {
        setTgChatId(data.chatId);
        setTgTestResult({
          ok: true,
          message: `✅ 成功捕获您的 Chat ID: ${data.chatId} (${data.chatName || '个人会话'})！已自动填入下方。`,
        });
      } else {
        setTgTestResult({
          ok: false,
          message: data.error || '未能检测到消息。请确认已向机器人发送过 /start。',
        });
      }
    } catch (e: any) {
      setTgTestResult({ ok: false, message: `获取失败: ${e.message}` });
    } finally {
      setDetectingChatId(false);
    }
  };

  const handleTestTelegram = async () => {
    setTgTesting(true);
    setTgTestResult(null);
    try {
      const res = await fetch('/api/notifications/test-tg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: tgBotToken.trim(),
          chatId: tgChatId.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setTgTestResult({ ok: true, message: tr('setNotifTgTestSuccess') });
      } else {
        setTgTestResult({
          ok: false,
          message: `${tr('setNotifTgTestFail')}: ${data.error || '未知错误'}`,
        });
      }
    } catch (e: any) {
      setTgTestResult({ ok: false, message: `${tr('setNotifTgTestFail')}: ${e.message}` });
    } finally {
      setTgTesting(false);
    }
  };

  const handleDownloadBackup = async () => {
    setBackupLoading(true);
    setBackupNotice(null);
    try {
      const link = document.createElement('a');
      link.href = '/api/backup/download';
      link.setAttribute('download', '');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setBackupNotice(tr('setStorageBackupSuccess'));
      fetchStorageStatus();
      setTimeout(() => setBackupNotice(null), 4000);
    } catch (e: any) {
      setBackupNotice(`备份失败: ${e.message}`);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleExecuteReset = async () => {
    if (resetConfirmInput.trim() !== 'RESET' || !resetUnderstood) return;
    setResetting(true);
    setResetError(null);
    try {
      const res = await fetch('/api/database/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmPhrase: resetConfirmInput.trim(),
          keepSettings: resetKeepSettings,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setResetSuccess(data.message || tr('setResetSuccessTitle'));
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        setResetError(data.error || '重置失败，请核对安全确认输入');
        setResetting(false);
      }
    } catch (err: any) {
      setResetError(err.message || '重置请求发生异常');
      setResetting(false);
    }
  };

  const handleSave = async () => {
    try {
      const parsedSpread = parseFloat(minSpreadPct);
      const parsedInterval = parseInt(scanIntervalMin, 10);
      const parsedLookback = parseInt(scanLookbackHours, 10);

      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyUrl,
          useProxy,
          keys: {
            range: rangeKey,
            lifi: lifiKey,
            etherscan: etherscanKey,
          },
          scan: {
            autoEnabled: scanAutoEnabled,
            intervalMin: !isNaN(parsedInterval) && parsedInterval >= 1 ? parsedInterval : 5,
            lookbackHours: !isNaN(parsedLookback) && parsedLookback >= 1 ? parsedLookback : 24,
          },
          notifications: {
            web: {
              enabled: webEnabled,
              sound: webSound,
            },
            telegram: {
              enabled: tgEnabled,
              botToken: tgBotToken.trim(),
              chatId: tgChatId.trim(),
            },
            minSpreadPct: !isNaN(parsedSpread) && parsedSpread >= 0 ? parsedSpread : 1.0,
          },
          stablecoins: selectedStables,
        }),
      });
      setSaved(true);
      if (onSaveSuccess) {
        onSaveSuccess();
      }
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 1000);
    } catch (e) {
      console.error(e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="terminal-panel w-full max-w-4xl h-[680px] max-h-[92vh] rounded-xl overflow-hidden shadow-2xl flex flex-col">
        {/* 标题栏 */}
        <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-surface)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#f5c042]/10 border border-[#f5c042]/30 flex items-center justify-center text-[#f5c042]">
              <Sliders size={16} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[var(--text-primary)]">
                {tr('setModalTitle')}
              </h3>
              <p className="text-[11px] text-[var(--text-muted)]">
                套利机会推送、后台自动扫描频率、网络代理与稳定币白名单
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1.5 rounded-lg hover:bg-[var(--bg-surface-hover)] transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* 中间左右分栏主体 (Main Left-Right Body) */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* 左侧侧边栏导航 (Left Sidebar Navigation) */}
          <div className="w-full md:w-56 bg-[var(--bg-elevated)]/40 border-b md:border-b-0 md:border-r border-[var(--border-subtle)] flex flex-col p-3 gap-1 shrink-0 select-none overflow-y-auto">
            <button
              onClick={() => setActiveTab('notifications')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'notifications'
                  ? 'bg-[#f5c042]/15 text-[#f5c042] font-semibold border border-[#f5c042]/30 shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Bell size={15} className={activeTab === 'notifications' ? 'text-[#f5c042]' : 'text-[var(--text-muted)]'} />
                <span>{tr('setNotifTitle')}</span>
              </div>
              {notifEnabled && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-emerald-400/20" title="推送已启用" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('scan')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'scan'
                  ? 'bg-[#f5c042]/15 text-[#f5c042] font-semibold border border-[#f5c042]/30 shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Clock size={15} className={activeTab === 'scan' ? 'text-[#f5c042]' : 'text-[var(--text-muted)]'} />
                <span>{tr('setScanTabTitle')}</span>
              </div>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                scanAutoEnabled
                  ? 'bg-amber-500/15 text-[#f5c042] border-[#f5c042]/30'
                  : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border-[var(--border-subtle)]'
              }`}>
                {scanAutoEnabled ? `${scanIntervalMin || 5}m` : '已暂停'}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('proxy')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'proxy'
                  ? 'bg-[#f5c042]/15 text-[#f5c042] font-semibold border border-[#f5c042]/30 shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Globe size={15} className={activeTab === 'proxy' ? 'text-[#f5c042]' : 'text-[var(--text-muted)]'} />
                <span>网络代理与密钥</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('stablecoins')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'stablecoins'
                  ? 'bg-[#f5c042]/15 text-[#f5c042] font-semibold border border-[#f5c042]/30 shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Coins size={15} className={activeTab === 'stablecoins' ? 'text-[#f5c042]' : 'text-[var(--text-muted)]'} />
                <span>{tr('setStablecoinsTabTitle')}</span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                {selectedStables.length} 种
              </span>
            </button>

            <button
              onClick={() => setActiveTab('storage')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'storage'
                  ? 'bg-rose-500/15 text-rose-300 font-semibold border border-rose-500/30 shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Database size={15} className={activeTab === 'storage' ? 'text-rose-400' : 'text-[var(--text-muted)]'} />
                <span>{tr('setStorageTabTitle')}</span>
              </div>
            </button>

            {/* 侧边栏底部状态说明 */}
            <div className="mt-auto pt-3 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] px-1">
              <div className="flex items-center gap-1.5 text-[var(--text-secondary)] mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#f5c042]"></span>
                <span className="font-semibold">Arbitrage Engine v2</span>
              </div>
              <div className="truncate text-[10px]">SQLite Local DB</div>
            </div>
          </div>

          {/* 右侧内容区域 (Right Content Area) */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[var(--bg-base)]/30">
            {/* 当前栏目描述头部 */}
            <div className="px-5 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 flex items-center justify-between shrink-0">
              <div>
                <h4 className="text-xs font-bold text-[var(--text-primary)]">
                  {activeTab === 'notifications' && tr('setNotifTitle')}
                  {activeTab === 'scan' && tr('setScanTabTitle')}
                  {activeTab === 'proxy' && '网络代理与 API 密钥'}
                  {activeTab === 'stablecoins' && tr('setStablecoinsTabTitle')}
                  {activeTab === 'storage' && tr('setStorageTabTitle')}
                </h4>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {activeTab === 'notifications' && '配置 Telegram Bot 及套利机会实时推送信道'}
                  {activeTab === 'scan' && '设置全链套利轮询间隔与并发请求速率参数'}
                  {activeTab === 'proxy' && '配置 HTTP/SOCKS5 网络代理以及用于链上快速查询的专用密钥'}
                  {activeTab === 'stablecoins' && '挑选允许纳入套利计价与闭环计算的主流可靠稳定币白名单'}
                  {activeTab === 'storage' && '查看 SQLite 数据库存储用量统计及危险维护操作'}
                </p>
              </div>
            </div>

            {/* 表单内容滚动区 */}
            <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
              {activeTab === 'notifications' && (
            <div className="space-y-4">
              {/* 快捷通道操作栏 */}
              <div className="bg-[var(--bg-surface)] p-3 rounded-lg border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                    <Sliders size={13} className="text-[#f5c042]" />
                    <span>通道配置模式</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    支持单选、多选或全选，满足个人盯盘与团队群推送不同场景
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllChannels}
                    className="px-2.5 py-1 rounded bg-[#f5c042]/10 hover:bg-[#f5c042]/20 text-[#f5c042] border border-[#f5c042]/30 text-[11px] transition font-medium cursor-pointer"
                  >
                    {tr('setNotifAllChannels')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDisableAllChannels}
                    className="px-2.5 py-1 rounded bg-zinc-800/50 hover:bg-zinc-800 text-[var(--text-secondary)] border border-zinc-700 text-[11px] transition cursor-pointer"
                  >
                    {tr('setNotifCloseAll')}
                  </button>
                </div>
              </div>

              {/* 触发门槛设置 */}
              <div className="bg-[var(--bg-surface)] p-3 rounded-lg border border-[var(--border-subtle)] space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-[var(--text-primary)]">
                    {tr('setNotifMinSpread')}
                  </label>
                  <span className="text-[11px] text-[#f5c042] font-mono font-bold">
                    ≥ {minSpreadPct || '1.0'}%
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {tr('setNotifMinSpreadPh')}
                </p>
                <div className="pt-1">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={minSpreadPct}
                    onChange={(e) => setMinSpreadPct(e.target.value)}
                    placeholder="1.0"
                    className="w-full sm:w-48 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-3 py-1.5 font-mono text-[var(--text-primary)] focus:outline-none focus:border-[#f5c042]"
                  />
                </div>
              </div>

              {/* 通道 1: 浏览器网页通知 */}
              <div className={`p-3 rounded-lg border transition ${
                webEnabled
                  ? 'bg-[var(--bg-surface)] border-emerald-500/40'
                  : 'bg-[var(--bg-surface)]/50 border-[var(--border-subtle)]'
              }`}>
                <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={webEnabled}
                      onChange={(e) => setWebEnabled(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-500 focus:ring-0 cursor-pointer"
                    />
                    <span className="font-bold text-[var(--text-primary)] text-sm flex items-center gap-1.5">
                      <Bell size={14} className={webEnabled ? 'text-emerald-400' : 'text-zinc-500'} />
                      {tr('setNotifWebTitle')}
                    </span>
                  </label>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold ${
                    webEnabled ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {webEnabled ? '已开启' : '已停用'}
                  </span>
                </div>

                <div className="pt-2.5 space-y-2.5">
                  <label className="flex items-center gap-2 text-[var(--text-secondary)] cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!webEnabled}
                      checked={webSound}
                      onChange={(e) => setWebSound(e.target.checked)}
                      className="rounded text-emerald-500 cursor-pointer disabled:opacity-50"
                    />
                    <span className="flex items-center gap-1.5">
                      <Volume2 size={13} className="text-[#f5c042]" />
                      {tr('setNotifSoundEnable')}
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleTestWeb}
                      className="px-2.5 py-1.5 rounded bg-[var(--bg-base)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-[11px] flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Volume2 size={12} className="text-[#f5c042]" />
                      {tr('setNotifWebTest')}
                    </button>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      利用 HTML5 桌面通知 + 原生 Web Audio 纯净音效
                    </span>
                  </div>

                  {webTestNotice && (
                    <div className="text-[11px] p-2 rounded bg-zinc-900/80 border border-zinc-700 text-zinc-200 mt-1">
                      {webTestNotice}
                    </div>
                  )}
                </div>
              </div>

              {/* 通道 2: Telegram 机器人推送 */}
              <div className={`p-3 rounded-lg border transition ${
                tgEnabled
                  ? 'bg-[var(--bg-surface)] border-sky-500/40'
                  : 'bg-[var(--bg-surface)]/50 border-[var(--border-subtle)]'
              }`}>
                <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={tgEnabled}
                      onChange={(e) => setTgEnabled(e.target.checked)}
                      className="w-4 h-4 rounded text-sky-500 focus:ring-0 cursor-pointer"
                    />
                    <span className="font-bold text-[var(--text-primary)] text-sm flex items-center gap-1.5">
                      <Send size={14} className={tgEnabled ? 'text-sky-400' : 'text-zinc-500'} />
                      {tr('setNotifTgTitle')}
                    </span>
                  </label>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold ${
                    tgEnabled ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {tgEnabled ? '已开启' : '已停用'}
                  </span>
                </div>

                <div className="pt-3 space-y-3">
                  {/* 识别到的机器人状态卡片 */}
                  {botInfo && (
                    <div className="flex items-center justify-between p-2.5 rounded bg-sky-950/40 border border-sky-500/30 text-sky-200 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span>机器人已成功识别: <b>{botInfo.first_name || 'Bot'}</b> (@{botInfo.username})</span>
                      </div>
                      {botInfo.username && (
                        <a
                          href={`https://t.me/${botInfo.username}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-sky-400 hover:text-sky-300 underline font-medium"
                        >
                          <span>打开并 Start</span>
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[var(--text-secondary)] font-medium">
                        {tr('setNotifTgBotToken')}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">由 @BotFather 获取完整 Token</span>
                    </div>
                    <input
                      type="password"
                      value={tgBotToken}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTgBotToken(val);
                        if (val.includes(':')) checkBotInfo(val);
                      }}
                      placeholder="例如 8750497694:AAEUstjcXPve..."
                      className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-3 py-1.5 font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-sky-500"
                    />
                    <div className="text-[10px] text-[var(--text-muted)] mt-1">
                      ⚠️ 提示：Token 必须包含冒号前的数字 ID（如 <code>8750497694:AAEU...</code>），请勿只填冒号后半截。
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[var(--text-secondary)] font-medium">
                        {tr('setNotifTgChatId')}
                      </span>
                      <button
                        type="button"
                        onClick={handleDetectChatId}
                        disabled={detectingChatId || !tgBotToken.trim()}
                        className="text-[11px] text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        title="在 Telegram 中向机器人发送 /start 后点击此按钮自动获取"
                      >
                        <RefreshCw size={11} className={detectingChatId ? 'animate-spin' : ''} />
                        <span>{detectingChatId ? '正在检测...' : '⚡ 自动获取 Chat ID'}</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={tgChatId}
                      onChange={(e) => setTgChatId(e.target.value)}
                      placeholder="例如 123456789 (您的个人 Telegram 数字 ID)"
                      className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-3 py-1.5 font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-sky-500"
                    />
                    <div className="text-[10px] text-[var(--text-muted)] mt-1">
                      说明：Chat ID 是<b>您本人</b>的账户数字 ID，不能填机器人的数字 ID。先在 Telegram 向机器人发送 <code>/start</code>，然后点击上方「⚡ 自动获取 Chat ID」即可一键识别。
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      disabled={tgTesting || !tgBotToken.trim() || !tgChatId.trim()}
                      onClick={handleTestTelegram}
                      className="px-3 py-1.5 rounded bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 border border-sky-500/30 text-[11px] font-medium flex items-center gap-1.5 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Send size={12} />
                      <span>{tgTesting ? tr('setNotifTgTesting') : tr('setNotifTgTestBtn')}</span>
                    </button>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      注：国内环境请在「网络代理」页开启 HTTP 代理
                    </span>
                  </div>

                  {tgTestResult && (
                    <div className={`text-[11px] p-2.5 rounded border flex items-start gap-2 ${
                      tgTestResult.ok
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                        : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                    }`}>
                      {tgTestResult.ok ? (
                        <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle size={15} className="text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div>{tgTestResult.message}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'scan' && (
            <div className="space-y-4">
              {/* 自动扫描主开关 */}
              <div className="bg-[var(--bg-surface)] p-3 rounded-lg border border-[var(--border-subtle)] flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                    <Clock size={14} className="text-[#f5c042]" />
                    <span>{tr('setScanAutoEnable')}</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    开启后雷达引擎将在后台周期性全自动轮巡各大主流跨链桥流水
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scanAutoEnabled}
                    onChange={(e) => setScanAutoEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-amber-500 focus:ring-0 cursor-pointer"
                  />
                  <span className={`text-[11px] px-2 py-0.5 rounded font-mono font-semibold ${
                    scanAutoEnabled ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {scanAutoEnabled ? '运行中' : '已暂停'}
                  </span>
                </label>
              </div>

              {/* 扫描间隔设置 */}
              <div className={`p-3 rounded-lg border transition space-y-3 ${
                scanAutoEnabled ? 'bg-[var(--bg-surface)] border-[var(--border-subtle)]' : 'opacity-60 bg-[var(--bg-surface)]/50 border-[var(--border-subtle)]'
              }`}>
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-[var(--text-primary)]">
                    {tr('setScanIntervalTitle')}
                  </label>
                  <span className="text-[11px] text-[#f5c042] font-mono font-bold">
                    每 {scanIntervalMin || '5'} 分钟扫描一次
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {tr('setScanIntervalDesc')}
                </p>

                {/* 快捷预设按钮 */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    { val: '1', label: '1 分钟 (极速盯盘)' },
                    { val: '3', label: '3 分钟 (积极捕获)' },
                    { val: '5', label: '5 分钟 (默认推荐)' },
                    { val: '10', label: '10 分钟 (稳健)' },
                    { val: '15', label: '15 分钟 (轻载)' },
                    { val: '30', label: '30 分钟 (省流)' },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      disabled={!scanAutoEnabled}
                      onClick={() => setScanIntervalMin(preset.val)}
                      className={`px-2.5 py-1 rounded text-[11px] font-mono transition cursor-pointer ${
                        String(scanIntervalMin) === preset.val
                          ? 'bg-[#f5c042] text-black font-bold shadow-sm'
                          : 'bg-[var(--bg-base)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* 自定义分钟数输入 */}
                <div className="pt-2 flex items-center gap-2">
                  <span className="text-[11px] text-[var(--text-secondary)]">自定义分钟数:</span>
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    disabled={!scanAutoEnabled}
                    value={scanIntervalMin}
                    onChange={(e) => setScanIntervalMin(e.target.value)}
                    className="w-24 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-2.5 py-1 font-mono text-[var(--text-primary)] focus:outline-none focus:border-[#f5c042] text-xs"
                  />
                  <span className="text-[11px] text-[var(--text-muted)]">分钟 (范围 1 ~ 1440，保存后调度立即生效)</span>
                </div>
              </div>

              {/* 回溯时间窗口设置 */}
              <div className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-[var(--text-primary)]">
                    {tr('setScanLookbackTitle')}
                  </label>
                  <span className="text-[11px] text-[#f5c042] font-mono font-bold">
                    过去 {scanLookbackHours || '24'} 小时
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {tr('setScanLookbackDesc')}
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    { val: '6', label: '6 小时 (近段热点)' },
                    { val: '12', label: '12 小时 (半天)' },
                    { val: '24', label: '24 小时 (标准推荐)' },
                    { val: '48', label: '48 小时 (深度回溯)' },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => setScanLookbackHours(preset.val)}
                      className={`px-2.5 py-1 rounded text-[11px] font-mono transition cursor-pointer ${
                        String(scanLookbackHours) === preset.val
                          ? 'bg-[#f5c042] text-black font-bold shadow-sm'
                          : 'bg-[var(--bg-base)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'proxy' && (
            <div className="space-y-4">
              {/* 代理设置 */}
              <div className="space-y-2 bg-[var(--bg-surface)] p-3 rounded-lg border border-[var(--border-subtle)]">
                <label className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Globe size={14} className="text-[#f5c042]" />
                  {tr('setProxyTitle')}
                </label>
                <input
                  type="text"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  placeholder="http://127.0.0.1:10808"
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-3 py-2 font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
                />
                <label className="flex items-center gap-2 text-[var(--text-secondary)] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={useProxy}
                    onChange={(e) => setUseProxy(e.target.checked)}
                    className="rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
                  />
                  <span>{tr('setProxyEnable')} (Telegram 推送及 DEX 行情加速)</span>
                </label>
              </div>

              {/* API Keys */}
              <div className="space-y-3 bg-[var(--bg-surface)] p-3 rounded-lg border border-[var(--border-subtle)]">
                <label className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                  <Shield size={14} className="text-[#45c4b0]" />
                  {tr('setKeysTitle')}
                </label>

                <div>
                  <div className="text-[var(--text-secondary)] mb-1">{tr('setRangeLabel')}</div>
                  <input
                    type="password"
                    value={rangeKey}
                    onChange={(e) => setRangeKey(e.target.value)}
                    placeholder={tr('setRangePh')}
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-3 py-1.5 font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
                  />
                </div>

                <div>
                  <div className="text-[var(--text-secondary)] mb-1">{tr('setLifiLabel')}</div>
                  <input
                    type="password"
                    value={lifiKey}
                    onChange={(e) => setLifiKey(e.target.value)}
                    placeholder={tr('setLifiPh')}
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-3 py-1.5 font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
                  />
                </div>

                <div>
                  <div className="text-[var(--text-secondary)] mb-1">{tr('setEtherscanLabel')}</div>
                  <input
                    type="password"
                    value={etherscanKey}
                    onChange={(e) => setEtherscanKey(e.target.value)}
                    placeholder={tr('setEtherscanPh')}
                    className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-3 py-1.5 font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'stablecoins' && (
            <div className="space-y-4">
              {/* 顶部说明与准入准则 */}
              <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)]">
                    <Shield className="text-emerald-400" size={15} />
                    <span>主流合规稳定币白名单 (Tier-1 Standard)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleResetToDefaultStables}
                      className="px-2 py-0.5 rounded text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-base)] border border-[var(--border-subtle)] hover:border-[#f5c042] transition cursor-pointer"
                      title="重置为系统默认推荐的标准合规 Tier-1 稳定币"
                    >
                      恢复默认
                    </button>
                    <button
                      type="button"
                      onClick={handleSelectAllStables}
                      className="px-2 py-0.5 rounded text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 transition cursor-pointer"
                    >
                      全部启用
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                  {tr('setStablecoinsDesc')}
                </p>
                <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-1.5 pt-1.5 border-t border-[var(--border-subtle)]/60">
                  <span className="text-emerald-400 font-bold">✓ 准入基线:</span>
                  <span>100% 独立信托/美债隔离存管 · 顶级合规监管 (NYDFS/MAS/SFC) · 主流交易所 1:1 出金通道</span>
                </div>
              </div>

              {/* 预设 Tier-1 稳定币网格 */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-[var(--text-secondary)] flex items-center justify-between">
                  <span>官方预设 Tier-1 稳定币 ({PRESET_STABLECOINS.length})</span>
                  <span className="font-mono font-normal text-[10px] text-[var(--text-muted)]">
                    已勾选 {selectedStables.filter((s) => PRESET_STABLECOINS.some((p) => p.symbol === s)).length} / {PRESET_STABLECOINS.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PRESET_STABLECOINS.map((st) => {
                    const isChecked = selectedStables.includes(st.symbol);
                    return (
                      <div
                        key={st.symbol}
                        onClick={() => toggleStable(st.symbol)}
                        className={`p-2.5 rounded-lg border transition cursor-pointer flex flex-col justify-between select-none ${
                          isChecked
                            ? 'bg-[var(--bg-elevated)] border-emerald-500/50 shadow-sm'
                            : 'bg-[var(--bg-base)]/60 border-[var(--border-subtle)] opacity-60 hover:opacity-100'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1 mb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono font-bold text-sm text-[var(--text-primary)]">
                              {st.symbol}
                            </span>
                            <span className="text-[10px] text-[var(--text-muted)] truncate">
                              {st.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono border ${st.badgeColor}`}>
                              {st.badge}
                            </span>
                            {isChecked ? (
                              <CheckSquare size={14} className="text-emerald-400 shrink-0" />
                            ) : (
                              <Square size={14} className="text-[var(--text-muted)] shrink-0" />
                            )}
                          </div>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] leading-tight mb-1">
                          {st.desc}
                        </div>
                        <div className="text-[9px] text-[var(--text-muted)] font-mono">
                          发行/管理: <span className="text-[var(--text-secondary)]">{st.issuer}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 用户自定义扩展稳定币 */}
              <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
                    <Plus size={13} className="text-[#f5c042]" />
                    <span>自定义添加稳定币 / 自主扩展</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)]">支持任意代币符号，如 USDE、EURC 等</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customStableInput}
                    onChange={(e) => setCustomStableInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCustomStable();
                      }
                    }}
                    placeholder="输入代币符号 (如 USDE, GHO, EURC)"
                    className="flex-1 bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)] uppercase font-mono placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomStable}
                    className="px-3 py-1.5 rounded-md bg-[#f5c042] text-black font-bold text-xs hover:bg-[#e5b032] transition cursor-pointer flex items-center gap-1 shrink-0"
                  >
                    <Plus size={12} />
                    <span>添加</span>
                  </button>
                </div>

                {/* 活跃的自定义币种列表 */}
                {selectedStables.filter((s) => !PRESET_STABLECOINS.some((p) => p.symbol === s)).length > 0 && (
                  <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
                    <div className="text-[10px] text-[var(--text-secondary)] font-medium">当前已添加的自定义币种:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedStables
                        .filter((s) => !PRESET_STABLECOINS.some((p) => p.symbol === s))
                        .map((sym) => (
                          <span
                            key={sym}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-[#f5c042]/10 text-[#f5c042] border border-[#f5c042]/30"
                          >
                            <span>{sym}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveCustomStable(sym)}
                              className="text-[var(--text-muted)] hover:text-rose-400 cursor-pointer ml-0.5"
                              title="移除此币种"
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'storage' && (
            <div className="space-y-4">
              {/* SQLite 数据库状态卡片 */}
              <div className="bg-[var(--bg-surface)] p-3.5 rounded-lg border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
                  <div className="flex items-center gap-2">
                    <Database size={15} className="text-[#45c4b0]" />
                    <span className="font-bold text-[var(--text-primary)] text-sm">
                      {tr('setStorageStatsTitle')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={fetchStorageStatus}
                    disabled={storageLoading}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--bg-base)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
                  >
                    <RefreshCw size={11} className={storageLoading ? 'animate-spin text-[#f5c042]' : ''} />
                    <span>刷新</span>
                  </button>
                </div>

                {storageLoading && !storageData ? (
                  <div className="py-8 flex items-center justify-center gap-2 text-[var(--text-muted)] text-xs">
                    <Loader2 size={16} className="animate-spin text-[#f5c042]" />
                    <span>正在读取数据库元数据...</span>
                  </div>
                ) : (
                  <>
                    {/* 状态统计网格 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="p-2.5 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)]">
                        <div className="text-[10px] text-[var(--text-muted)]">{tr('setStorageSize')}</div>
                        <div className="text-sm font-mono font-bold text-[var(--text-primary)] mt-0.5">
                          {storageData?.mainSizeBytes ? `${(storageData.mainSizeBytes / 1024 / 1024).toFixed(2)} MB` : '-'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)]">
                        <div className="text-[10px] text-[var(--text-muted)]">{tr('setStorageWalSize')}</div>
                        <div className="text-sm font-mono font-bold text-[var(--text-primary)] mt-0.5">
                          {storageData?.walSizeBytes ? `${(storageData.walSizeBytes / 1024).toFixed(1)} KB` : '0 KB'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)]">
                        <div className="text-[10px] text-[var(--text-muted)]">{tr('setStorageIntegrity')}</div>
                        <div className="text-sm font-mono font-bold text-emerald-400 mt-0.5 flex items-center gap-1">
                          <CheckCircle2 size={13} />
                          <span>{storageData?.integrity === 'ok' ? 'PRAGMA OK' : storageData?.integrity || 'OK'}</span>
                        </div>
                      </div>
                      <div className="p-2.5 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)]">
                        <div className="text-[10px] text-[var(--text-muted)]">{tr('setStorageBackups')}</div>
                        <div className="text-sm font-mono font-bold text-[#f5c042] mt-0.5">
                          {storageData?.backupCount ?? 0} 份
                        </div>
                      </div>
                    </div>

                    {/* 业务数据表行数清单 */}
                    <div className="p-3 rounded bg-[var(--bg-base)] border border-[var(--border-subtle)] space-y-1.5 text-[11px]">
                      <div className="text-[var(--text-muted)] font-medium mb-1 flex items-center justify-between">
                        <span>业务数据规模分布：</span>
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">SQLite WAL Engine</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
                        <div className="text-[var(--text-secondary)] bg-[var(--bg-surface)] p-2 rounded border border-[var(--border-subtle)]">
                          <span className="text-[var(--text-muted)] block text-[10px]">{tr('setStorageTransfers')}</span>
                          <span className="font-bold text-[var(--text-primary)] text-xs">{storageData?.rowCount?.transfers?.toLocaleString() ?? '-'} 笔</span>
                        </div>
                        <div className="text-[var(--text-secondary)] bg-[var(--bg-surface)] p-2 rounded border border-[var(--border-subtle)]">
                          <span className="text-[var(--text-muted)] block text-[10px]">{tr('setStorageWallets')}</span>
                          <span className="font-bold text-[var(--text-primary)] text-xs">{storageData?.rowCount?.wallets?.toLocaleString() ?? '-'} 个</span>
                        </div>
                        <div className="text-[var(--text-secondary)] bg-[var(--bg-surface)] p-2 rounded border border-[var(--border-subtle)]">
                          <span className="text-[var(--text-muted)] block text-[10px]">{tr('setStorageTokens')}</span>
                          <span className="font-bold text-[var(--text-primary)] text-xs">{storageData?.rowCount?.tokens?.toLocaleString() ?? '-'} 个</span>
                        </div>
                        <div className="text-[var(--text-secondary)] bg-[var(--bg-surface)] p-2 rounded border border-[var(--border-subtle)]">
                          <span className="text-[var(--text-muted)] block text-[10px]">{tr('setStorageOpps')}</span>
                          <span className="font-bold text-[var(--text-primary)] text-xs">{storageData?.rowCount?.opportunities?.toLocaleString() ?? '-'} 条</span>
                        </div>
                      </div>
                    </div>

                    {/* 手动备份下载按钮 */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleDownloadBackup}
                        disabled={backupLoading}
                        className="px-3 py-1.5 rounded bg-[var(--bg-base)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs flex items-center gap-1.5 transition cursor-pointer font-medium"
                      >
                        {backupLoading ? <Loader2 size={13} className="animate-spin text-[#f5c042]" /> : <Download size={13} className="text-[#45c4b0]" />}
                        <span>{backupLoading ? tr('setStorageBackingUp') : tr('setStorageBackupBtn')}</span>
                      </button>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        SQLite 在线热备份 (VACUUM INTO)，不阻塞任何写入
                      </span>
                    </div>

                    {backupNotice && (
                      <div className="text-[11px] p-2.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center gap-2">
                        <CheckCircle2 size={14} className="shrink-0" />
                        <span>{backupNotice}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 危险操作区 (Danger Zone) */}
              <div className="p-3.5 rounded-lg border border-rose-500/30 bg-rose-950/10 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} className="text-rose-400" />
                    <span className="font-bold text-rose-400 text-sm">
                      {tr('setDangerZoneTitle')}
                    </span>
                  </div>
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold">
                    Destructive Action
                  </span>
                </div>

                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                  {tr('setDangerZoneDesc')}
                </p>

                <div className="p-2.5 rounded bg-[var(--bg-base)]/80 border border-rose-500/20 text-[11px] space-y-1 text-[var(--text-secondary)]">
                  <div className="font-semibold text-rose-300 flex items-center gap-1">
                    <Shield size={12} />
                    <span>多道防护与安全机制：</span>
                  </div>
                  <div>• 重置执行前，系统自动在本地生成一份带时间戳的完整备份文件 (.db)</div>
                  <div>• 支持勾选保留您的 API 密钥、网络代理与自动轮巡调度，免去重复配置</div>
                  <div>• 必须通过严格的确认弹窗、知情协议勾选与手动输入 <code className="text-rose-400 font-mono font-bold">RESET</code> 方可解锁执行</div>
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setResetConfirmInput('');
                      setResetUnderstood(false);
                      setResetError(null);
                      setResetSuccess(null);
                      setShowResetModal(true);
                    }}
                    className="px-3.5 py-2 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-xs font-semibold flex items-center gap-2 transition cursor-pointer shadow-sm hover:shadow"
                  >
                    <Trash2 size={13} className="text-rose-400" />
                    <span>{tr('setResetDbBtn')}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
          </div>
        </div>

        {/* 底部保存条 */}
        <div className="px-5 py-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-[var(--text-muted)]">
            配置持久化保存至本地 SQLite 数据库
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition text-xs cursor-pointer"
            >
              {tr('setCancel')}
            </button>
            <button
              onClick={handleSave}
              className="impeccable-btn-primary flex items-center gap-1.5 px-5 py-1.5 text-xs tracking-tight cursor-pointer"
            >
              {saved ? <Check size={14} /> : <Save size={14} />}
              <span>{saved ? tr('setSaved') : tr('setSave')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 重置数据库多道确认弹窗 (Triple Confirmation Dialog) */}
      {showResetModal && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl overflow-hidden shadow-2xl border border-rose-500/50 bg-[var(--bg-elevated)] flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
            {/* 弹窗头部 */}
            <div className="p-4 border-b border-rose-500/30 bg-rose-950/30 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                  <AlertTriangle size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-rose-300">
                    {tr('setResetModalTitle')}
                  </h3>
                  <p className="text-[11px] text-rose-400/80">
                    高危操作 · 请认真核对受影响的数据范围
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!resetting) setShowResetModal(false);
                }}
                disabled={resetting}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 transition cursor-pointer disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="p-4 space-y-3.5 text-xs overflow-y-auto flex-1">
              {/* 第一重确认：影响数据清单 */}
              <div className="space-y-1.5">
                <div className="font-semibold text-rose-300">
                  {tr('setResetModalWarning1')}
                </div>
                <div className="bg-[var(--bg-base)] p-3 rounded-lg border border-rose-500/20 space-y-1.5 text-[11px]">
                  <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <span className="text-rose-400 font-bold">•</span>
                    <span>{tr('setResetItemTransfers')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <span className="text-rose-400 font-bold">•</span>
                    <span>{tr('setResetItemWallets')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <span className="text-rose-400 font-bold">•</span>
                    <span>{tr('setResetItemTokens')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <span className="text-rose-400 font-bold">•</span>
                    <span>{tr('setResetItemOpps')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <span className="text-rose-400 font-bold">•</span>
                    <span>{tr('setResetItemDecisions')}</span>
                  </div>
                </div>
              </div>

              {/* 自动快照机制提示 */}
              <div className="p-2.5 rounded bg-sky-950/20 border border-sky-500/30 text-[11px] text-sky-300 flex items-start gap-2">
                <Shield size={14} className="text-sky-400 shrink-0 mt-0.5" />
                <span>{tr('setResetAutoBackupNotice')}</span>
              </div>

              {/* 第二重确认：保留配置开关 */}
              <div className="p-3 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] space-y-1">
                <label className="flex items-center gap-2 cursor-pointer select-none font-medium text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={resetKeepSettings}
                    onChange={(e) => setResetKeepSettings(e.target.checked)}
                    disabled={resetting}
                    className="w-4 h-4 rounded text-[#f5c042] focus:ring-0 cursor-pointer"
                  />
                  <span>{tr('setResetKeepSettingsLabel')}</span>
                </label>
                <p className="text-[11px] text-[var(--text-muted)] pl-6">
                  {tr('setResetKeepSettingsDesc')}
                </p>
              </div>

              {/* 第三重确认：风险认知勾选 */}
              <div className="p-3 rounded-lg bg-rose-950/15 border border-rose-500/25">
                <label className="flex items-start gap-2 cursor-pointer select-none text-[var(--text-primary)] text-[11px] font-medium leading-tight">
                  <input
                    type="checkbox"
                    checked={resetUnderstood}
                    onChange={(e) => setResetUnderstood(e.target.checked)}
                    disabled={resetting}
                    className="w-4 h-4 rounded text-rose-500 focus:ring-0 cursor-pointer mt-0.5 shrink-0"
                  />
                  <span className="text-rose-300">{tr('setResetUnderstandCheck')}</span>
                </label>
              </div>

              {/* 第四重确认：强制文本校验 */}
              <div className="space-y-1.5 bg-[var(--bg-base)] p-3 rounded-lg border border-[var(--border-subtle)]">
                <label className="font-medium text-[var(--text-primary)] text-[11px] flex items-center justify-between">
                  <span>{tr('setResetConfirmPrompt')}</span>
                  <span className="font-mono font-bold text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/30">
                    RESET
                  </span>
                </label>
                <input
                  type="text"
                  value={resetConfirmInput}
                  onChange={(e) => setResetConfirmInput(e.target.value)}
                  disabled={resetting}
                  placeholder={tr('setResetConfirmInputPh')}
                  className="w-full bg-[var(--bg-surface)] border border-rose-500/40 rounded px-3 py-2 font-mono text-sm uppercase text-rose-200 placeholder-[var(--text-muted)] focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
                />
              </div>

              {/* 异常与成功反馈 */}
              {resetError && (
                <div className="p-2.5 rounded bg-rose-500/15 border border-rose-500/40 text-rose-300 text-[11px] flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{resetError}</span>
                </div>
              )}
              {resetSuccess && (
                <div className="p-2.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] flex items-center gap-2">
                  <CheckCircle2 size={14} className="shrink-0" />
                  <span>{tr('setResetSuccessDesc')}</span>
                </div>
              )}
            </div>

            {/* 弹窗底部操作按钮 */}
            <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  if (!resetting) setShowResetModal(false);
                }}
                disabled={resetting}
                className="px-3.5 py-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs transition cursor-pointer disabled:opacity-50"
              >
                {tr('setResetCancelBtn')}
              </button>

              <button
                type="button"
                onClick={handleExecuteReset}
                disabled={resetConfirmInput.trim() !== 'RESET' || !resetUnderstood || resetting}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded transition shadow-sm cursor-pointer ${
                  resetConfirmInput.trim() === 'RESET' && resetUnderstood && !resetting
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/40'
                    : 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed opacity-60'
                }`}
              >
                {resetting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>{tr('setResettingBtn')}</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>{tr('setResetExecuteBtn')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
