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
  suspicious: boolean;
  verdict: AdjudicationVerdict;
  verified: boolean;
  heuristic: boolean;
  hits?: number;
  ts?: string;
  tokenKey?: string;
  decision?: DecisionItem | null;
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

export interface WalletItem {
  address: string;
  grade: 'A' | 'B' | 'C' | 'D';
  score: number;
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
  };
  scanning: boolean;
  lastScanAt: string | null;
  opportunities: OpportunityItem[];
  topWallets: WalletItem[];
}
