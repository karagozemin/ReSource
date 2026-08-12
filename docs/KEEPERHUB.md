# KeeperHub Integration

This document separates integration surfaces so the audit trail does not overstate what happened.

## 1. Organization workflow execution

Implemented in `server/adapters.ts`.

- Authenticate with an organization API key prefixed `kh_`.
- Execute with `POST /api/workflows/{workflowId}/execute`.
- Wait for a terminal receipt with `GET /api/workflows/executions/{executionId}/wait`.
- Record returned workflow transaction hashes when present.

This proves workflow execution. It is not by itself proof of a Marketplace payment.

Official reference: https://docs.keeperhub.com/api/workflows and https://docs.keeperhub.com/api/executions

## 2. Marketplace paid workflow call

Implemented in `server/marketplace.ts` and `server/orchestrator.ts`.

- Discover live listings through KeeperHub's `search_workflows` MCP tool.
- Normalize the allowlisted Sentinel and Atlas listings with observed local metrics.
- Quote the selected public slug through `/api/mcp/workflows/<slug>/call`.
- Stop in `awaiting_payment` and show network, token, amount, provider and recipient.
- After explicit authorization, pay with the OKX Agentic Wallet CLI and verify the paid result.
- Persist x402 settlement hash, KeeperHub execution ID, amount and protocol separately.

Active providers:

| Provider | Slug | Price |
| --- | --- | ---: |
| Sentinel | `resource-sentinel-risk-provider` | 0.03 USDC |
| Atlas | `resource-atlas-risk-provider` | 0.05 USDC |

Official reference: https://docs.keeperhub.com/workflows/marketplace

## 3. Direct onchain execution

The safe first-write flow is implemented in `server/direct-execution.ts`.

- The allowlisted proof action is a zero-value self-transfer on Base Sepolia.
- Simulation is mandatory before broadcast and uses the identical request body.
- Broadcast requires a separate user action and a unique idempotency key.
- Status polling honors `X-Poll-Interval-Hint`.
- The public transaction link is stored in application state.

The simulation passed with a 21,000 gas estimate. KeeperHub execution `zw6ra484fc7g90jrqhhzk` then confirmed the Base Sepolia proof transaction: [`0x3c0124...e3c302`](https://sepolia.basescan.org/tx/0x3c0124ac14d8e18bb5bdcb65ad0196da463522fa562f3c7e5f5d55710ae3c302).

Official reference: https://docs.keeperhub.com/api/direct-execution

## Fail-closed behavior

`EXECUTION_MODE=keeperhub` does not fall back to demo execution. Missing credentials or a missing provider workflow ID returns an error and records no purchase or spend.

Only a successful payment receipt increments purchases/spend. A successful organization workflow is recorded as an execution, not a Marketplace purchase.

Secrets are read only by the backend process. Never prefix them with `VITE_`, expose them through `/api/state`, or log authorization headers.
