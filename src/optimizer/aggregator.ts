import { config } from "../lib/config.js";
import { createLogger } from "../lib/logger.js";
import type { ProtocolRate } from "../lib/types.js";
import { fetchKaminoRates } from "../protocols/kamino.js";
import { fetchMarginfiRates } from "../protocols/marginfi.js";
import { fetchSolendRates } from "../protocols/solend.js";

const logger = createLogger("aggregator");

export async function fetchAllRates(): Promise<ProtocolRate[]> {
  const fetchers: Promise<ProtocolRate[]>[] = [];

  if (config.ENABLE_KAMINO) fetchers.push(fetchKaminoRates());
  if (config.ENABLE_MARGINFI) fetchers.push(fetchMarginfiRates());
  if (config.ENABLE_SOLEND) fetchers.push(fetchSolendRates());

  const results = await Promise.allSettled(fetchers);
  const rates: ProtocolRate[] = [];

  for (const r of results) {
    if (r.status === "fulfilled") rates.push(...r.value);
    else logger.warn("Protocol fetch failed", r.reason);
  }

  logger.info(`Aggregated ${rates.length} rates across ${new Set(rates.map((r) => r.protocol)).size} protocols`);
  return rates;
}

// Risk-adjusted APY: penalises markets with high utilization.
// At 95% utilization, withdrawal is unreliable — treat that market as if the APY
// is 40% lower. Formula: riskAdjustedApy = supplyApy * (1 - max(0, u - 0.7) / 0.3)
// where u is utilizationRate. Below 70% utilization: no penalty.
export function riskAdjustedApy(rate: ProtocolRate): number {
  if (rate.utilizationRate <= 0.70) return rate.supplyApy;
  const utilizationPenalty = (rate.utilizationRate - 0.70) / 0.30; // 0→1 between 70–100%
  return rate.supplyApy * (1 - utilizationPenalty * 0.40);
}

export function getBestRatePerAsset(rates: ProtocolRate[]): Map<string, ProtocolRate> {
  const best = new Map<string, ProtocolRate>();

  for (const rate of rates) {
    if (rate.supplyApy < config.MIN_APY_THRESHOLD) continue;
    if (rate.availableLiquidityUsd < config.MIN_AVAILABLE_LIQUIDITY_USD) continue;
    if (rate.utilizationRate > config.MAX_UTILIZATION_RATE) continue;

    const existing = best.get(rate.asset);
    // Compare by risk-adjusted APY, not raw APY
    if (!existing || riskAdjustedApy(rate) > riskAdjustedApy(existing)) {
      best.set(rate.asset, rate);
    }
  }

  return best;
}

export function getRateMatrix(rates: ProtocolRate[]): Map<string, ProtocolRate[]> {
  const matrix = new Map<string, ProtocolRate[]>();

  for (const rate of rates) {
    const existing = matrix.get(rate.asset) ?? [];
    existing.push(rate);
    matrix.set(rate.asset, existing.sort((a, b) => b.supplyApy - a.supplyApy));
  }

  return matrix;
}
