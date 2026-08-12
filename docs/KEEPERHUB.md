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

Not implemented yet.

- Discover workflows through KeeperHub's Marketplace/MCP surfaces.
- Call a public resource by slug at `/api/mcp/workflows/<slug>/call`.
- Receive an x402 or MPP payment challenge.
- Pay using an agentic wallet and retry the request with payment proof.
- Record payment protocol, settlement transaction and workflow receipt separately.

Official reference: https://docs.keeperhub.com/workflows/marketplace

## 3. Direct onchain execution

Not implemented until an explicit, low-risk demo action and chain are selected.

- Build an allowlisted action server-side.
- Simulate or validate it before submission.
- Apply the Buyer Policy Guard.
- Send through `/api/execute/*` with the KeeperHub organization key.
- Poll `/api/execute/{executionId}/status` using `X-Poll-Interval-Hint`.
- Store the public transaction link as primary hackathon proof.

Official reference: https://docs.keeperhub.com/api/direct-execution

## Fail-closed behavior

`EXECUTION_MODE=keeperhub` does not fall back to demo execution. Missing credentials or a missing provider workflow ID returns an error and records no purchase or spend.

Secrets are read only by the backend process. Never prefix them with `VITE_`, expose them through `/api/state`, or log authorization headers.
