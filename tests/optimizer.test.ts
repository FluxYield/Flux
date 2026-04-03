import { describe, it, expect } from "vitest";
import { getBestRatePerAsset, getRateMatrix } from "../src/optimizer/aggregator.js";
import { buildRebalanceActions } from "../src/execution/rebalancer.js";
import type { ProtocolRate, Position, AllocationPlan } from "../src/lib/types.js";

const mockRates: ProtocolRate[] = [
  { protocol: "kamino", asset: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", supplyApy: 0.082, borrowApy: 0.12, utilizationRate: 0.75, totalSupplyUsd: 50_000_000, totalBorrowUsd: 37_000_000, availableLiquidityUsd: 13_000_000, updatedAt: Date.now() },
  { protocol: "marginfi", asset: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", supplyApy: 0.071, borrowApy: 0.11, utilizationRate: 0.68, totalSupplyUsd: 30_000_000, totalBorrowUsd: 20_000_000, availableLiquidityUsd: 10_000_000, updatedAt: Date.now() },
  { protocol: "solend", asset: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", supplyApy: 0.059, borrowApy: 0.09, utilizationRate: 0.60, totalSupplyUsd: 20_000_000, totalBorrowUsd: 12_000_000, availableLiquidityUsd: 8_000_000, updatedAt: Date.now() },
  { protocol: "kamino", asset: "SOL", mint: "So11111111111111111111111111111111111111112", supplyApy: 0.065, borrowApy: 0.10, utilizationRate: 0.70, totalSupplyUsd: 100_000_000, totalBorrowUsd: 70_000_000, availableLiquidityUsd: 30_000_000, updatedAt: Date.now() },
];

describe("getBestRatePerAsset", () => {
  it("returns best APY per asset", () => {
    const best = getBestRatePerAsset(mockRates);
    expect(best.get("USDC")?.protocol).toBe("kamino");
    expect(best.get("USDC")?.supplyApy).toBe(0.082);
  });

  it("filters out rates below minimum threshold", () => {
    const lowRates: ProtocolRate[] = [
      { ...mockRates[0], supplyApy: 0.01 },
    ];
    const best = getBestRatePerAsset(lowRates);
    expect(best.size).toBe(0);
  });

  it("filters out low liquidity pools", () => {
    const dryPool: ProtocolRate[] = [
      { ...mockRates[0], availableLiquidityUsd: 500 },
    ];
    const best = getBestRatePerAsset(dryPool);
    expect(best.size).toBe(0);
  });
});

describe("getRateMatrix", () => {
  it("groups rates by asset sorted by APY", () => {
    const matrix = getRateMatrix(mockRates);
    const usdcRates = matrix.get("USDC")!;
    expect(usdcRates[0].supplyApy).toBeGreaterThanOrEqual(usdcRates[1].supplyApy);
  });

  it("includes all protocols for same asset", () => {
    const matrix = getRateMatrix(mockRates);
    expect(matrix.get("USDC")?.length).toBe(3);
  });
});

describe("buildRebalanceActions", () => {
  const plan: AllocationPlan = {
    allocations: [
      { protocol: "kamino", asset: "USDC", mint: "EPjFW...", amountUsd: 7000, expectedApy: 0.082, rationale: "best USDC rate" },
      { protocol: "kamino", asset: "SOL", mint: "So111...", amountUsd: 3000, expectedApy: 0.065, rationale: "SOL yield" },
    ],
    totalDeployed: 10000,
    expectedBlendedApy: 0.0763,
    rebalanceNeeded: true,
  };

  it("generates open action for new positions", () => {
    const actions = buildRebalanceActions(plan, []);
    expect(actions.every((a) => a.type === "open")).toBe(true);
    expect(actions.length).toBe(2);
  });

  it("generates close action for removed positions", () => {
    const current: Position[] = [
      { id: "1", protocol: "solend", asset: "USDC", mint: "EPjFW...", amountUsd: 5000, entryApy: 0.059, currentApy: 0.059, earnedUsd: 0, openedAt: Date.now(), status: "active" },
    ];
    const actions = buildRebalanceActions(plan, current);
    const closes = actions.filter((a) => a.type === "close");
    expect(closes.length).toBe(1);
    expect(closes[0].asset).toBe("USDC");
  });
});
