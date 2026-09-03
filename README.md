# bridge-arb-radar — 跨链桥套利机会雷达

追踪多条跨链桥（LayerZero / Wormhole / Hyperlane / Axelar / Range / Blockscan）上的高价值转账活动，识别潜在的跨链**价差套利机会**，并对每笔机会做**假币裁决**（official / confirmed / suspicious / fake），沉淀可复用的钱包与代币数据。

纯 Node.js 应用，无第三方运行时依赖（使用 Node 22 内置 `node:sqlite` 与 `fetch`），数据落在本地 SQLite。自带一个轻量 Web 看板。

## 它能做什么

- **桥追踪层**：从 6 家桥协议抓取主网高频/大额跨链消息与转账，识别高频执行套利、且路径值得反复使用的钱包（大部分接口公开免 Key）。
- **价格比价层**：对每条「买 A 链 / 卖 B 链」路线，用 DexScreener 批量端点取两链实时报价，算价差与池子流动性门槛，判定是否值得关注。
- **假币裁决层**：用 verified 官方报价注册表 + 多来源交叉锚点，把同 symbol 却 80× 偏离的池子拦成 suspicious / fake，避免把同名假币当机会。
- **决策/素材层**：对每条机会人工标记 已跟进/放弃/已执行/已结算，追加行动与真实盈亏日志，汇总已实现盈亏——跨自动扫描保留。
- **漏斗统计**：每次扫描给出 消息→转账→钱包→机会 的逐级沉淀漏斗与各阶段耗时拆解。

## 快速开始

### 环境要求

- **Node.js ≥ 22.5**（需要内置 `node:sqlite`；旧版本请在启动前自行确认支持）
- 境外数据源（DexScreener / Etherscan 等）在本机通常需走本地代理

### 运行

```bash
# 方式一：直接启动（监听 127.0.0.1:8848）
node --disable-warning=ExperimentalWarning server.js

# 方式二：Windows 双击 start.bat（自带代理环境变量，按需改）
start.bat
```

打开浏览器访问 <http://127.0.0.1:8848>。

### 需要走本地代理（境外接口）

```bash
HTTPS_PROXY=http://127.0.0.1:10808 HTTP_PROXY=http://127.0.0.1:10808 \
  node --disable-warning=ExperimentalWarning server.js
```

> 桥追踪层尽量免 Key：LayerZero / Wormhole / Hyperlane / Axelar 官方接口公开可用。
> 需要 Key 的源（Range、Etherscan V2）在页面的「设置」里填写后才会启用，缺 Key 时对应源自动跳过。

## Web 看板标签页

| 标签 | 说明 |
| --- | --- |
| 仪表盘 | 系统总览：钱包/转账/机会计数、数据源健康、设置 |
| 总览 | 跨链转账明细 |
| 钱包 | 追踪到的高价值钱包与代币持仓 |
| 机会 | 价差机会列表，含裁决徽标 + 每腿 explorer 合约链接 |
| 价差 | 某 symbol 的多链价差矩阵 |
| **决策** | 对每条机会标记跟进/执行/结算，记真实盈亏（跨扫描保留） |
| 管道 | 每次扫描的漏斗与阶段耗时 |

## 假币裁决模型

四档：`official`（官方注册表）`confirmed`（多源报价交叉确认）`suspicious`（报价偏离/存疑）`fake`（明确假币）。

核心锚点：优先取 verified 官方报价的中位数；无官方覆盖时退化为「全部报价的中位数 / 几何平均」交叉锚点；仅单源报价且非 verified 一律判 suspicious。该设计可堵住「同名不同价代币被误判成 confirmed」一类 bug。

## 项目结构

```
server.js           # HTTP 服务 + API + 定时扫描
lib/
  sources/          # 各桥数据源适配器（layerzero/wormhole/hyperlane/axelar/range/blockscan）
  engine.js         # 扫描漏斗：消息→转账→钱包→机会
  prices.js         # DexScreener 批量比价 + TTL 缓存 + 并发控制
  adjudicate.js     # 假币裁决（多来源报价锚点）
  resolver.js       # 代币地址→symbol 解析
  store.js / db.js  # 内存态 + SQLite 持久化（WAL，增量/全量）
public/             # 前端单页看板（纯原生 JS）
tools/              # 回归测试 / 诊断脚本
data/               # 运行期 SQLite 与备份（不入库）
```

## 测试

```bash
node tools/check-ids.js          # 前端 id 引用静态校验
node tools/test-pipeline.js      # 漏斗回归（44 项，部分需服务在跑）
node tools/test-prices-batch.js  # 批量比价（11 项，需外网）
node tools/test-best-verdict.js  # best 裁决证据字段（9 项）
node tools/test-adjudicate.js    # 裁决 5 场景
```

## 数据与隐私说明

- 数据全部本地存储于 `data/radar.db`（SQLite），不对外上报。
- 需要外部 API Key 的源在运行时于页面「设置」填写，写入本地 DB，不入源码。

## License

MIT
