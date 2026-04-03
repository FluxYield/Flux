export type Protocol = "kamino" | "marginfi" | "solend" | "drift";

export interface ProtocolRate {
  protocol: Protocol;
  asset: string;
  mint: string;
  supplyApy: number;
  borrowApy: number;
  utilizationRate: number;
  totalSupplyUsd: number;
  totalBorrowUsd: number;
  availableLiquidityUsd: number;
  updatedAt: number;
}

export interface Position {
  id: string;
  protocol: Protocol;
  asset: string;
  mint: string;
  amountUsd: number;
  entryApy: number;
  currentApy: number;
  earnedUsd: number;
  openedAt: number;
  status: "active" | "rebalancing" | "closed";
}

export interface AllocationPlan {
  allocations: Array<{
    protocol: Protocol;
    asset: string;
    mint: string;
    amountUsd: number;
    expectedApy: number;
    rationale: string;
  }>;
  totalDeployed: number;
  expectedBlendedApy: number;
  rebalanceNeeded: boolean;
}

export interface RebalanceAction {
  type: "open" | "close" | "shift";
  fromProtocol?: Protocol;
  toProtocol: Protocol;
  asset: string;
  amountUsd: number;
  reason: string;
}

export interface PortfolioSnapshot {
  timestamp: number;
  totalDeployedUsd: number;
  totalEarnedUsd: number;
  blendedApy: number;
  positions: Position[];
  topRate: ProtocolRate;
}
