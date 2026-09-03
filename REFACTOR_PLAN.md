# Bridge Arb Radar 架构重构演进计划

本文档定义 Bridge Arb Radar 从“脚本拼接与单文件架构”演进为“分层解耦、高内聚低耦合、生产级”的整体实施路线。

---

## 阶段规划概览

- [x] **第一阶段：后端核心解耦与模块领域化 (Phase 1: Domain & Core Decoupling)**
  - [x] 1.1 建立测试基线：确保现有回归用例（adjudicate, best-verdict, check-ids）100% 通过
  - [x] 1.2 规范数据接入层：抽取 `BaseSourceAdapter` 基类，重构 6 个 Bridge 数据源适配器（生命周期、熔断、统一数据契约）
  - [x] 1.3 领域计算拆解：从 `engine.js` 中彻底拆离 `WalletScorer`（聪明钱包与闭环分析）、`ArbCalculator`（套利检测与流动性过滤）
  - [x] 1.4 服务端路由与业务下沉：拆解 780+ 行 `server.js`，实现标准化 API Router、Controller 与静态服务解耦
  - [x] 1.5 验证阶段回归：运行所有 test suites，保证零破坏性改动

- [x] **第二阶段：存储层去全量内存化 & 实时通信 (Phase 2: Real SQLite & Realtime Events)**
  - [x] 2.1 存储 Repository 改造：重构 `lib/db.js` 与 `lib/routes/index.js`，查询、多维度模糊检索、排序与分页下推至原生 SQL
  - [x] 2.2 引入 SSE (Server-Sent Events) 单向推流通道：`lib/events.js` 建立长连接总线，扫描完成、套利机会即时推送到前端
  - [x] 2.3 批处理与事务优化：WAL 模式 + 512 页自动 Checkpoint + Prepared Statement 缓存，毫秒级响应并杜绝崩溃坏库

- [x] **第三阶段：前端现代构建与 UI/UX 专业级精修 (Phase 3: Vite + React + TS + Tailwind + Impeccable)**
  - [x] 3.1 前端工程初始化：搭建 `web/` 独立前端工程（Vite + React + TypeScript + Tailwind CSS + Lucide Icons）
  - [x] 3.2 组件化架构拆解：拆分为响应式模块化组件（App, OpportunityCard, WalletDrawer, FeedTable, DecisionLedger, VerdictBadge）
  - [x] 3.3 实时数据流：原生接入后端的 SSE 实时推送通道，扫描和新套利机会即时响应
  - [x] 3.4 交易员专业驾驶舱 UI/UX 精修（`/impeccable`）：
    - 等宽数字排版（`font-mono-num` tabular-nums）提升价格与价差扫描对比效率
    - 4 档假币裁决清晰色标体系（`official` 蓝 / `confirmed` 绿 / `suspicious` 黄 / `fake` 红）
    - 紧凑高信息密度布局、快速复制、多链浏览器一键跳转与 DeBank 快速画像联动
  - [x] 3.5 生产构建与无缝分发：Vite build 自动化输出到 `public/`，Node.js 原生后端直接托管，保持零多余配置直出体验
