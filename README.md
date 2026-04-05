<div align="center">

# Flux

**Autonomous yield optimizer for Solana DeFi.**
Polls Kamino, MarginFi, and Solend every hour. Reasons with Claude. Rebalances when it's worth it.

[![Build](https://img.shields.io/github/actions/workflow/status/FluxYield/FluxYield/ci.yml?branch=main&style=flat-square&label=Build)](https://github.com/FluxYield/FluxYield/actions)
![License](https://img.shields.io/badge/license-MIT-blue)
[![Built with Claude Agent SDK](https://img.shields.io/badge/Built%20with-Claude%20Agent%20SDK-cc7800?style=flat-square)](https://docs.anthropic.com/en/docs/agents-and-tools/claude-agent-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square)](https://www.typescriptlang.org/)

</div>

---

Yield farming manually means checking three dashboards, doing the math on gas costs, and second-guessing yourself at 2am.

`Flux` fetches live rates across every major Solana lending protocol, builds a rate matrix, and asks Claude to reason about the optimal allocation — factoring in utilization risk, liquidity depth, and concentration limits. It only rebalances when the improvement is meaningful. Otherwise it holds.

```
FETCH RATES → BUILD MATRIX → REASON → ALLOCATE → ACCRUE → REBALANCE
```

Paper mode on by default. One env var flip for live capital.

---

## Dashboard

![Flux Dashboard](assets/preview-dashboard.svg)

---

## Terminal Output

![Flux Terminal](assets/preview-terminal.svg)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│               Protocol Layer                         │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐         │
│  │  Kamino  │  │  MarginFi │  │  Solend  │         │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘         │
│       └──────────────┼──────────────┘               │
└──────────────────────┼──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│               Aggregator                             │
│   Rate matrix · Best-per-asset · Health check       │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│            Claude Agent Loop                         │
│   get_rate_matrix → get_current_positions           │
│   → get_protocol_health → submit_allocation_plan    │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│              Rebalancer                              │
│   Diff current vs plan · Build actions              │
│   Paper execute · Yield accrual                     │
└─────────────────────────────────────────────────────┘
```

---

## Optimization Rules

| Rule | Detail |
|------|--------|
| **Min APY gate** | Ignore any rate below 5% |
| **Rebalance threshold** | Only move capital if improvement > 2% APY |
| **Max protocol concentration** | 50% cap per protocol |
| **Utilization guard** | Avoid pools above 90% utilization |
| **Liquidity floor** | Minimum $10k available to exit |

---

## Supported Protocols

| Protocol | Assets | Notes |
|----------|--------|-------|
| **Kamino** | USDC, SOL, USDT, JitoSOL | Highest rates, most liquid |
| **MarginFi** | USDC, SOL, USDT | Good depth, lower utilization |
| **Solend** | USDC, SOL, USDT, BTC | Longest track record |
| **Drift** | USDC, SOL | Perp funding rates (opt-in) |

---

## Quick Start

```bash
git clone https://github.com/FluxYield/FluxYield
cd FluxYield && bun install
cp .env.example .env
bun run dev
```

---

## Configuration

```bash
ANTHROPIC_API_KEY=sk-ant-...
HELIUS_API_KEY=...
PAPER_MODE=true
TOTAL_CAPITAL_USD=10000
CYCLE_INTERVAL_MS=3600000   # 1 hour
MIN_APY_THRESHOLD=0.05
REBALANCE_THRESHOLD=0.02
MAX_PROTOCOL_ALLOCATION_PCT=0.50
```

---

## Technical Spec

### Risk-Adjusted APY

Raw APY comparisons mislead — a 12% market at 95% utilization is less valuable than 9% at 60% because exit is unreliable at high utilization. Flux applies a penalty:

```
riskAdjustedApy = supplyApy * (1 - max(0, u - 0.70) / 0.30 * 0.40)
```

No penalty below 70% utilization. At 100% utilization, effective APY is 40% lower than stated. `getBestRatePerAsset` ranks by risk-adjusted APY and filters out markets above `MAX_UTILIZATION_RATE` (default 90%).

### Gas-Economic Rebalance Gate

Before shifting capital, `isRebalanceEconomic` checks whether the expected APY gain over one cycle actually covers the gas cost:

```typescript
const hourlyGain = capitalUsd * improvementApy / 8760 * periodHours;
// Only rebalance if hourlyGain > $0.02 (2 Solana txs)
```

A 2% APY improvement on $500 earns $0.0011/hour — rebalancing every hour would cost 18× more in gas than it earns. At $10,000 capital, the same improvement earns $0.023/hour — economic.

### Compound Yield Accrual

`accrueYield` uses compound interest: `P * ((1 + r)^t - 1)`. The prior simple interest model (`P * r * t`) underestimates accumulated yield by ~2% APY at 30% APR over a week — meaningful at larger capital amounts.

### Utilization Spike Detection

Both Kamino and Solend adapters log a warning when utilization exceeds 85% AND available liquidity is less than 5% of total supply. This pattern precedes withdrawal freezes in lending protocols — the interest rate model has forced rates up to attract new deposits but hasn't yet resolved the liquidity crunch.

---

## License

MIT

---

*money finds its own level.*
