/* Quote evidence presentation · Impeccable Kinpaku Edition */
/* All provider data is rendered as text, never raw HTML. */
(() => {
  const stages = [
    ['buy', '买入资产', '在源链用结算币买入目标资产'],
    ['bridge_asset', '资产跨链', '将源链资产换至目标链资产，路线可能包含兑换'],
    ['sell', '卖出资产', '在目标链将资产换回结算币'],
    ['return_cash', '资金回流', '将结算币转回源链，完成报价闭环'],
  ];
  const chainNames = {
    ethereum: 'Ethereum', base: 'Base', arbitrum: 'Arbitrum', optimism: 'Optimism',
    polygon: 'Polygon', bsc: 'BNB Chain', avalanche: 'Avalanche',
    1: 'Ethereum', 8453: 'Base', 42161: 'Arbitrum', 10: 'Optimism',
    137: 'Polygon', 56: 'BNB Chain', 43114: 'Avalanche'
  };
  const sources = {
    manual: '手动复查', automatic_discovery: '自动发现',
    bridge_scan: '桥流水发现', automatic_recheck: '自动复测'
  };
  const stageNames = {
    input: '参数检查', metadata: '资产核验', security_check: '安全核验',
    ...Object.fromEntries(stages.map(([key, label]) => [key, label]))
  };
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const money = value => {
    if (!finite(value)) return '未取得';
    const abs = Math.abs(value);
    return (value < 0 ? '−' : '') + (abs > 0 && abs < .0001 ? '<$0.0001' : '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: abs > 0 && abs < .01 ? 4 : 2 }));
  };
  const date = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未记录';
  const chain = value => chainNames[value] || value || '链未记录';
  const duration = value => {
    if (!finite(value) || value < 0) return '未取得';
    if (value === 0) return '0 秒';
    if (value < 60) return Math.ceil(value) + ' 秒';
    const seconds = Math.ceil(value);
    return Math.floor(seconds / 60) + ' 分' + (seconds % 60 ? ' ' + (seconds % 60) + ' 秒' : '');
  };

  // Keep base-unit integers out of Number so 18/36-decimal assets retain their precision.
  function tokenAmount(raw, token) {
    const decimals = token?.decimals;
    if (!/^\d+$/.test(String(raw)) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return '数量未取得';
    const digits = String(raw).replace(/^0+(?=\d)/, '').padStart(decimals + 1, '0');
    const integer = (decimals ? digits.slice(0, -decimals) : digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, '') : '';
    return integer + (fraction ? '.' + fraction : '') + ' ' + (token?.symbol || '代币');
  }

  const node = (tag, value, cls) => {
    const n = document.createElement(tag);
    if (value !== undefined) n.textContent = value;
    if (cls) n.className = cls;
    return n;
  };

  function metric(label, value, cls) {
    const item = node('div', undefined, 'evidence-metric');
    item.append(node('dt', label), node('dd', value, cls));
    return item;
  }

  function tokenMetric(label, raw, token, cls) {
    const exact = tokenAmount(raw, token), item = metric(label, exact, cls), value = item.querySelector('dd');
    const parts = exact.match(/^([\d,]+)\.(\d{7,}) (.*)$/);
    if (parts) {
      const small = parts[1] === '0' && /^0{6}/.test(parts[2]);
      value.textContent = small ? '<0.000001 ' + parts[3] : '≈ ' + parts[1] + '.' + parts[2].slice(0, 6) + ' ' + parts[3];
      value.title = '完整数量：' + exact;
      value.setAttribute('aria-label', '完整数量：' + exact);
    }
    return item;
  }

  function issue(blocker, report) {
    const target = finite(report.assumptions?.minNetUsd) ? report.assumptions.minNetUsd : 2;
    const net = report.result?.netUsd;
    const known = {
      NET_BELOW_TARGET: ['扣费后净额未达门槛', finite(net) ? '本次报价净额为 ' + money(net) + '，观察门槛为 ' + money(target) + '，差额 ' + money(Math.max(0, target - net)) + '。' : '四段报价扣除费用后，未达到观察门槛。', '本次样本不进入正向复测；后续发现新信号时再验证。'],
      NO_ROUTE: ['服务商未返回可用路线', '当前资产、链与金额组合没有可用报价，闭环未完成。', '本次验证停止；有新路线或新报价时再检查。'],
      RATE_LIMITED: ['报价服务请求受限', '服务商触发限流，本次未能取得完整报价。', blocker.retryAt ? '限流截止时间：' + date(blocker.retryAt) + '。自动观察开启时，由调度器在恢复后继续。' : '等待报价服务恢复；自动观察开启时由调度器继续。'],
      PROVIDER_ERROR: ['报价服务响应异常', '服务商请求失败，当前证据不足以判断这条路线的收益。', '等待服务恢复后重新获取完整报价。'],
      UNKNOWN_COST: ['费用数据不完整', '缺少 Gas 或手续费的美元估值，或无法确认手续费是否已含在输出中。', '待费用数据完整后重新核算，缺失费用不会按零处理。'],
      UNKNOWN_DURATION: ['路线耗时未确认', '服务商未提供有效的预计耗时，无法安排可靠的延迟复测。', '取得完整路线耗时后重新验证。'],
      QUOTE_WINDOW: ['四段报价时间跨度过长', '询价跨度为 ' + duration(finite(report.result?.quoteWindowMs) ? report.result.quoteWindowMs / 1000 : null) + '，超过 ' + duration((report.assumptions?.maxQuoteWindowMs ?? 60000) / 1000) + ' 的快照窗口。', '重新查询完整路线；本次净额仅作为历史记录。'],
      BUDGET_LIMIT: ['超出资金条件', report.result ? '本金与额外费用合计 ' + money(report.result.requiredCapitalUsd) + '，预算上限为 ' + money(report.assumptions?.budgetUsd ?? 500) + '。' : '单次试算金额需为 $5–$450，总预算 $500 中预留 $50 费用余额。', '调整试算金额，并保留足够的链上费用余额。'],
      UNSUPPORTED_ROUTE: ['链组合不受支持', '当前验证要求使用已配置的两条不同 EVM 链。', '选择支持的源链与目标链后重新查询。'],
      INVALID_ADDRESS: ['合约地址格式不正确', '缺少有效的两端 EVM 代币合约地址。', '核对两条链各自的代币合约地址。'],
      TOKEN_MISMATCH: ['资产身份或精度核验失败', '服务商返回的资产信息不符合要求，或代币精度数据缺失。', '核对链、合约地址与代币精度后重新验证。'],
      QUOTE_MISMATCH: ['报价与请求不一致', '返回报价的资产、链、数量或精度与本次请求不一致。', '本次报价不采用，需重新取得匹配的报价。'],
      INVALID_OUTPUT: ['输出数量无效', '预计输出或最低输出缺失、非正数，或最低输出超过预计输出。', '取得有效输出数量后再继续后续段报价。'],
      SETTLEMENT_PRICE: ['结算币价格异常', '结算币美元价格缺失，或超出系统允许的 $0.98–$1.02 范围。', '待价格数据恢复并通过校验后重新计算。'],
      VALIDATION_ERROR: ['验证过程发生异常', '本次验证未能正常完成，无法形成完整结论。', '核对原始错误记录，排除异常后重试。'],
    };
    const [title, explanation, action] = known[blocker.code] || ['存在未分类的验证问题', blocker.message || '报告未提供进一步说明。', '查看原始记录，确认原因后重新验证。'];
    return { title, explanation, action, stage: stageNames[blocker.stage] || blocker.stage };
  }

  function conclusion(report) {
    const expired = report.status === 'POSITIVE_INDICATION' && finite(report.validUntil) && Date.now() > report.validUntil;
    const review = report.review?.state;
    if (review === 'SIGNAL_NOT_REPEATED') return { tone: 'warn', title: '复测未重现', summary: '后续报价未再次满足条件，原正向信号不成立。' };
    if (expired || review === 'RECHECK_EXPIRED') return { tone: 'neutral', title: '正向样本已过期', summary: '历史报价曾达到门槛，当前不能作为有效机会。' };
    if (report.status === 'BLOCKED') return { tone: 'warn', title: '报价验证受阻', summary: '仅取得 ' + (report.legs?.length || 0) + ' / 4 段报价，尚不能判断完整净额。' };
    if (report.status === 'REJECTED') return { tone: report.result?.netUsd < 0 ? 'bad' : 'warn', title: report.result?.netUsd < 0 ? '报价测算为负' : '未满足筛选条件', summary: '已完成报价核算，但本次样本未通过全部条件。' };
    if (report.status === 'POSITIVE_INDICATION') return { tone: 'good', title: '正向报价 · 待核验', summary: '本次报价达到观察门槛，仍需复测和执行前检查。' };
    return { tone: 'neutral', title: '状态待确认', summary: '当前报告未提供可识别的验证结论。' };
  }

  function nextStep(report) {
    const review = report.review?.state;
    if (review === 'SIGNAL_NOT_REPEATED') return '正向信号未重现；需后续新信号重新验证。';
    if (review === 'RECHECK_EXPIRED') return '复测排队已过期，等待重新发现候选。';
    if (review === 'SECURITY_UNCONFIRMED') return '合约安全数据尚未确认，需补齐安全核验。';
    if (review === 'WALLET_SIMULATION_REQUIRED') return '仍需钱包余额、授权与链上模拟检查，当前不会提交交易。';
    if (review === 'RECHECK_REQUIRED') return '等待延迟复测' + (report.nextCheckAfter ? '；最早计划时间 ' + date(report.nextCheckAfter) : '') + '。实际调度受自动观察开关与服务限流影响。';
    if (report.status === 'POSITIVE_INDICATION') return '需取得新报价并完成安全、钱包与执行前检查。';
    return (report.blockers?.length ? issue(report.blockers[0], report).action : '等待后续有效报价补齐验证。');
  }

  function buildEvidence(report) {
    const box = node('div', undefined, 'evidence-panel');
    const verdict = conclusion(report);
    const heading = node('div', undefined, 'evidence-heading');
    heading.append(node('h3', (report.symbol || '自定义资产') + ' · 报价验证报告'), node('span', '报价记录 · 未成交', 'evidence-badge neutral'));
    box.append(heading, node('p', date(report.startedAt) + ' · ' + (sources[report.source] || '来源未记录') + (report.followupOf ? ' · 关联前次样本复测' : ''), 'evidence-meta'));
    
    const verdictBox = node('div', undefined, 'evidence-verdict ' + verdict.tone);
    verdictBox.append(node('h4', verdict.title), node('p', verdict.summary), node('p', '后续处理：' + nextStep(report), 'evidence-next'));
    box.append(verdictBox);

    const blockers = report.blockers || [];
    if (blockers.length || report.review?.blockers?.length) {
      box.append(node('h4', '判断依据与处理建议', 'evidence-section-title'));
      const reasons = node('ol', undefined, 'evidence-reasons');
      blockers.forEach(b => {
        const info = issue(b, report), li = node('li');
        li.append(node('b', (info.stage ? info.stage + ' · ' : '') + info.title), node('p', info.explanation), node('p', '处理：' + info.action, 'evidence-next'));
        reasons.append(li);
      });
      (report.review?.blockers || []).forEach(value => {
        const li = node('li'); li.append(node('b', '复核条件'), node('p', String(value))); reasons.append(li);
      });
      box.append(reasons);
    }

    box.append(node('h4', '逐段报价明细', 'evidence-section-title'), node('p', '下一段按上一段的最低输出继续询价。“已取得报价”表示数据完整，不表示已成交；最低输出不保证跨链到账后的未来价格。长小数以 ≈ 简写，悬停可查看完整数量。', 'evidence-note'));
    
    const cards = node('div', undefined, 'evidence-legs');
    stages.forEach(([key, label, description], index) => {
      const leg = (report.legs || []).find(l => l.name === key);
      const blocked = blockers.find(b => b.stage === key);
      const card = node('article', undefined, 'evidence-leg' + (!leg ? ' is-missing' : ''));
      const head = node('div', undefined, 'evidence-leg-head');
      head.append(node('h5', (index + 1) + '. ' + label), node('span', leg ? '已取得报价' : blocked ? '此段受阻' : '未询价', 'evidence-badge ' + (leg ? 'neutral' : blocked ? 'warn' : 'muted')));
      card.append(head, node('p', description, 'evidence-note'));
      if (leg) {
        card.append(node('p', chain(leg.from?.chainId) + ' · ' + (leg.from?.symbol || '代币') + ' → ' + chain(leg.to?.chainId) + ' · ' + (leg.to?.symbol || '代币'), 'evidence-path'));
        const values = node('dl', undefined, 'evidence-amounts');
        values.append(tokenMetric('投入数量', leg.fromAmount, leg.from), tokenMetric('预计输出', leg.toAmount, leg.to), tokenMetric('最低输出 · 后续计算采用', leg.toAmountMin, leg.to, 'evidence-minimum'));
        card.append(values);
        const costs = node('dl', undefined, 'evidence-costs');
        costs.append(metric('Gas 估值', money(leg.gasUsd)), metric('额外手续费', money(leg.externalFeeUsd)), metric('输出内已含费用', money(leg.includedFeeUsd)), metric('预计执行耗时', duration(leg.etaSeconds)));
        card.append(costs, node('p', '报价通道：' + (leg.tool || '未记录'), 'evidence-note'));
        if (leg.steps?.length) card.append(node('p', '路线组成：' + leg.steps.map(step => step.tool === 'feeCollection' ? '手续费收取' : ({ swap: '兑换', cross: '跨链', protocol: '协议处理' }[step.type] || '其他步骤') + '（' + (step.tool || '未记录') + '）').join(' → '), 'evidence-note'));
        card.append(node('p', '报价接收：' + date(leg.receivedAt), 'evidence-note'));
      } else {
        card.append(node('p', blocked ? issue(blocked, report).explanation : '此前核验或报价未通过，本次未继续查询该段。', 'evidence-missing'));
      }
      cards.append(card);
    });
    box.append(cards, node('h4', '闭环净额核算', 'evidence-section-title'));

    if (report.result) {
      const r = report.result, ledger = node('dl', undefined, 'evidence-ledger');
      ledger.append(
        metric('① 回流最低输出折算', money(r.finalUsd)),
        metric('② 减：初始本金', money(r.initialUsd)),
        metric('③ 减：四段 Gas 估值', money(r.gasUsd)),
        metric('④ 减：额外手续费', money(r.externalFeeUsd)),
        metric('⑤ 减：额外费用缓冲', money(r.extraCostBufferUsd)),
        metric('报价净额 = ① − ② − ③ − ④ − ⑤', money(r.netUsd), r.netUsd < 0 ? 'bad' : 'good')
      );
      box.append(ledger, node('p', '输出内已含费用合计 ' + money(r.includedFeesUsd) + '，已反映在回流数量中，不再重复扣减。额外费用缓冲是试算假设。', 'evidence-note'));
      const timing = node('dl', undefined, 'evidence-costs');
      timing.append(metric('本金与额外费用合计', money(r.requiredCapitalUsd)), metric('全程预计执行耗时', duration(r.etaSeconds)), metric('四段询价时间跨度', duration(finite(r.quoteWindowMs) ? r.quoteWindowMs / 1000 : null)), metric('观察门槛', money(report.assumptions?.minNetUsd ?? 2)));
      box.append(timing);
    } else {
      box.append(node('p', '四段报价尚未齐全，暂不计算闭环净额。已取得段的输出不能当作整条路线的收益。', 'evidence-missing'));
    }

    const checks = node('dl', undefined, 'evidence-costs');
    checks.append(metric('合约安全', report.security?.unknown ? '数据未确认' : report.security?.safe === true ? '本次检查通过' : report.security?.safe === false ? '检查未通过' : '未记录'), metric('真实成交收益', '未产生 · 本报告仅为模拟报价'));
    box.append(checks);
    if (report.security?.riskReason) box.append(node('p', '安全说明：' + report.security.riskReason, 'evidence-note'));

    // Raw JSON details with Copy button
    const raw = node('details', undefined, 'evidence-raw');
    const sumRow = node('div', undefined, 'evidence-raw-header');
    const summary = node('summary', '原始记录与错误码（技术详情）');
    const copyBtn = node('button', '复制 JSON', 'btn-copy-raw');
    copyBtn.type = 'button';
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => {
        showToast('已复制原始报价记录 JSON 到剪贴板');
      }).catch(() => {
        showToast('复制失败，请手动选择复制');
      });
    };
    sumRow.append(summary, copyBtn);
    raw.append(sumRow, node('pre', JSON.stringify(report, null, 2)));
    box.append(raw);

    return box;
  }

  function showToast(msg, duration = 2400) {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'lab-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), duration);
  }

  const rows = new Map();
  function renderReports(reports) {
    const tbody = document.getElementById('rows'), active = new Set();
    if (!reports?.length) {
      rows.clear();
      const tr = node('tr'), td = node('td', '暂时没有报价证据。自动验证完成后，将显示各段报价、费用与筛选原因。', 'evidence-empty');
      td.colSpan = 5;
      tr.append(td);
      tbody.replaceChildren(tr);
      return;
    }
    tbody.querySelector('.evidence-empty')?.parentElement?.remove();

    reports.forEach((report, index) => {
      const key = String(report.id || [report.startedAt, report.symbol, report.buyChain, report.sellChain, index].join('-'));
      active.add(key);
      const verdict = conclusion(report), signature = JSON.stringify(report) + '|' + verdict.title;
      let entry = rows.get(key);
      if (!entry || entry.signature !== signature) {
        const opened = entry?.button.getAttribute('aria-expanded') === 'true';
        const rawOpen = entry?.detail.querySelector('.evidence-raw')?.open;
        const hadFocus = entry?.button === document.activeElement;
        const tr = node('tr', undefined, 'evidence-summary-row'), detail = node('tr', undefined, 'evidence-detail-row');
        
        // Col 1: Route & Time
        const route = node('td');
        route.append(
          node('b', report.symbol || '自定义资产', 'evidence-symbol'),
          node('span', chain(report.buyChain) + ' → ' + chain(report.sellChain), 'evidence-route'),
          node('time', date(report.startedAt), 'evidence-meta')
        );
        const button = node('button', opened ? '收起逐段证据 ↑' : '查看逐段证据 ↓', 'evidence-toggle');
        button.type = 'button';
        button.setAttribute('aria-expanded', String(!!opened));
        const detailId = 'evidence-' + key;
        detail.id = detailId;
        button.setAttribute('aria-controls', detailId);
        button.setAttribute('aria-label', (report.symbol || '自定义资产') + ' ' + chain(report.buyChain) + ' 至 ' + chain(report.sellChain) + ' 的逐段报价证据');
        route.append(button);

        // Col 2: Amount
        const amountTd = node('td', money(report.amountUsd));

        // Col 3: Progress
        const progress = node('td');
        progress.append(node('b', (report.legs?.length || 0) + ' / 4'), node('span', '段报价', 'evidence-meta'));

        // Col 4: Net
        const net = node('td');
        const isFiniteNet = finite(report.result?.netUsd);
        net.append(
          node('b', isFiniteNet ? money(report.result.netUsd) : '尚未计算', isFiniteNet ? (report.result.netUsd < 0 ? 'bad' : 'good') : 'muted'),
          node('span', '报价估计', 'evidence-meta')
        );

        // Col 5: Result & Reasons
        const result = node('td', undefined, 'evidence-result');
        result.append(node('span', verdict.title, 'evidence-badge ' + verdict.tone));
        const first = report.blockers?.[0] ? issue(report.blockers[0], report) : null;
        result.append(node('p', first ? (first.stage ? first.stage + '：' : '') + first.title : verdict.summary));
        if (first) result.append(node('p', first.explanation, 'evidence-note'));
        if ((report.blockers?.length || 0) > 1) result.append(node('span', '另有 ' + (report.blockers.length - 1) + ' 项原因，展开查看', 'evidence-meta'));

        tr.append(route, amountTd, progress, net, result);

        const cell = node('td');
        cell.colSpan = 5;
        detail.append(cell);
        detail.hidden = !opened;

        let built = false;
        const populate = () => {
          if (!built) {
            cell.append(buildEvidence(report));
            built = true;
            if (rawOpen) cell.querySelector('.evidence-raw').open = true;
          }
        };

        if (opened) populate();
        button.onclick = () => {
          const open = button.getAttribute('aria-expanded') !== 'true';
          button.setAttribute('aria-expanded', String(open));
          button.textContent = open ? '收起逐段证据 ↑' : '查看逐段证据 ↓';
          detail.hidden = !open;
          if (open) populate();
        };

        if (entry) {
          entry.tr.replaceWith(tr);
          entry.detail.replaceWith(detail);
        }
        entry = { tr, detail, button, signature };
        rows.set(key, entry);
        if (hadFocus) button.focus({ preventScroll: true });
      }

      const position = index * 2;
      if (tbody.children[position] !== entry.tr) tbody.insertBefore(entry.tr, tbody.children[position] || null);
      if (tbody.children[position + 1] !== entry.detail) tbody.insertBefore(entry.detail, tbody.children[position + 1] || null);
    });

    for (const [key, entry] of rows) {
      if (!active.has(key)) {
        entry.tr.remove();
        entry.detail.remove();
        rows.delete(key);
      }
    }
  }

  window.LabEvidence = { renderReports, showToast };
})();
