import React from 'react';
import { WalletItem } from '../types';
import { short, usd, ago } from '../utils/format';
import { X, ExternalLink, Award, RefreshCw, Copy, Check } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

interface Props {
  wallet: WalletItem | null;
  onClose: () => void;
}

export const WalletDrawer: React.FC<Props> = ({ wallet, onClose }) => {
  const { t: tr } = useI18n();
  const [copied, setCopied] = React.useState(false);

  if (!wallet) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-slate-900 border-l border-slate-800 shadow-2xl z-50 flex flex-col">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
            wallet.grade === 'A' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
            wallet.grade === 'B' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
            'bg-slate-700/20 text-slate-400 border border-slate-700/30'
          }`}>
            {wallet.grade} {tr('dwGrade')}
          </span>
          <span className="font-mono text-sm text-slate-200">{short(wallet.address, 8)}</span>
          <button
            onClick={handleCopy}
            className="text-slate-500 hover:text-slate-300 transition"
            title={tr('dwCopyBtn')}
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          </button>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800/60">
            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
              <Award size={13} /> {tr('dwScoreTitle')}
            </div>
            <div className="font-mono-num text-xl font-bold text-slate-100">{wallet.score}</div>
          </div>
          <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800/60">
            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
              <RefreshCw size={13} /> {tr('dwCyclesTitle')}
            </div>
            <div className="font-mono-num text-xl font-bold text-emerald-400">{wallet.capitalCycles} {tr('dwTimesUnit')}</div>
          </div>
        </div>

        <div className="bg-slate-950/40 p-3.5 rounded-lg border border-slate-800/60 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500">{tr('dwBridgeTimes')}</span>
            <span className="font-mono-num text-slate-200">{wallet.bridgeCount} {tr('dwTimesUnit')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">{tr('dwMaxUsd')}</span>
            <span className="font-mono-num text-slate-200">{usd(wallet.maxUsd)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">{tr('dwLastSeen')}</span>
            <span className="text-slate-200">{ago(wallet.lastSeen)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">{tr('dwRoundtrips')}</span>
            <span className="font-mono-num text-slate-200">{wallet.roundtrips} {tr('dwTimesUnit')}</span>
          </div>
        </div>

        {wallet.autoTags && wallet.autoTags.length > 0 && (
          <div>
            <div className="text-xs text-slate-500 font-medium mb-2">{tr('dwBehaviors')}</div>
            <div className="flex flex-wrap gap-1.5">
              {wallet.autoTags.map((tag, i) => (
                <span key={i} className="px-2 py-0.5 rounded text-xs bg-slate-800/80 text-slate-300 border border-slate-700/50">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2">
          <a
            href={`https://debank.com/profile/${wallet.address}`}
            target="_blank"
            rel="noreferrer"
            className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 transition text-xs font-semibold"
          >
            <ExternalLink size={14} />
            {tr('dwDebankBtn')}
          </a>
        </div>
      </div>
    </div>
  );
};
