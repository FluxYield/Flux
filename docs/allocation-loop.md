# Allocation Loop

Flux reallocates yield across protocols, so the loop should be readable enough to audit with no code open.

## Suggested order

1. Read protocol states and current balances.
2. Compute net yield after borrow costs, incentives, and friction.
3. Remove options that fail liquidity or withdrawal assumptions.
4. Rank remaining moves by incremental improvement, not raw APR.
5. Execute only the smallest set of changes needed to reach the new target.

## Capital checks

- Do not move funds into a venue that cannot support the planned exit path.
- Treat promotional yield as temporary unless the source is durable.
- Keep idle buffer assumptions explicit so the allocator does not strand working capital.
