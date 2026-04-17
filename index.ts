import { config } from "./src/lib/config.js";
import { createLogger } from "./src/lib/logger.js";
import { fetchAllRates } from "./src/optimizer/aggregator.js";
import { planAllocation } from "./src/agent/loop.js";
import {
  accrueYield,
  executePaperRebalance,
  getOpenPositions,
  getPortfolioStats,
} from "./src/execution/rebalancer.js";

const logger = createLogger("flux");
let lastCycleAt = Date.now();

async function cycle() {
  logger.info("─── Optimization cycle ───────────────────────");
  const cycleStartedAt = Date.now();

  try {
    const hoursSinceLast = (cycleStartedAt - lastCycleAt) / 3_600_000;
    accrueYield(hoursSinceLast);
    lastCycleAt = cycleStartedAt;

    const rates = await fetchAllRates();
    if (rates.length === 0) {
      logger.warn("No rates fetched - skipping cycle");
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
  } finally {
    const durationMs = Date.now() - cycleStartedAt;
    logger.info("Flux cycle complete", { durationMs });

    if (durationMs > config.CYCLE_INTERVAL_MS) {
      logger.warn("Flux cycle exceeded configured interval", {
        durationMs,
        intervalMs: config.CYCLE_INTERVAL_MS,
      });
    }
  }
}

async function main() {
  logger.info("Flux starting...");
  logger.info(
    `Mode: ${config.PAPER_MODE ? "PAPER" : "LIVE"} | Capital: $${config.TOTAL_CAPITAL_USD.toLocaleString()} | Interval: ${config.CYCLE_INTERVAL_MS / 60000}m`,
  );

  let cycleInFlight = false;
  let skippedCycles = 0;

  const tick = async () => {
    if (cycleInFlight) {
      skippedCycles++;
      logger.warn("Skipping optimization tick because the previous cycle is still running", {
        skippedCycles,
      });
      return;
    }

    cycleInFlight = true;
    try {
      await cycle();
    } catch (err) {
      logger.error("Optimization cycle failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      cycleInFlight = false;
    }
  };

  await tick();
  setInterval(() => {
    void tick();
  }, config.CYCLE_INTERVAL_MS);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
