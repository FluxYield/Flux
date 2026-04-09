import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config.js";
import { createLogger } from "../lib/logger.js";
import type { Protocol, ProtocolRate, Position, AllocationPlan } from "../lib/types.js";
import { FLUX_SYSTEM } from "./prompts.js";
import { getRateMatrix, riskAdjustedApy } from "../optimizer/aggregator.js";
import { buildRebalanceActions, isRebalanceEconomic } from "../execution/rebalancer.js";

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
          for (const [asset, assetRates] of getRateMatrix(rates)) {
            matrix[asset] = assetRates.map((rate) => ({
              protocol: rate.protocol,
              apy: riskAdjustedApy(rate),
              utilization: rate.utilizationRate,
            }));
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
          try {
            plan = validateAllocationPlan(block.input as AllocationPlan, rates, positions);
            result = { accepted: true, normalized: plan };
          } catch (error) {
            result = { accepted: false, error: String(error) };
          }
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

function validateAllocationPlan(
  candidate: AllocationPlan,
  rates: ProtocolRate[],
  positions: Position[]
): AllocationPlan {
  const enabledProtocols = new Set<Protocol>();
  if (config.ENABLE_KAMINO) enabledProtocols.add("kamino");
  if (config.ENABLE_MARGINFI) enabledProtocols.add("marginfi");
  if (config.ENABLE_SOLEND) enabledProtocols.add("solend");
  if (config.ENABLE_DRIFT) enabledProtocols.add("drift");

  const allocations = candidate.allocations.map((allocation) => {
    if (!enabledProtocols.has(allocation.protocol)) {
      throw new Error(`Protocol ${allocation.protocol} is not enabled`);
    }

    const rate = rates.find(
      (item) =>
        item.protocol === allocation.protocol &&
        item.asset === allocation.asset &&
        item.mint === allocation.mint
    );
    if (!rate) {
      throw new Error(`No live rate found for ${allocation.protocol}/${allocation.asset}`);
    }

    return {
      ...allocation,
      expectedApy: riskAdjustedApy(rate),
      amountUsd: Number(allocation.amountUsd),
    };
  });

  const totalDeployed = Number(
    allocations.reduce((sum, allocation) => sum + allocation.amountUsd, 0).toFixed(2)
  );
  if (totalDeployed > config.TOTAL_CAPITAL_USD) {
    throw new Error(`Plan deploys $${totalDeployed}, above capital limit $${config.TOTAL_CAPITAL_USD}`);
  }

  const protocolTotals = new Map<Protocol, number>();
  for (const allocation of allocations) {
    protocolTotals.set(
      allocation.protocol,
      (protocolTotals.get(allocation.protocol) ?? 0) + allocation.amountUsd
    );
  }

  for (const [protocol, amount] of protocolTotals) {
    if (totalDeployed > 0 && amount / totalDeployed > config.MAX_PROTOCOL_ALLOCATION_PCT) {
      throw new Error(`Protocol ${protocol} exceeds max allocation cap`);
    }
  }

  const expectedBlendedApy =
    totalDeployed > 0
      ? allocations.reduce((sum, allocation) => sum + allocation.expectedApy * (allocation.amountUsd / totalDeployed), 0)
      : 0;

  const normalized: AllocationPlan = {
    allocations,
    totalDeployed,
    expectedBlendedApy,
    rebalanceNeeded: false,
  };

  const actions = buildRebalanceActions(normalized, positions);
  const capitalMoved = actions.reduce((sum, action) => sum + action.amountUsd, 0);
  const currentDeployed = positions.reduce((sum, position) => sum + position.amountUsd, 0);
  const currentBlendedApy =
    currentDeployed > 0
      ? positions.reduce((sum, position) => sum + position.currentApy * (position.amountUsd / currentDeployed), 0)
      : 0;
  const improvementApy = Math.max(expectedBlendedApy - currentBlendedApy, 0);
  const hasMaterialDiff = actions.length > 0 || positions.length === 0;

  normalized.rebalanceNeeded =
    hasMaterialDiff &&
    (positions.length === 0 ||
      (improvementApy >= config.REBALANCE_THRESHOLD &&
        isRebalanceEconomic(improvementApy, Math.max(capitalMoved, totalDeployed))));

  return normalized;
}
