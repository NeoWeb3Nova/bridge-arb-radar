import React, { useState, useEffect } from 'react';
import { OpportunityItem } from '../types';
import { usd } from '../utils/format';
import { X, Save, Plus, ArrowRight, History } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

interface Props {
  item: OpportunityItem | null;
  onClose: () => void;
  onSaved: () => void;
}

export const DecisionModal: React.FC<Props> = ({ item, onClose, onSaved }) => {
  const { t: tr } = useI18n();
  const [status, setStatus] = useState<string>('todo');
  const [logText, setLogText] = useState('');
  const [pnlDelta, setPnlDelta] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // 每次打开弹窗或切换标的时，清空输入框，准备记录全新一笔操作
  useEffect(() => {
    if (item) {
      setStatus(item.decision?.status || 'todo');
      setLogText('');
      setPnlDelta('');
    }
  }, [item]);

  if (!item) return null;

  const currentPnl = item.decision?.realizedPnlUsd || 0;
  const journal = item.decision?.journal || [];

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logText.trim() && pnlDelta === '' && status === (item.decision?.status || 'todo')) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      if (logText.trim() || pnlDelta !== '') {
        await fetch('/api/decisions/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: item.symbol,
            buyChain: item.buyChain,
            sellChain: item.sellChain,
            text: logText.trim() || '更新状态',
            status,
            pnlDeltaUsd: pnlDelta !== '' ? Number(pnlDelta) : undefined,
          }),
        });
      } else {
        await fetch('/api/decisions/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: item.symbol,
            buyChain: item.buyChain,
            sellChain: item.sellChain,
            status,
          }),
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="terminal-panel w-full max-w-lg rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* 头部 */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
              <span>{item.symbol} 套利执行追踪</span>
              <span className="font-mono-num text-xs text-emerald-400 font-extrabold">+{item.spreadPct.toFixed(2)}%</span>
            </h3>
            <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span>{item.buyChainName} ({usd(item.buyPrice)})</span>
              <ArrowRight size={12} className="text-slate-500" />
              <span>{item.sellChainName} ({usd(item.sellPrice)})</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1">
            <X size={18} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs">
          {/* 状态与盈亏概览 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-950/60 p-3 rounded border border-slate-800">
              <div className="text-[11px] text-slate-400 mb-1">执行状态</div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100 font-medium focus:outline-none focus:border-blue-500"
              >
                <option value="todo">待定 (Todo)</option>
                <option value="watching">👀 观察中 (Watching)</option>
                <option value="executed">⚡ 已执行 (Executed)</option>
                <option value="closed">💰 已结算 (Closed)</option>
                <option value="dropped">🛑 放弃 (Dropped)</option>
              </select>
            </div>

            <div className="bg-slate-950/60 p-3 rounded border border-slate-800">
              <div className="text-[11px] text-slate-400 mb-1">该单已实现盈亏 (Realized)</div>
              <div className={`font-mono-num text-lg font-bold ${currentPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {currentPnl >= 0 ? '+' : ''}{usd(currentPnl)}
              </div>
            </div>
          </div>

          {/* 追加行动与盈亏 */}
          <form onSubmit={handleSave} className="space-y-3 bg-slate-950/40 p-3.5 rounded border border-slate-800">
            <div className="font-bold text-slate-200 flex items-center gap-1.5 text-xs">
              <Plus size={14} className="text-blue-400" />
              追加操盘笔记 / 本次盈亏结算
            </div>

            <div>
              <textarea
                value={logText}
                onChange={(e) => setLogText(e.target.value)}
                placeholder="记录操作过程：例如「在 BSC 买入 500 USDT、已成功跨链至以太坊、在 Uniswap 出货成交...」"
                rows={3}
                className="w-full bg-slate-900 border border-slate-700/80 rounded p-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">本次产生盈亏变化 Δ USD (正数记赚，负数记亏，如 45 或 -8.5)：</label>
              <input
                type="number"
                step="0.01"
                value={pnlDelta}
                onChange={(e) => setPnlDelta(e.target.value)}
                placeholder="+50.00 或 -12.50"
                className="w-full bg-slate-900 border border-slate-700/80 rounded px-3 py-1.5 font-mono text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </form>

          {/* 历史操盘日志流 */}
          {journal.length > 0 && (
            <div className="space-y-2">
              <div className="text-slate-400 font-bold flex items-center gap-1.5">
                <History size={13} className="text-slate-500" />
                历史操作与复盘记录 ({journal.length})
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {journal.map((j, i) => (
                  <div key={i} className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80 text-[11px] space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span className="font-mono">{new Date(j.ts).toLocaleString()}</span>
                      {j.pnlDeltaUsd != null && (
                        <span className={`font-mono-num font-bold ${j.pnlDeltaUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {j.pnlDeltaUsd >= 0 ? '+' : ''}{usd(j.pnlDeltaUsd)}
                        </span>
                      )}
                    </div>
                    <div className="text-slate-200">{j.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部保存按钮 */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded text-slate-400 hover:text-slate-200 text-xs"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition disabled:opacity-50 cursor-pointer"
          >
            <Save size={13} />
            <span>{saving ? '保存中...' : '提交记录'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
