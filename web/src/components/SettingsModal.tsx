import React, { useEffect, useState } from 'react';
import { X, Key, Globe, Shield, Save, Check } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t: tr } = useI18n();
  const [proxyUrl, setProxyUrl] = useState('');
  const [useProxy, setUseProxy] = useState(true);
  const [rangeKey, setRangeKey] = useState('');
  const [lifiKey, setLifiKey] = useState('');
  const [etherscanKey, setEtherscanKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.settings) {
          setProxyUrl(d.settings.proxyUrl || '');
          setUseProxy(d.settings.useProxy !== false);
          setRangeKey(d.settings.keys?.range || '');
          setLifiKey(d.settings.keys?.lifi || '');
          setEtherscanKey(d.settings.keys?.etherscan || '');
        }
      });
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
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
      <div className="terminal-panel w-full max-w-lg rounded-xl overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h3 className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
            <Key size={16} className="text-[#f5c042]" />
            {tr('setModalTitle')}
          </h3>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 transition cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs">
          {/* 代理设置 */}
          <div className="space-y-2">
            <label className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
              <Globe size={14} className="text-[#f5c042]" />
              {tr('setProxyTitle')}
            </label>
            <input
              type="text"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="http://127.0.0.1:10808"
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-2 font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
            />
            <label className="flex items-center gap-2 text-[var(--text-secondary)] cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={useProxy}
                onChange={(e) => setUseProxy(e.target.checked)}
                className="rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)]"
              />
              <span>{tr('setProxyEnable')}</span>
            </label>
          </div>

          {/* API Keys */}
          <div className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
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
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-1.5 font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
              />
            </div>

            <div>
              <div className="text-[var(--text-secondary)] mb-1">{tr('setLifiLabel')}</div>
              <input
                type="password"
                value={lifiKey}
                onChange={(e) => setLifiKey(e.target.value)}
                placeholder={tr('setLifiPh')}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-1.5 font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
              />
            </div>

            <div>
              <div className="text-[var(--text-secondary)] mb-1">{tr('setEtherscanLabel')}</div>
              <input
                type="password"
                value={etherscanKey}
                onChange={(e) => setEtherscanKey(e.target.value)}
                placeholder={tr('setEtherscanPh')}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-3 py-1.5 font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[#f5c042]"
              />
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 flex items-center justify-end gap-2">
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
  );
};
