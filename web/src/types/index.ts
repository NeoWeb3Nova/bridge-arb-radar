export type AdjudicationVerdict = 'official' | 'confirmed' | 'suspicious' | 'fake';

export interface ChainInfo {
  key: string;
  name: string;
}

export interface TransferItem {
  id: string;
  txHash: string;
  timestamp: string | null;
  source: string;
  fromChain: string | null;
  toChain: string | null;
  tokenSymbol: string | null;
  tokenAddress: string | null;
  sender: string | null;
  receiver: string | null;
  amount: number | null;
  amountUsd: number | null;
  app?: string;
  explorer?: string;
}

export interface OpportunityItem {
  symbol: string;
  buyChain: string;
  buyChainName: string;
  buyPrice: number;
  buyDex: string;
  buyUrl: string;
  buyAddress: string | null;
  buyExplorer: string | null;
  buyVerdict: AdjudicationVerdict;
  sellChain: string;
  sellChainName: string;
  sellPrice: number;
  sellDex: string;
  sellUrl: string;
  sellAddress: string | null;
  sellExplorer: string | null;
  sellVerdict: AdjudicationVerdict;
  spreadPct: number;
  minLiquidityUsd: number;
  buyLiquidityUsd?: number;
  sellLiquidityUsd?: number;
  buyVolume24h?: number;
  sellVolume24h?: number;
  minVolume24h?: number;
  buyVolume6h?: number;
  sellVolume6h?: number;
  minVolume6h?: number;
  buyTxns24h?: number;
  sellTxns24h?: number;
  buyBaseReserveUsd?: number;
  buyQuoteReserveUsd?: number;
  buyQuoteSymbol?: string | null;
  buyQuoteRatio?: number;
  buyPriceNative?: number | null;
  buyQuotePriceUsd?: number | null;
  sellBaseReserveUsd?: number;
  sellQuoteReserveUsd?: number;
  sellQuoteSymbol?: string | null;
  sellQuoteRatio?: number;
  sellPriceNative?: number | null;
  sellQuotePriceUsd?: number | null;
  buyPairAddress?: string | null;
  sellPairAddress?: string | null;
  buyPoolFee?: number | null;
  sellPoolFee?: number | null;
  buyPoolType?: string | null;
  sellPoolType?: string | null;
  poolFeeTrap?: boolean;
  poolSkewed?: boolean;
  isSymbolCollision?: boolean;
  collisionRisk?: boolean;
  collisionReason?: string | null;
  buyTokenName?: string | null;
  sellTokenName?: string | null;
  suspicious: boolean;
  verdict: AdjudicationVerdict;
  verified: boolean;
  heuristic: boolean;
  hits?: number;
  ts?: string;
  tokenKey?: string;
  decision?: DecisionItem | null;
  qualityScore?: number;
  qualityGrade?: 'S' | 'A' | 'B' | 'C' | 'D';
  scoreComment?: string;
  security?: SecurityCheckResult;
}

export interface LiveQuoteResult {
  ok: boolean;
  symbol: string;
  buyChain: string;
  buyAddress?: string;
  sellChain: string;
  sellAddress?: string;
  snapshot: {
    buyPrice: number | null;
    sellPrice: number | null;
    spreadPct: number | null;
    ts?: string | null;
  };
  live: {
    buyPrice: number;
    sellPrice: number;
    spreadPct: number;
    tokenAmount?: number;
    buyDex?: string;
    sellDex?: string;
    buyPairAddress?: string | null;
    sellPairAddress?: string | null;
    buyPoolFee?: number | null;
    sellPoolFee?: number | null;
    buyPoolType?: string | null;
    sellPoolType?: string | null;
    buyTax?: number;
    sellTax?: number;
    isTrapPool?: boolean;
    buyLiquidityUsd?: number;
    sellLiquidityUsd?: number;
    buyVolume24h?: number;
    sellVolume24h?: number;
    buyPairUrl?: string;
    sellPairUrl?: string;
    updatedAt: number;
  } | null;
  drift: {
    buyPriceDeltaPct: number;
    sellPriceDeltaPct: number;
    spreadDeltaPct: number;
  } | null;
  bridge: {
    bridgeName: string;
    bridgeFeeUsd: number;
    gasFeeUsd: number;
    totalCostUsd: number;
    etaSeconds: number;
    isLiveQuote: boolean;
  } | null;
  simulation: {
    principalUsd: number;
    grossProfitUsd: number;
    bridgeCostUsd?: number;
    dexFrictionCostUsd?: number;
    buyFrictionUsd?: number;
    sellFrictionUsd?: number;
    totalCostUsd: number;
    netProfitUsd: number;
    netYieldPct: number;
    isTrapPool?: boolean;
  } | null;
  status: 'ACTIVE' | 'NARROWED' | 'INVERTED' | 'LIQUIDITY_DROP' | 'TRAP_POOL' | 'UNAVAILABLE';
  statusMessage: string;
  checkedAt: string;
}

