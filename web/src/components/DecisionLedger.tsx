import React, { useEffect, useState } from 'react';
import { OpportunityItem } from '../types';
import { VerdictBadge } from './VerdictBadge';
import { usd } from '../utils/format';
import { 
  ArrowRight, Trash2, DollarSign, FileText, 
  ChevronDown, ChevronRight, History, Calendar
} from 'lucide-react';
import { useI18n } from '../context/I18nContext';
import { DecisionModal } from './DecisionModal';

export const DecisionLedger: React.FC = () => {
  const { t: tr } = useI18n();
  const [items, setItems] = useState<OpportunityItem[]>([]);
  const [pnl, setPnl] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState<OpportunityItem | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const loadDecisions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/decisions?status=${statusFilter}`);
      const data = await res.json();
      if (data.ok) {
        setItems(data.items || []);
        setPnl(data.realizedPnlUsd || 0);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDecisions();
  }, [statusFilter]);

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateStatus = async (item: OpportunityItem, status: string) => {
    try {
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
      loadDecisions();
    } catch (e) {
      console.error(e);
    }
  };

  const clearDecision = async (item: OpportunityItem) => {
    if (!confirm(`确定清空 ${item.symbol} 的操盘记录吗？`)) return;
    try {
      await fetch('/api/decisions/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: item.symbol,
          buyChain: item.buyChain,
          sellChain: item.sellChain,
        }),
      });
      loadDecisions();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部决策盈亏看板 */}
      <div className="terminal-panel p-4 rounded-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#45c4b0]/10 border border-[#45c4b0]/20 flex items-center justify-center text-[#45c4b0]">
            <DollarSign size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              {tr('decTitle')}
              <span className="text-[10px] font-mono text-[#f5c042] bg-[#f5c042]/10 px-2 py-0.5 rounded border border-[#f5c042]/20">
                {tr('decSubBadge')}
              </span>
            </h3>
            <p className="text-xs text-[#a39e93] mt-0.5">{tr('decDesc')}</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-[11px] text-[#a39e93] mb-0.5">{tr('decPnlLabel')}</div>
            <div className={`font-mono-num text-2xl font-extrabold ${pnl >= 0 ? 'text-[#45c4b0]' : 'text-[#e65138]'}`}>
              {pnl >= 0 ? '+' : ''}{usd(pnl)}
            </div>
          </div>

          <div className="border-l border-white/[0.08] pl-4">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#070604] border border-white/[0.12] rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#f5c042] transition"
            >
              <option value="all">{tr('decFilterAll')}</option>
              <option value="watching">{tr('decFilterWatching')}</option>
              <option value="executed">{tr('decFilterExecuted')}</option>
              <option value="closed">{tr('decFilterClosed')}</option>
              <option value="dropped">{tr('decFilterDropped')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* 决策记录表格 */}
      <div className="terminal-panel rounded-lg overflow-hidden border border-white/[0.08]">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-[#070604]/80 text-[#a39e93] font-medium tracking-tight text-[11px] border-b border-white/[0.08]">
            <tr>
              <th className="py-2.5 px-3 w-8"></th>
              <th className="py-2.5 px-3">{tr('decThSymbol')}</th>
              <th className="py-2.5 px-3">{tr('decThRoute')}</th>
              <th className="py-2.5 px-3 text-right">{tr('decThSpread')}</th>
              <th className="py-2.5 px-3 text-center">{tr('decThVerdict')}</th>
              <th className="py-2.5 px-3">当前状态</th>
              <th className="py-2.5 px-3 text-right">已实现盈亏</th>
              <th className="py-2.5 px-3">最新操盘日志</th>
              <th className="py-2.5 px-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06] font-mono-num">
            {items.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-14 text-[#a39e93] font-sans">
                  {loading ? tr('searching') : tr('decNoData')}
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const rowKey = `${item.symbol}-${item.buyChain}-${item.sellChain}`;
                const isExpanded = expandedKeys.has(rowKey);
                const journal = item.decision?.journal || [];
                // 后端使用 unshift 插入，最新的一条记录索引恒为 0
                const latestLog = journal.length > 0 ? journal[0] : null;

                return (
                  <React.Fragment key={rowKey}>
                    <tr
                      onClick={() => toggleExpand(rowKey)}
                      className="hover:bg-white/[0.04] transition duration-150 cursor-pointer group select-none"
                    >
                      {/* 展开/收起箭头 */}
                      <td className="py-2.5 px-3 text-center text-[#6e695e] group-hover:text-[#f5c042] transition">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>

                      <td className="py-2.5 px-3 font-bold text-slate-100 font-sans">
                        <div className="flex items-center gap-1.5">
                          <span>{item.symbol}</span>
                          {journal.length > 0 && (
                            <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-[#f5c042]/10 text-[#f5c042] border border-[#f5c042]/20 font-mono">
                              {journal.length}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 font-sans">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-300">{item.buyChainName}</span>
                          <ArrowRight size={11} className="text-[#6e695e]" />
                          <span className="text-slate-300">{item.sellChainName}</span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right font-extrabold text-[#f5c042]">
                        +{item.spreadPct.toFixed(2)}%
                      </td>

                      <td className="py-2.5 px-3 text-center font-sans">
                        <VerdictBadge verdict={item.verdict} size="xs" />
                      </td>

                      <td className="py-2.5 px-3 font-sans" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={item.decision?.status || 'todo'}
                          onChange={(e) => updateStatus(item, e.target.value)}
                          className="bg-[#070604] border border-white/[0.12] rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-[#f5c042]"
                        >
                          <option value="todo">{tr('decOptTodo')}</option>
                          <option value="watching">{tr('decOptWatching')}</option>
                          <option value="executed">{tr('decOptExecuted')}</option>
                          <option value="closed">{tr('decOptClosed')}</option>
                          <option value="dropped">{tr('decOptDropped')}</option>
                        </select>
                      </td>

                      <td className="py-2.5 px-3 text-right font-bold text-slate-200">
                        {item.decision?.realizedPnlUsd != null && item.decision.realizedPnlUsd !== 0 ? (
                          <span className={item.decision.realizedPnlUsd > 0 ? 'text-[#45c4b0]' : 'text-[#e65138]'}>
                            {item.decision.realizedPnlUsd > 0 ? '+' : ''}{usd(item.decision.realizedPnlUsd)}
                          </span>
                        ) : (
                          <span className="text-[#6e695e]">—</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 font-sans max-w-xs truncate text-[11px] text-[#a39e93]">
                        {latestLog ? (
                          <span title={latestLog.text} className="text-slate-200 truncate block">
                            {latestLog.text}
                          </span>
                        ) : (
                          <span className="text-[#6e695e]">暂无操作日志 (点击展开)</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-center font-sans" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setSelectedItem(item)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#f5c042]/10 hover:bg-[#f5c042]/20 text-[#f5c042] border border-[#f5c042]/20 text-[10px] font-semibold transition cursor-pointer"
                            title="记录本次行动与盈亏"
                          >
                            <FileText size={11} />
                            <span>记一笔</span>
                          </button>
                          <button
                            onClick={() => clearDecision(item)}
                            className="p-1 rounded hover:bg-white/[0.08] text-[#6e695e] hover:text-[#e65138] transition cursor-pointer"
                            title="清空记录"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* 点击整行展开的详情抽屉面板 */}
                    {isExpanded && (
                      <tr className="bg-[#0c121e]/40 dark:bg-black/20">
                        <td colSpan={9} className="p-4 border-t border-b border-white/[0.04]">
                          <div className="max-w-4xl space-y-3 font-sans">
                            <div className="flex items-center justify-between">
                              <h4 className="font-bold text-xs text-slate-100 flex items-center gap-2">
                                <History size={14} className="text-[#f5c042]" />
                                <span>{item.symbol} 完整操盘日志与盈亏记录</span>
                                <span className="text-[10px] text-[#a39e93] font-normal">
                                  （共 {journal.length} 笔记录 · 累计盈亏: {usd(item.decision?.realizedPnlUsd || 0)}）
                                </span>
                              </h4>
                              <button
                                onClick={() => setSelectedItem(item)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#f5c042] hover:bg-[#f5c042]/90 text-[#070604] font-bold text-xs transition cursor-pointer"
                              >
                                <FileText size={12} />
                                <span>追加笔记 / 结算盈亏</span>
                              </button>
                            </div>

                            {journal.length === 0 ? (
                              <div className="py-6 text-center text-xs text-[#6e695e] bg-white/[0.02] rounded border border-white/[0.04]">
                                暂无操作笔记。点击右侧「记一笔」或右上角按钮记录买入成本、跨链进度或真实盈亏！
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                                {journal.map((j, idx) => (
                                  <div
                                    key={idx}
                                    className="p-3 bg-[#070604]/80 rounded border border-white/[0.06] text-xs space-y-1.5"
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 text-[#a39e93] text-[11px]">
                                        <Calendar size={12} className="text-[#6e695e]" />
                                        <span className="font-mono">{new Date(j.ts).toLocaleString()}</span>
                                        {j.status && (
                                          <span className="px-1.5 py-0.2 rounded bg-white/[0.06] text-slate-300 text-[10px]">
                                            推进至: {j.status}
                                          </span>
                                        )}
                                      </div>
                                      {j.pnlDeltaUsd != null && (
                                        <div className="font-mono-num font-bold">
                                          <span className="text-[#a39e93] mr-1 text-[11px]">盈亏变动:</span>
                                          <span className={j.pnlDeltaUsd >= 0 ? 'text-[#45c4b0]' : 'text-[#e65138]'}>
                                            {j.pnlDeltaUsd >= 0 ? '+' : ''}{usd(j.pnlDeltaUsd)}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                    <div className="text-slate-100 whitespace-pre-wrap leading-relaxed">
                                      {j.text}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 操盘笔记与盈亏结算弹窗 */}
      <DecisionModal
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onSaved={loadDecisions}
      />
    </div>
  );
};
