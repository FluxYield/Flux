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

export function getBestRatePerAsset(rates: ProtocolRate[]): Map<string, ProtocolRate> {
  const best = new Map<string, ProtocolRate>();

  for (const rate of rates) {
    if (rate.supplyApy < config.MIN_APY_THRESHOLD) continue;
    if (rate.availableLiquidityUsd < 10_000) continue;

    const existing = best.get(rate.asset);
    if (!existing || rate.supplyApy > existing.supplyApy) {
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
