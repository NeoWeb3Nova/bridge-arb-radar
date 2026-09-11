(() => {
  class RequestStatus extends HTMLElement {
    connectedCallback() {
      if (this.initialized) return;
      this.initialized = true;
      const shadow = this.shadowRoot || this.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>
          :host {
            display: block;
            color: var(--text-primary, #ece8e1);
            font-family: var(--font-sans, "Albert Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
            font-size: 13px;
            line-height: 1.5;
            letter-spacing: -0.015em;
          }
          :host(.lab-section) {
            background: var(--bg-surface, #161410);
            border: 1px solid var(--border-card, rgba(236, 232, 225, 0.12));
            border-radius: 8px;
            padding: 22px 24px;
            margin-bottom: 24px;
            box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.3);
            transition: border-color 0.15s ease;
          }
          :host(.lab-section:hover) {
            border-color: rgba(236, 232, 225, 0.2);
          }
          :host(:not(.lab-section)) .req-box {
            background: var(--bg-surface, #161410);
            border: 1px solid var(--border-subtle, rgba(236, 232, 225, 0.12));
            border-radius: 8px;
            padding: 16px 18px;
            margin: 14px 0;
          }
          .req-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            flex-wrap: wrap;
            margin-bottom: 16px;
          }
          .req-title-wrap {
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .req-icon-badge {
            width: 30px;
            height: 30px;
            border-radius: 6px;
            background: rgba(245, 192, 66, 0.12);
            border: 1px solid rgba(245, 192, 66, 0.3);
            color: var(--ks-kinpaku, #f5c042);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          }
          .req-title {
            font-size: 15px;
            font-weight: 650;
            letter-spacing: -0.01em;
            margin: 0;
            color: var(--text-primary, #ece8e1);
          }
          .req-sub {
            font-size: 12px;
            color: var(--text-secondary, #a39e93);
            margin-top: 2px;
          }
          .req-btn-toggle {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-family: var(--font-sans, inherit);
            font-size: 12px;
            font-weight: 600;
            padding: 7px 14px;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.15s cubic-bezier(0.2, 0.8, 0.2, 1);
            background: var(--bg-elevated, #211e19);
            border: 1px solid var(--border-subtle, rgba(236, 232, 225, 0.15));
            color: var(--text-primary, #ece8e1);
            white-space: nowrap;
          }
          .req-btn-toggle:hover:not(:disabled) {
            border-color: var(--ks-kinpaku, #f5c042);
            color: var(--ks-kinpaku, #f5c042);
            background: rgba(245, 192, 66, 0.08);
          }
          .req-btn-toggle.is-paused {
            background: rgba(230, 81, 56, 0.15);
            border-color: rgba(230, 81, 56, 0.45);
            color: var(--ks-vermilion-pale, #f28b79);
            box-shadow: 0 0 12px rgba(230, 81, 56, 0.2);
          }
          .req-btn-toggle.is-paused:hover:not(:disabled) {
            background: rgba(230, 81, 56, 0.25);
            border-color: var(--ks-vermilion, #e65138);
            color: #ffffff;
          }
          .req-btn-toggle:disabled {
            opacity: 0.5;
            cursor: wait;
          }
          .req-status-banner {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            margin-bottom: 14px;
            background: rgba(69, 196, 176, 0.08);
            border: 1px solid rgba(69, 196, 176, 0.22);
            color: var(--ks-patina-pale, #7fe0d0);
            line-height: 1.4;
          }
          .req-status-banner.is-paused {
            background: rgba(230, 81, 56, 0.08);
            border-color: rgba(230, 81, 56, 0.28);
            color: var(--ks-vermilion-pale, #f28b79);
          }
          .req-status-banner.error {
            background: rgba(230, 81, 56, 0.12);
            border-color: var(--ks-vermilion, #e65138);
            color: #ff9988;
          }
          .req-status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: currentColor;
            flex-shrink: 0;
          }
          .req-hud-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 14px;
          }
          .req-hud-card {
            background: var(--bg-elevated, #211e19);
            border: 1px solid var(--border-subtle, rgba(236, 232, 225, 0.12));
            border-radius: 4px;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 3px;
            transition: border-color 0.15s ease;
          }
          .req-hud-card:hover {
            border-color: rgba(245, 192, 66, 0.25);
          }
          .req-hud-k {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--text-muted, #6e695e);
          }
          .req-hud-v {
            font-family: var(--font-mono, "JetBrains Mono", monospace);
            font-variant-numeric: tabular-nums;
            font-size: 17px;
            font-weight: 700;
            color: var(--text-primary, #ece8e1);
            line-height: 1.2;
          }
          .req-hud-v.good { color: var(--ks-patina, #45c4b0); }
          .req-hud-v.warn { color: var(--ks-kinpaku, #f5c042); }
          .req-hud-v.alert { color: var(--ks-vermilion, #e65138); }
          .req-hud-sub {
            font-size: 11px;
            color: var(--text-secondary, #a39e93);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .req-tasks-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 12px;
          }
          .req-task-card {
            background: var(--bg-elevated, #211e19);
            border: 1px solid var(--border-subtle, rgba(236, 232, 225, 0.12));
            border-radius: 4px;
            padding: 10px 12px;
          }
          .req-task-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 4px;
          }
          .req-task-name {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-primary, #ece8e1);
          }
          .req-task-badge {
            font-family: var(--font-mono, monospace);
            font-size: 10px;
            font-weight: 600;
            padding: 1px 6px;
            border-radius: 3px;
          }
          .req-task-badge.on {
            background: rgba(69, 196, 176, 0.12);
            color: var(--ks-patina, #45c4b0);
            border: 1px solid rgba(69, 196, 176, 0.3);
          }
          .req-task-badge.off {
            background: rgba(110, 105, 94, 0.15);
            color: var(--text-muted, #6e695e);
            border: 1px solid var(--border-subtle, rgba(236, 232, 225, 0.1));
          }
          .req-task-desc {
            font-size: 11px;
            color: var(--text-secondary, #a39e93);
            line-height: 1.4;
          }
          .req-diagnostics {
            font-family: var(--font-mono, monospace);
            font-size: 11px;
            color: var(--text-secondary, #a39e93);
            background: rgba(0, 0, 0, 0.2);
            border: 1px solid var(--border-subtle, rgba(236, 232, 225, 0.08));
            padding: 7px 10px;
            border-radius: 4px;
            margin-bottom: 8px;
            letter-spacing: -0.01em;
          }
          .req-note {
            font-size: 11px;
            color: var(--text-muted, #6e695e);
            line-height: 1.5;
            margin: 4px 0 0;
          }
          ul.req-legacy-list {
            display: none;
          }
          @media (max-width: 768px) {
            .req-hud-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .req-tasks-grid { grid-template-columns: 1fr; }
          }
          @media (max-width: 480px) {
            .req-hud-grid { grid-template-columns: 1fr; }
            .req-head { flex-direction: column; align-items: stretch; }
          }
        </style>
        <div class="req-box">
          <div class="req-head">
            <div class="req-title-wrap">
              <div class="req-icon-badge" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <div>
                <h3 class="req-title">请求调度与全局防护</h3>
                <div class="req-sub">统一管理外部 API / RPC 并发队列、服务商退避与本机报价预算</div>
              </div>
            </div>
            <button type="button" class="req-btn-toggle" disabled>
              <span class="btn-text">读取状态…</span>
            </button>
          </div>

          <div class="req-status-banner state" role="status">
            <span class="req-status-dot"></span>
            <span class="state-text">正在读取本机调度状态…</span>
          </div>

          <div class="req-hud-grid">
            <div class="req-hud-card">
              <span class="req-hud-k">外部并发</span>
              <span class="req-hud-v concurrency-val">--</span>
              <span class="req-hud-sub concurrency-sub">当前通信管道</span>
            </div>
            <div class="req-hud-card">
              <span class="req-hud-k">排队等待</span>
              <span class="req-hud-v queue-val">--</span>
              <span class="req-hud-sub queue-sub">超 15s 自动熔断</span>
            </div>
            <div class="req-hud-card">
              <span class="req-hud-k">LI.FI 2H 额度</span>
              <span class="req-hud-v budget-val">--</span>
              <span class="req-hud-sub budget-sub">四段验证单次需 4 次</span>
            </div>
            <div class="req-hud-card">
              <span class="req-hud-k">服务商状态</span>
              <span class="req-hud-v providers-val">--</span>
              <span class="req-hud-sub providers-sub">无退避冷却</span>
            </div>
          </div>

          <div class="req-tasks-grid">
            <div class="req-task-card">
              <div class="req-task-head">
                <span class="req-task-name">桥流水扫描</span>
                <span class="req-task-badge scan-badge">--</span>
              </div>
              <div class="req-task-desc scan-desc">后台定时扫描桥流水以发掘潜在机会</div>
            </div>
            <div class="req-task-card">
              <div class="req-task-head">
                <span class="req-task-name">自动机会监控</span>
                <span class="req-task-badge monitor-badge">--</span>
              </div>
              <div class="req-task-desc monitor-desc">从代币库发现候选路线并试算四段闭环</div>
            </div>
          </div>

          <ul class="req-legacy-list"></ul>
          <div class="req-diagnostics limits">本次服务启动以来：读取中…</div>
          <p class="req-note usage"></p>
          <p class="req-note">页面刷新只读取本机已持久化结果。桥扫描与自动机会监控各有独立开关；总暂停会阻止本服务所有新的外部 API / RPC 请求，已发出的请求允许安全结束。后台开关偏好会完整保留。</p>
        </div>
      `;

      this.button = shadow.querySelector('button');
      this.status = shadow.querySelector('.state');
      this.stateText = shadow.querySelector('.state-text');
      this.list = shadow.querySelector('ul');
      this.usage = shadow.querySelector('.usage');
      this.limits = shadow.querySelector('.limits');

      this.concurrencyVal = shadow.querySelector('.concurrency-val');
      this.concurrencySub = shadow.querySelector('.concurrency-sub');
      this.queueVal = shadow.querySelector('.queue-val');
      this.queueSub = shadow.querySelector('.queue-sub');
      this.budgetVal = shadow.querySelector('.budget-val');
      this.budgetSub = shadow.querySelector('.budget-sub');
      this.providersVal = shadow.querySelector('.providers-val');
      this.providersSub = shadow.querySelector('.providers-sub');
      this.scanBadge = shadow.querySelector('.scan-badge');
      this.scanDesc = shadow.querySelector('.scan-desc');
      this.monitorBadge = shadow.querySelector('.monitor-badge');
      this.monitorDesc = shadow.querySelector('.monitor-desc');

      this.button.onclick = () => this.update({ paused: !this.paused });
      this.onVisibility = () => {
        if (!document.hidden) this.update();
      };
      document.addEventListener('visibilitychange', this.onVisibility);
      this.update();
    }

    disconnectedCallback() {
      clearTimeout(this.timer);
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.initialized = false;
    }

    async update(body) {
      if (this.pending) return;
      clearTimeout(this.timer);
      if (document.hidden && !body) {
        this.timer = setTimeout(() => this.update(), 10000);
        return;
      }
      this.pending = true;
      this.button.disabled = true;
      try {
        const res = await fetch('/api/activity', {
          ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(8000),
        });
        const s = await res.json();
        if (!s.ok) throw Error(s.error || '读取状态失败');
        const n = s.network;
        this.paused = n.paused;

        // Button state
        if (n.paused) {
          this.button.className = 'req-btn-toggle is-paused';
          this.button.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <span>恢复外部请求</span>
          `;
        } else {
          this.button.className = 'req-btn-toggle';
          this.button.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
            <span>暂停全部外部请求</span>
          `;
        }

        // Status banner
        const statusMsg = n.paused
          ? '总暂停已生效；已拦截所有新发起的外部 API / RPC 请求（本地数据仍可浏览）。'
          : `外部请求受统一保护：当前 ${n.active} / ${n.maxActive} 个并发，${n.queued} 个排队中。`;
        if (this.stateText) this.stateText.textContent = statusMsg;
        else this.status.textContent = statusMsg;

        if (n.paused) {
          this.status.classList.add('is-paused');
        } else {
          this.status.classList.remove('is-paused');
        }
        this.status.classList.remove('error');

        // HUD: Concurrency
        if (this.concurrencyVal) {
          this.concurrencyVal.textContent = `${n.active} / ${n.maxActive}`;
          this.concurrencyVal.className = 'req-hud-v ' + (n.paused ? 'alert' : n.active >= n.maxActive ? 'warn' : 'good');
          this.concurrencySub.textContent = n.paused ? '总暂停拦截中' : `并发保护上限 ${n.maxActive}`;
        }

        // HUD: Queue
        if (this.queueVal) {
          this.queueVal.textContent = n.queued;
          this.queueVal.className = 'req-hud-v ' + (n.queued > 20 ? 'alert' : n.queued > 0 ? 'warn' : 'good');
          this.queueSub.textContent = n.queued > 0 ? '正在排队调度' : '队列畅通无积压';
        }

        // HUD: Budget
        const b = n.quoteBudget;
        if (this.budgetVal) {
          this.budgetVal.textContent = `${b.remaining} / ${b.limit}`;
          this.budgetVal.className = 'req-hud-v ' + (b.remaining < 4 ? 'alert' : b.remaining < 12 ? 'warn' : 'good');
          this.budgetSub.textContent = b.remaining < 4 && b.resetAt
            ? `最早释放: ${new Date(b.resetAt).toLocaleTimeString()}`
            : `剩余 ${b.remaining} 次额度`;
        }

        // HUD: Providers Cooldown
        const cooldowns = (n.providers || []).filter(p => p.cooldownUntil).map(p => p.name + ' 冷却至 ' + new Date(p.cooldownUntil).toLocaleTimeString());
        if (this.providersVal) {
          if (cooldowns.length > 0) {
            this.providersVal.textContent = `${cooldowns.length} 项受限`;
            this.providersVal.className = 'req-hud-v alert';
            this.providersSub.textContent = cooldowns.join('；');
          } else {
            this.providersVal.textContent = '正常';
            this.providersVal.className = 'req-hud-v good';
            this.providersSub.textContent = '无已知退避冷却';
          }
        }

        // Tasks: Scan
        if (this.scanBadge) {
          this.scanBadge.textContent = s.scan.enabled ? '定时已开启' : '定时已关闭';
          this.scanBadge.className = 'req-task-badge ' + (s.scan.enabled ? 'on' : 'off');
          this.scanDesc.textContent = s.scan.busy ? '当前扫描正在处理中…' : '后台定时扫描桥流水以发掘潜在机会';
        }

        // Tasks: Monitor
        if (this.monitorBadge) {
          this.monitorBadge.textContent = s.monitoring.enabled ? '已开启' : '已关闭';
          this.monitorBadge.className = 'req-task-badge ' + (s.monitoring.enabled ? 'on' : 'off');
          this.monitorDesc.textContent = s.monitoring.busy
            ? '正在向服务商查询四段完整报价…'
            : s.monitoring.discoveryBusy
            ? '正在从代币库发现候选路线…'
            : `新路线最多每 ${(s.monitoring.verificationIntervalSeconds || 480) / 60} 分钟询价一次，正向信号优先复测`;
        }

        // Legacy list for backwards compatibility
        if (this.list) {
          this.list.replaceChildren();
          for (const val of [
            '桥流水扫描：' + (s.scan.enabled ? '定时扫描已开启' : '定时扫描已关闭') + (s.scan.busy ? '；当前扫描正在处理' : ''),
            '自动机会监控：' + (s.monitoring.enabled ? '已开启' : '已关闭') + (s.monitoring.busy ? '；正在验证报价' : s.monitoring.discoveryBusy ? '；正在发现候选' : ''),
            '新路线完整询价：最多每 ' + (s.monitoring.verificationIntervalSeconds || 480) / 60 + ' 分钟启动一次；已发现的正向信号优先延迟复测。',
          ]) {
            const li = document.createElement('li');
            li.textContent = val;
            this.list.append(li);
          }
        }

        // Detailed diagnostics text
        const tierLabel = b.limit >= 1000 ? '已启用 API Key · 100 RPM' : '公共无 Key 保护';
        this.usage.textContent = `本机 LI.FI 报价预算（${tierLabel}）：近两小时已请求 ${b.used} / ${b.limit} 次；剩余 ${b.remaining} 次。一次完整验证最多需要 4 次报价。${b.remaining < 4 && b.resetAt ? ' 最早释放时间：' + new Date(b.resetAt).toLocaleString() : ''}`;
        this.limits.textContent = `本次服务启动以来：发出 ${n.counters.sent} 次外部请求，合并 ${n.counters.joined} 次重复请求。${cooldowns.length ? ' 限流中：' + cooldowns.join('；') : ' 当前无已知服务商限流。'}`;

        if (body) document.dispatchEvent(new Event('request-policy-change'));
      } catch (e) {
        const errorMsg = '请求状态更新失败：' + e.message;
        if (this.stateText) this.stateText.textContent = errorMsg;
        else this.status.textContent = errorMsg;
        this.status.classList.add('error');
      } finally {
        this.pending = false;
        this.button.disabled = this.paused === undefined;
        if (this.isConnected) this.timer = setTimeout(() => this.update(), 10000);
      }
    }
  }

  if (!customElements.get('request-status')) customElements.define('request-status', RequestStatus);
})();
