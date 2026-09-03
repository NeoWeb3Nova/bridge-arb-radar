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
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
            <Key size={16} className="text-blue-500 dark:text-blue-400" />
            {tr('setModalTitle')}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs">
          {/* 代理设置 */}
          <div className="space-y-2">
            <label className="font-bold text-slate-200 flex items-center gap-1.5">
              <Globe size={14} className="text-blue-500 dark:text-blue-400" />
              {tr('setProxyTitle')}
            </label>
            <input
              type="text"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="http://127.0.0.1:10808"
              className="w-full bg-slate-950 dark:bg-slate-950 border border-slate-800 rounded px-3 py-2 font-mono text-slate-200 focus:outline-none focus:border-blue-500"
            />
            <label className="flex items-center gap-2 text-slate-400 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={useProxy}
                onChange={(e) => setUseProxy(e.target.checked)}
                className="rounded bg-slate-900 border-slate-800"
              />
              <span>{tr('setProxyEnable')}</span>
            </label>
          </div>

          {/* API Keys */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <label className="font-bold text-slate-200 flex items-center gap-1.5">
              <Shield size={14} className="text-emerald-500 dark:text-emerald-400" />
              {tr('setKeysTitle')}
            </label>

            <div>
              <div className="text-slate-400 mb-1">{tr('setRangeLabel')}</div>
              <input
                type="password"
                value={rangeKey}
                onChange={(e) => setRangeKey(e.target.value)}
                placeholder={tr('setRangePh')}
                className="w-full bg-slate-950 dark:bg-slate-950 border border-slate-800 rounded px-3 py-1.5 font-mono text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <div className="text-slate-400 mb-1">{tr('setEtherscanLabel')}</div>
              <input
                type="password"
                value={etherscanKey}
                onChange={(e) => setEtherscanKey(e.target.value)}
                placeholder={tr('setEtherscanPh')}
                className="w-full bg-slate-950 dark:bg-slate-950 border border-slate-800 rounded px-3 py-1.5 font-mono text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-slate-400 hover:text-slate-200 text-xs cursor-pointer"
          >
            {tr('setCancel')}
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer"
          >
            {saved ? <Check size={14} /> : <Save size={14} />}
            <span>{saved ? tr('setSaved') : tr('setSave')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
