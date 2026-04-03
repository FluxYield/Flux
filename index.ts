import { config } from "./src/lib/config.js";
import { createLogger } from "./src/lib/logger.js";
import { fetchAllRates } from "./src/optimizer/aggregator.js";
import { planAllocation } from "./src/agent/loop.js";
import {
  executePaperRebalance,
  getOpenPositions,
  getPortfolioStats,
  accrueYield,
} from "./src/execution/rebalancer.js";

const logger = createLogger("flux");
let lastCycleAt = Date.now();

async function cycle() {
  logger.info("─── Optimization cycle ───────────────────────────────");

  const hoursSinceLast = (Date.now() - lastCycleAt) / 3600000;
  accrueYield(hoursSinceLast);
  lastCycleAt = Date.now();

  const rates = await fetchAllRates();
  if (rates.length === 0) {
    logger.warn("No rates fetched — skipping cycle");
    return;
  }

  const positions = getOpenPositions();
  logger.info(`Fetched ${rates.length} rates | ${positions.length} open positions`);

  const plan = await planAllocation(rates, positions);
  if (!plan) {
    logger.warn("Agent returned no allocation plan");
    return;
  }

  logger.info(
    `Plan: ${plan.allocations.length} allocations | blended APY ${(plan.expectedBlendedApy * 100).toFixed(2)}% | rebalance=${plan.rebalanceNeeded}`,
  );

  executePaperRebalance(plan);

  const stats = getPortfolioStats();
  logger.info(
    `Portfolio: $${stats.totalDeployed.toLocaleString()} deployed | ${(stats.blendedApy * 100).toFixed(2)}% APY | $${stats.totalEarned.toFixed(2)} earned`,
  );
}

async function main() {
  logger.info("Flux starting...");
  logger.info(`Mode: ${config.PAPER_MODE ? "PAPER" : "LIVE"} | Capital: $${config.TOTAL_CAPITAL_USD.toLocaleString()} | Interval: ${config.CYCLE_INTERVAL_MS / 60000}m`);

  await cycle();
  setInterval(cycle, config.CYCLE_INTERVAL_MS);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
