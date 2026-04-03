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
      return {
        protocol: "solend" as const,
        asset: r.symbol,
        mint: r.mintAddress,
        supplyApy: parseFloat(r.supplyInterestAPY),
        borrowApy: parseFloat(r.borrowInterestAPY),
        utilizationRate: parseFloat(r.utilizationRatio),
        totalSupplyUsd: parseFloat(r.totalDeposit) * price,
        totalBorrowUsd: parseFloat(r.totalBorrow) * price,
        availableLiquidityUsd: parseFloat(r.availableAmount) * price,
        updatedAt: Date.now(),
      };
    });
  } catch (err) {
    logger.error("Failed to fetch Solend rates", err);
    return [];
  }
}
