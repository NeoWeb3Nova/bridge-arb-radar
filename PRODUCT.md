# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are DeFi arbitrage traders and Web3 on-chain operators. They monitor multi-chain bridge activity and DEX pools to capture cross-chain price discrepancies, while requiring strict anti-scam fake token verification and wallet tracking to avoid rug-pulls and bad debt.

## Product Purpose

`bridge-arb-radar` provides an end-to-end intelligence and decision cockpit for cross-chain arbitrage:
1. Aggregate multi-bridge transfers (LayerZero, Wormhole, Hyperlane, Axelar, Range, Blockscan).
2. Filter for non-mainstream/high-potential tokens and compute cross-chain DEX spreads via DexScreener.
3. Protect traders using a 4-tier fake token adjudication engine (`official`, `confirmed`, `suspicious`, `fake`).
4. Support manual execution tracking and real PnL ledger persistence across scans.
5. Identify high-scoring smart wallets exhibiting closed-loop cross-chain arbitrage behavior.

Success means traders can rapidly discover legitimate, high-spread cross-chain opportunities without falling victim to fake-token pool traps.

## Positioning

A lightweight, zero-dependency, local-first bridge arbitrage intelligence station combining multi-bridge real-time stream tracking, multi-source price consensus anchors for fake token defense, and persistent personal decision/PnL logging.

## Operating Context

- **Environment**: Desktop web browser dashboard running locally against a local Node.js backend (`http://127.0.0.1:8848`).
- **Data storage**: Local SQLite database (`node:sqlite`, WAL mode) preserving wallet grades, tagged tokens, and trade decisions across scans.
- **Network**: Direct bridge public APIs (no keys required for major bridges), DexScreener batch endpoints, optional proxy for overseas access, optional user-supplied API keys for Range / Etherscan V2.

## Capabilities and Constraints

- **Capabilities**:
  - Multi-bridge stream monitoring (LayerZero, Wormhole, Hyperlane, Axelar, Range, Blockscan).
  - Cross-chain DEX price comparison & spread calculation.
  - Multi-source anchor token adjudication (`official` / `confirmed` / `suspicious` / `fake`).
  - Wallet scoring, roundtrip/cycle detection, and DeBank / explorer quick navigation.
  - Decision ledger with status tracking (`followed`, `abandoned`, `executed`, `settled`) and realized PnL aggregation.
  - Scan pipeline funnel metrics and latency breakdown.
- **Constraints**:
  - Pure Node.js (≥ 22.5) with zero external npm runtime dependencies.
  - Read-only analytics & decision assistant: does not hold private keys, manage signing, or execute automated on-chain transactions directly.

## Brand Commitments

- **Name**: Bridge Arb Radar (跨链桥套利雷达)
- **Visual & Tone**: Utilitarian, dense, fast, and terminal/trader-focused. High data density, clear status differentiation (especially adjudication badges and spread indicators), and zero extraneous noise.

## Evidence on Hand

- Fully functional local Node.js backend with built-in SQLite persistence (`server.js`, `lib/`).
- Native vanilla JavaScript frontend dashboard (`public/index.html`, `public/app.js`, `public/styles.css`).
- Automated pipeline & adjudication test suites in `tools/`.

## Product Principles

1. **Defense First (No Fake Traps)**: High spreads mean nothing if the counterparty pool is a honeypot or misattributed token. Adjudication accuracy precedes spread discovery.
2. **Local & Private**: All wallet tags, custom tokens, and trading decisions stay strictly in local SQLite.
3. **High Information Density**: Built for fast scanning by active traders; metrics, explorer links, and action buttons must be accessible with minimal clicks.
4. **Resilient Pipeline**: Graceful degradation when external bridge endpoints or proxy connections fail.
