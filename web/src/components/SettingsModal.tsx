import React, { useEffect, useState } from 'react';
import { X, Globe, Shield, Save, Check, Bell, Send, Volume2, AlertCircle, CheckCircle2, Sliders } from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { playOpportunitySound, requestNotificationPermission, sendDesktopNotification } from '../utils/notification';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t: tr } = useI18n();
  const [activeTab, setActiveTab] = useState<'notifications' | 'proxy'>('notifications');

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

  // Interactive feedback
  const [tgTesting, setTgTesting] = useState(false);
  const [tgTestResult, setTgTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [webTestNotice, setWebTestNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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

          if (s.notifications) {
            setWebEnabled(s.notifications.web?.enabled !== false);
            setWebSound(s.notifications.web?.sound !== false);
            setTgEnabled(!!s.notifications.telegram?.enabled);
            setTgBotToken(s.notifications.telegram?.botToken || '');
            setTgChatId(s.notifications.telegram?.chatId || '');
            if (s.notifications.minSpreadPct !== undefined) {
              setMinSpreadPct(String(s.notifications.minSpreadPct));
            }
          }
        }
      })
      .catch((err) => console.error('Error fetching settings:', err));
  }, [isOpen]);

  if (!isOpen) return null;

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

  const handleSave = async () => {
    try {
      const parsedSpread = parseFloat(minSpreadPct);
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
        }),
      });
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 1000);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="terminal-panel w-full max-w-xl rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* 标题栏 */}
        <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-[#f5c042]/10 border border-[#f5c042]/30 flex items-center justify-center text-[#f5c042]">
              <Bell size={15} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[var(--text-primary)]">
                {tr('setModalTitle')}
              </h3>
              <p className="text-[11px] text-[var(--text-muted)]">
                支持网页弹窗、提示音及 Telegram 机器人任意多通道推送
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab 导航切换 */}
        <div className="flex border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 px-4 pt-2 gap-2 text-xs">
          <button
            onClick={() => setActiveTab('notifications')}
            className={`pb-2 px-3 flex items-center gap-1.5 font-medium border-b-2 transition cursor-pointer ${
              activeTab === 'notifications'
                ? 'border-[#f5c042] text-[#f5c042]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Bell size={14} />
            <span>{tr('setNotifTitle')}</span>
            {(webEnabled || tgEnabled) && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse ml-0.5" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('proxy')}
            className={`pb-2 px-3 flex items-center gap-1.5 font-medium border-b-2 transition cursor-pointer ${
              activeTab === 'proxy'
                ? 'border-[#f5c042] text-[#f5c042]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Globe size={14} />
            <span>网络代理与 API 密钥</span>
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-4 space-y-4 text-xs overflow-y-auto flex-1">
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
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[var(--text-secondary)] font-medium">
                        {tr('setNotifTgBotToken')}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">由 @BotFather 获取</span>
                    </div>
                    <input
                      type="password"
                      value={tgBotToken}
                      onChange={(e) => setTgBotToken(e.target.value)}
                      placeholder={tr('setNotifTgBotTokenPh')}
                      className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-3 py-1.5 font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[var(--text-secondary)] font-medium">
                        {tr('setNotifTgChatId')}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">由 @userinfobot 获取个人或群组 ID</span>
                    </div>
                    <input
                      type="text"
                      value={tgChatId}
                      onChange={(e) => setTgChatId(e.target.value)}
                      placeholder={tr('setNotifTgChatIdPh')}
                      className="w-full bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded px-3 py-1.5 font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-sky-500"
                    />
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
        </div>

        {/* 底部保存条 */}
        <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 flex items-center justify-between">
          <div className="text-[11px] text-[var(--text-muted)]">
            配置持久化保存至本地系统
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs cursor-pointer"
            >
              {tr('setCancel')}
            </button>
            <button
              onClick={handleSave}
              className="impeccable-btn-primary flex items-center gap-1.5 px-4 py-1.5 text-xs tracking-tight cursor-pointer"
            >
              {saved ? <Check size={14} /> : <Save size={14} />}
              <span>{saved ? tr('setSaved') : tr('setSave')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
