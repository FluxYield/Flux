import { createLogger } from "../lib/logger.js";
import type { ProtocolRate } from "../lib/types.js";

const logger = createLogger("kamino");

const KAMINO_API = "https://api.kamino.finance";

interface KaminoMarket {
  symbol: string;
  mintAddress: string;
  supplyInterestAPY: number;
  borrowInterestAPY: number;
  utilizationRate: number;
  totalSupply: number;
  totalBorrows: number;
  liquidityAvailable: number;
  tokenPrice: number;
}

export async function fetchKaminoRates(): Promise<ProtocolRate[]> {
  try {
    const res = await fetch(`${KAMINO_API}/v2/lending-markets/main/reserves`);
    if (!res.ok) throw new Error(`Kamino API ${res.status}`);
    const data: KaminoMarket[] = await res.json();

    return data.map((m) => {
      const availableLiquidityUsd = m.liquidityAvailable * m.tokenPrice;
      const totalSupplyUsd = m.totalSupply * m.tokenPrice;

      // Utilization spike warning: if utilization > 85% AND available liquidity < 5% of
      // total supply, the market is close to a withdrawal freeze. APY looks high because
      // the interest rate model is forcing rates up to attract deposits — not because
      // the underlying yield is genuine.
      if (m.utilizationRate > 0.85 && totalSupplyUsd > 0 && availableLiquidityUsd / totalSupplyUsd < 0.05) {
        logger.warn("Kamino market utilization spike — possible withdrawal risk", {
          asset: m.symbol,
          utilization: `${(m.utilizationRate * 100).toFixed(1)}%`,
          availableLiquidityUsd: availableLiquidityUsd.toFixed(0),
        });
      }

      return {
        protocol: "kamino" as const,
        asset: m.symbol,
        mint: m.mintAddress,
        supplyApy: m.supplyInterestAPY,
        borrowApy: m.borrowInterestAPY,
        utilizationRate: m.utilizationRate,
        totalSupplyUsd,
        totalBorrowUsd: m.totalBorrows * m.tokenPrice,
        availableLiquidityUsd,
        updatedAt: Date.now(),
      };
    });
  } catch (err) {
    logger.error("Failed to fetch Kamino rates", err);
    return [];
  }
}
