import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config.js";
import { createLogger } from "../lib/logger.js";
import type { ProtocolRate, Position, AllocationPlan } from "../lib/types.js";
import { FLUX_SYSTEM } from "./prompts.js";

const logger = createLogger("agent");
const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const tools: Anthropic.Tool[] = [
  {
    name: "get_rate_matrix",
    description: "Returns current supply APY for all assets across all protocols, sorted best to worst",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_current_positions",
    description: "Returns currently open yield positions with entry APY vs current APY",
    input_schema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "get_protocol_health",
    description: "Returns utilization rate and liquidity depth for a given protocol",
    input_schema: {
      type: "object" as const,
      properties: { protocol: { type: "string" } },
      required: ["protocol"],
    },
  },
  {
    name: "submit_allocation_plan",
    description: "Submit the final yield allocation plan",
    input_schema: {
      type: "object" as const,
      properties: {
        allocations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              protocol: { type: "string" },
              asset: { type: "string" },
              mint: { type: "string" },
              amountUsd: { type: "number" },
              expectedApy: { type: "number" },
              rationale: { type: "string" },
            },
          },
        },
        totalDeployed: { type: "number" },
        expectedBlendedApy: { type: "number" },
        rebalanceNeeded: { type: "boolean" },
      },
      required: ["allocations", "totalDeployed", "expectedBlendedApy", "rebalanceNeeded"],
    },
  },
];

export async function planAllocation(
  rates: ProtocolRate[],
  positions: Position[],
): Promise<AllocationPlan | null> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Analyze current DeFi rates and optimize yield allocation for $${config.TOTAL_CAPITAL_USD.toLocaleString()} capital pool. Current positions: ${positions.length}. Use your tools to fetch live data and submit an allocation plan.`,
    },
  ];

  let plan: AllocationPlan | null = null;

  for (let i = 0; i < 8; i++) {
    const response = await client.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 2048,
      system: FLUX_SYSTEM,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason !== "tool_use") break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      let result: unknown;

      switch (block.name) {
        case "get_rate_matrix": {
          const matrix: Record<string, Array<{ protocol: string; apy: number; utilization: number }>> = {};
          for (const r of rates) {
            if (!matrix[r.asset]) matrix[r.asset] = [];
            matrix[r.asset].push({ protocol: r.protocol, apy: r.supplyApy, utilization: r.utilizationRate });
          }
          for (const asset in matrix) {
            matrix[asset].sort((a, b) => b.apy - a.apy);
          }
          result = matrix;
          break;
        }

        case "get_current_positions":
          result = positions.map((p) => ({
            protocol: p.protocol,
            asset: p.asset,
            amountUsd: p.amountUsd,
            entryApy: p.entryApy,
            currentApy: p.currentApy,
            drift: p.currentApy - p.entryApy,
          }));
          break;

        case "get_protocol_health": {
          const input = block.input as { protocol: string };
          const protocolRates = rates.filter((r) => r.protocol === input.protocol);
          result = {
            protocol: input.protocol,
            avgUtilization: protocolRates.reduce((s, r) => s + r.utilizationRate, 0) / (protocolRates.length || 1),
            totalLiquidityUsd: protocolRates.reduce((s, r) => s + r.availableLiquidityUsd, 0),
            assetsAvailable: protocolRates.map((r) => r.asset),
          };
          break;
        }

        case "submit_allocation_plan":
          plan = block.input as AllocationPlan;
          result = { accepted: true };
          break;

        default:
          result = { error: "unknown tool" };
      }

      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }

    messages.push({ role: "user", content: toolResults });
    if (plan) break;
  }

  return plan;
}
