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

    return data.map((m) => ({
      protocol: "kamino" as const,
      asset: m.symbol,
      mint: m.mintAddress,
      supplyApy: m.supplyInterestAPY,
      borrowApy: m.borrowInterestAPY,
      utilizationRate: m.utilizationRate,
      totalSupplyUsd: m.totalSupply * m.tokenPrice,
      totalBorrowUsd: m.totalBorrows * m.tokenPrice,
      availableLiquidityUsd: m.liquidityAvailable * m.tokenPrice,
      updatedAt: Date.now(),
    }));
  } catch (err) {
    logger.error("Failed to fetch Kamino rates", err);
    return [];
  }
}
