import { z } from "zod";

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  HELIUS_API_KEY: z.string().min(1),
  SOLANA_RPC_URL: z.string().url(),
  CLAUDE_MODEL: z.string().default("claude-sonnet-4-5-20251001"),
  PAPER_MODE: z.coerce.boolean().default(true),
  CYCLE_INTERVAL_MS: z.coerce.number().default(3600000), // 1 hour
  TOTAL_CAPITAL_USD: z.coerce.number().default(10000),
  MIN_APY_THRESHOLD: z.coerce.number().default(0.05),   // 5% minimum to bother
  REBALANCE_THRESHOLD: z.coerce.number().default(0.02), // rebalance if APY diff > 2%
  MAX_PROTOCOL_ALLOCATION_PCT: z.coerce.number().default(0.50), // 50% max per protocol
  ENABLE_KAMINO: z.coerce.boolean().default(true),
  ENABLE_MARGINFI: z.coerce.boolean().default(true),
  ENABLE_SOLEND: z.coerce.boolean().default(true),
  ENABLE_DRIFT: z.coerce.boolean().default(false),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid config: ${missing}`);
  }
  return result.data;
}

export const config = loadConfig();
