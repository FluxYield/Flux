import { createLogger } from "../lib/logger.js";
import { config } from "../lib/config.js";
import type { AllocationPlan, Position, RebalanceAction } from "../lib/types.js";
import { randomUUID } from "crypto";

const logger = createLogger("rebalancer");
const positions = new Map<string, Position>();
let totalEarned = 0;

// Estimate whether an APY improvement is worth the gas cost of rebalancing.
// A rebalance requires at least 2 txs (close + open) at ~$0.01 each = $0.02 minimum.
// Over a 1-hour cycle, the improvement must earn more than gas cost.
// improvementApy: fractional APY gain (e.g. 0.02 = 2%). capitalUsd: amount being moved.
export function isRebalanceEconomic(
  improvementApy: number,
  capitalUsd: number,
  gasEstimateUsd = 0.02,
  periodHours = 1,
): boolean {
  const hourlyGain = capitalUsd * improvementApy / 8760 * periodHours;
  if (hourlyGain <= gasEstimateUsd) {
    logger.debug("Rebalance not economic", {
      hourlyGain: hourlyGain.toFixed(4),
      gasEstimateUsd,
      improvementApy: `${(improvementApy * 100).toFixed(2)}%`,
    });
    return false;
  }
  return true;
}

export function buildRebalanceActions(
  plan: AllocationPlan,
  current: Position[],
): RebalanceAction[] {
  const actions: RebalanceAction[] = [];

  // Close positions not in new plan
  for (const pos of current) {
    const inPlan = plan.allocations.find(
      (a) => a.protocol === pos.protocol && a.asset === pos.asset,
    );
    if (!inPlan) {
      actions.push({ type: "close", toProtocol: pos.protocol, asset: pos.asset, amountUsd: pos.amountUsd, reason: "not in optimal allocation" });
    }
  }

  // Open or shift for each allocation
  for (const alloc of plan.allocations) {
    const existing = current.find((p) => p.protocol === alloc.protocol && p.asset === alloc.asset);
    if (!existing) {
      actions.push({ type: "open", toProtocol: alloc.protocol, asset: alloc.asset, amountUsd: alloc.amountUsd, reason: alloc.rationale });
    } else if (Math.abs(existing.amountUsd - alloc.amountUsd) > 100) {
      actions.push({ type: "shift", fromProtocol: existing.protocol, toProtocol: alloc.protocol, asset: alloc.asset, amountUsd: alloc.amountUsd, reason: `rebalancing from $${existing.amountUsd} to $${alloc.amountUsd}` });
    }
  }

  return actions;
}

export function executePaperRebalance(plan: AllocationPlan): Position[] {
  if (!plan.rebalanceNeeded) {
    logger.info("No rebalance needed — holding current positions");
    return getOpenPositions();
  }

  positions.clear();

  for (const alloc of plan.allocations) {
    const pos: Position = {
      id: randomUUID(),
      protocol: alloc.protocol,
      asset: alloc.asset,
      mint: alloc.mint,
      amountUsd: alloc.amountUsd,
      entryApy: alloc.expectedApy,
      currentApy: alloc.expectedApy,
      earnedUsd: 0,
      openedAt: Date.now(),
      status: "active",
    };
    positions.set(pos.id, pos);

    if (config.PAPER_MODE) {
      logger.info(
        `[PAPER] OPEN ${alloc.protocol.toUpperCase()} ${alloc.asset} | $${alloc.amountUsd.toLocaleString()} @ ${(alloc.expectedApy * 100).toFixed(2)}% APY | ${alloc.rationale}`,
      );
    }
  }

  return Array.from(positions.values());
}

export function accrueYield(hoursSinceLastCycle: number) {
  for (const pos of positions.values()) {
    // Compound interest: P * ((1 + r)^t - 1) where r is hourly rate and t is hours.
    // Simple interest (prior model: P * r * t) underestimates by ~0.5% APY at 8% APR
    // and by ~2% APY at 30% APR — meaningful at larger capital amounts.
    const hourlyRate = pos.currentApy / 8760;
    const earned = pos.amountUsd * (Math.pow(1 + hourlyRate, hoursSinceLastCycle) - 1);
    pos.earnedUsd += earned;
    totalEarned += earned;
  }
}

export function getOpenPositions(): Position[] {
  return Array.from(positions.values()).filter((p) => p.status === "active");
}

export function getPortfolioStats() {
  const open = getOpenPositions();
  const totalDeployed = open.reduce((s, p) => s + p.amountUsd, 0);
  const blendedApy = totalDeployed > 0
    ? open.reduce((s, p) => s + p.currentApy * (p.amountUsd / totalDeployed), 0)
    : 0;

  return { totalDeployed, totalEarned, blendedApy, positionCount: open.length };
}