export interface TokenSecurityDetail {
  safe: boolean;
  isHoneypot: boolean;
  buyTax: number;
  sellTax: number;
  poolFee?: number | null;
  poolFeePct?: number | null;
  poolType?: string | null;
  isTrapPool?: boolean;
  isHighFeePool?: boolean;
  trapPoolsCount?: number;
  cannotSellAll?: boolean;
  isOpenSource?: boolean;
  isBlacklisted?: boolean;
  isProxy?: boolean;
  transferPausable?: boolean;
  freezable?: boolean;
  isTrusted?: boolean;
  riskLevel: 'safe' | 'warning' | 'danger';
  riskReason?: string;
  checkedAt?: string;
}

export interface SecurityCheckResult {
  safe: boolean;
  hasRisk: boolean;
  isHoneypot: boolean;
  isTrapPool?: boolean;
  riskLevel: 'safe' | 'warning' | 'danger';
  riskReason?: string;
  buySecurity?: TokenSecurityDetail | null;
  sellSecurity?: TokenSecurityDetail | null;
  checkedAt?: string;
}

export interface DecisionItem {
  key?: string;
  status: 'todo' | 'watching' | 'executed' | 'closed' | 'dropped';
  note?: string;
  journal?: Array<{ ts: string; text: string; status?: string; pnlDeltaUsd?: number }>;
  realizedPnlUsd?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface WalletScoreBreakdown {
  cycle: number;
  activity: number;
  exotic: number;
  scale: number;
  recency: number;
}

export interface WalletItem {
  address: string;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  score: number;
  scoreBreakdown?: WalletScoreBreakdown;
  bridgeCount: number;
  capitalCycles: number;
  roundtrips: number;
  tokenCount: number;
  chainCount: number;
  exoticCount: number;
  lastSeen: string | null;
  firstSeen: string | null;
  likelyContract: boolean;
  autoTags: string[];
  tags: string[];
  notes: string;
  starred: boolean;
  maxUsd: number;
}

export interface PipelineReport {
  added: number;
  walletsNew: number;
  tokensNew: number;
  opportunitiesNew?: number;
  timings?: {
    fetchMs: number;
    storeMs: number;
    priceMs: number;
    totalMs: number;
  };
  funnel?: Array<{
    key: string;
    label: string;
    unit: string;
    in: number;
    out: number;
    note: string;
  }>;
}

export interface PipelineState {
  scanning: boolean;
  autoEnabled: boolean;
  intervalMin: number;
  nextScanAt: string | null;
  lastScanAt: string | null;
  lastScan: PipelineReport | null;
  funnel: Array<{ key: string; label: string; unit: string; in: number; out: number; note: string }>;
  counts: {
    transfers: number;
    wallets: number;
    tokens: number;
    opportunities: number;
  };
}

export interface WebNotificationConfig {
  enabled: boolean;
  sound: boolean;
}

export interface TelegramNotificationConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface NotificationSettings {
  web: WebNotificationConfig;
  telegram: TelegramNotificationConfig;
  minSpreadPct: number;
}

export interface AppSettings {
  proxyUrl?: string;
  useProxy?: boolean;
  keys?: Record<string, string>;
  hasKeys?: Record<string, boolean>;
  sources?: Record<string, { enabled?: boolean }>;
  scan?: { intervalMin?: number; autoScan?: boolean; minSpreadPct?: number };
  endpoints?: Record<string, string>;
  notifications?: NotificationSettings;
  stablecoins?: string[];
}

export interface AppState {
  chains: ChainInfo[];
  counts: {
    wallets: number;
    walletsA: number;
    tokens: number;
    unknownTokens: number;
    transfers: number;
    opportunities: number;
    decisions: number;
    transfers24h: number;
    maxTransfers?: number;
    decisionLogs?: number;
    realizedPnlUsd?: number;
  };
  scanning: boolean;
  lastScanAt: string | null;
  opportunities: OpportunityItem[];
  topWallets: WalletItem[];
  settings?: AppSettings;
}
