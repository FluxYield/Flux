import { createLogger } from "../lib/logger.js";
import type { ProtocolRate } from "../lib/types.js";

const logger = createLogger("solend");

const SOLEND_API = "https://api.solend.fi";

interface SolendReserve {
  symbol: string;
  mintAddress: string;
  supplyInterestAPY: string;
  borrowInterestAPY: string;
  utilizationRatio: string;
  totalDeposit: string;
  totalBorrow: string;
  availableAmount: string;
  assetPriceUSD: string;
}

export async function fetchSolendRates(): Promise<ProtocolRate[]> {
  try {
    const res = await fetch(`${SOLEND_API}/v1/reserves?ids=main`);
    if (!res.ok) throw new Error(`Solend API ${res.status}`);
    const data: { results: SolendReserve[] } = await res.json();

    return (data.results ?? []).map((r) => {
      const price = parseFloat(r.assetPriceUSD);
      // Solend's API returns string decimals — parse carefully.
      // availableAmount is token units, not USD — multiply by price.
      const availableLiquidityUsd = parseFloat(r.availableAmount) * price;
      const utilizationRate = parseFloat(r.utilizationRatio);

      if (utilizationRate > 0.88) {
        logger.warn("Solend reserve near utilization cap", {
          asset: r.symbol,
          utilization: `${(utilizationRate * 100).toFixed(1)}%`,
          availableLiquidityUsd: availableLiquidityUsd.toFixed(0),
        });
      }

      return {
        protocol: "solend" as const,
        asset: r.symbol,
        mint: r.mintAddress,
        supplyApy: parseFloat(r.supplyInterestAPY),
        borrowApy: parseFloat(r.borrowInterestAPY),
        utilizationRate,
        totalSupplyUsd: parseFloat(r.totalDeposit) * price,
        totalBorrowUsd: parseFloat(r.totalBorrow) * price,
        availableLiquidityUsd,
        updatedAt: Date.now(),
      };
    });
  } catch (err) {
    logger.error("Failed to fetch Solend rates", err);
    return [];
  }
}
