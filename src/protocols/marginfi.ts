import { createLogger } from "../lib/logger.js";
import type { ProtocolRate } from "../lib/types.js";

const logger = createLogger("marginfi");

const MARGINFI_API = "https://production.marginfi.com/v1";

interface MarginfiBank {
  address: string;
  tokenSymbol: string;
  tokenMint: string;
  lendingRate: number;
  borrowingRate: number;
  utilizationRate: number;
  totalDepositsUsd: number;
  totalBorrowsUsd: number;
  freeCollateralUsd: number;
}

export async function fetchMarginfiRates(): Promise<ProtocolRate[]> {
  try {
    const res = await fetch(`${MARGINFI_API}/banks`);
    if (!res.ok) throw new Error(`MarginFi API ${res.status}`);
    const data: { banks: MarginfiBank[] } = await res.json();

    return (data.banks ?? []).map((b) => ({
      protocol: "marginfi" as const,
      asset: b.tokenSymbol,
      mint: b.tokenMint,
      supplyApy: b.lendingRate,
      borrowApy: b.borrowingRate,
      utilizationRate: b.utilizationRate,
      totalSupplyUsd: b.totalDepositsUsd,
      totalBorrowUsd: b.totalBorrowsUsd,
      availableLiquidityUsd: b.freeCollateralUsd,
      updatedAt: Date.now(),
    }));
  } catch (err) {
    logger.error("Failed to fetch MarginFi rates", err);
    return [];
  }
}
