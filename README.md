# ReSource

**The self-healing buyer for agent services.**

ReSource gives an autonomous agent a persistent service requirement, called a Standing Order. It evaluates competing providers against price, budget, latency and observed reliability; buys from the best eligible provider; verifies the result; and automatically re-procures when the provider degrades.

> KeeperHub provides execution-level reliability. ReSource provides provider-level procurement reliability.

## Current milestone

This repository currently ships a working product slice:

- an operational dashboard that explains the product in one screen;
- a deterministic policy and provider scoring engine;
- three competing wallet-risk providers;
- price, daily budget, latency, reliability and paused-order guards;
- a live purchase lifecycle simulation;
- provider degradation, suspension and automatic failover from Sentinel Labs to Atlas Risk;
- an audit timeline and observed metrics;
- a Fastify orchestration API with atomic JSON persistence;
- cycle records and mandatory idempotency keys that prevent duplicate execution;
- a typed KeeperHub workflow adapter that fails closed when credentials or workflow IDs are absent;
- an opt-in recurring trigger with interval-bucket idempotency;
- unit tests for the critical procurement decisions.

The default KeeperHub boundary uses an explicitly labelled **demo adapter**. It never fabricates a real payment or transaction link. Demo execution IDs are prefixed with `demo_`. A real paid Marketplace call, x402 settlement and direct KeeperHub onchain transaction still require wallet credentials and explicit transaction configuration.

## Run locally

Requirements: Node.js 22.22+ or 24.15+ and npm.

```bash
npm install
npm run dev
```

The command starts the API on port `8787` and the Vite dashboard on port `5173`. Open the Vite URL, then:

1. Select **Run procurement cycle**. ReSource evaluates all providers, rejects Veridian on latency, and selects Sentinel.
2. Select **Inject provider failure**. Sentinel times out and is suspended.
3. Watch ReSource re-rank the market and automatically move the Standing Order to Atlas.

## Verify

```bash
npm test
npm run lint
npm run build
```

The API state is saved atomically to `data/runtime.json`. That file is local runtime data and is ignored by Git.

Recurring execution is disabled by default so a local start never spends unexpectedly. Enable it explicitly:

```bash
SCHEDULER_ENABLED=true npm run dev
```

Each interval uses a stable key such as `schedule:SO-001:<bucket>`. Restarts and repeated scheduler polls therefore replay the saved cycle instead of paying twice.

## Procurement policy

The demo Standing Order requires:

| Constraint | Value |
| --- | ---: |
| Frequency | Every 10 minutes |
| Maximum price | $0.06 per run |
| Daily budget | $2.00 |
| Maximum latency | 20 seconds |
| Minimum reliability | 95% |
| Automatic failover | Enabled |

Eligible providers are ranked deterministically:

```text
score = price × 40% + observed reliability × 40% + latency × 20%
```

Hard policy rules run before scoring and fail closed. An unknown or invalid action must never proceed to payment.

## Architecture

```text
Standing Order
      |
      v
Policy Filter --> Deterministic Scoring --> Selected Provider
      |                                      |
      | rejected                             v
      +------------------------------- Buyer Policy Guard
                                             |
                                             v
                                  KeeperHub Adapter (demo)
                                             |
                                             v
                                      Result Verifier
                                        /          \
                                   failure        success
                                      |              |
                                suspend + heal   update metrics
```

The current code separates procurement rules and execution from React:

- `src/lib/procurement.ts`: eligibility, scoring, ranking and failure updates;
- `src/data/demo.ts`: reproducible Standing Order and provider fixtures;
- `src/App.tsx`: operational workflow and live state;
- `src/lib/procurement.test.ts`: policy and recovery tests.
- `server/orchestrator.ts`: serialized, idempotent procurement cycles and recovery;
- `server/adapters.ts`: demo and KeeperHub workflow execution adapters;
- `server/store.ts`: atomic persistence;
- `server/app.ts`: HTTP API.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Adapter health |
| `GET` | `/api/state` | Dashboard state, cycles and metrics |
| `POST` | `/api/standing-orders/SO-001/run` | Execute a cycle; requires `idempotency-key` |
| `POST` | `/api/standing-orders/toggle` | Pause or resume the order |
| `POST` | `/api/demo/failure` | Inject provider failure in demo mode |
| `POST` | `/api/demo/reset` | Reset persisted demo state |

## KeeperHub integration boundary

The server includes a KeeperHub workflow execution adapter based on the official REST endpoints:

```text
POST /api/workflows/{workflowId}/execute
GET  /api/workflows/executions/{executionId}/wait?timeoutMs=60000
```

Enable it only after configuring `.env`:

```bash
EXECUTION_MODE=keeperhub
KEEPERHUB_API_URL=https://app.keeperhub.com/api
KEEPERHUB_API_KEY=kh_...
KEEPERHUB_WORKFLOW_ATLAS=wf_...
KEEPERHUB_WORKFLOW_SENTINEL=wf_...
KEEPERHUB_WORKFLOW_VERIDIAN=wf_...
```

This adapter executes organization workflows; it does **not** claim that an x402 Marketplace purchase occurred. Marketplace paid calls use the public workflow slug endpoint and require an x402/MPP-capable agent wallet. The next production integration must add these capabilities without leaking secrets into the frontend:

1. Discover Marketplace workflows and normalize provider metadata.
2. Call `https://app.keeperhub.com/api/mcp/workflows/<slug>/call`, handle the 402 challenge, and authorize payment with an agentic wallet.
3. Execute the paid workflow and capture its observed latency/result.
4. Verify the response schema and required output.
5. Configure, policy-check and send a separate direct onchain action through KeeperHub's `/api/execute/*` surface.
6. Persist payment, execution and public transaction identifiers in the audit record.

Environment variable placeholders are documented in `.env.example`. Secrets must be consumed by a backend process, never by Vite client code.

## Known limitations

- One JSON store supports a single local server process; multi-instance deployment needs transactional storage.
- The recurring trigger runs in-process; production deployment should move it to a durable worker or scheduler.
- Marketplace discovery, paid calls, x402, agentic wallet and separate direct execution are not yet connected.
- Metrics shown in the UI are generated only by the current demo session and are not hackathon proof metrics.

## Next build order

1. Prove one direct KeeperHub transaction and record its public link.
2. Prove one Marketplace discovery and paid x402 workflow call.
3. Move orchestration into a Node.js service and persist cycles/idempotency in SQLite.
4. Connect the dashboard to server events.
5. Run repeated real cycles and publish only observed metrics.

## Name

The product name is **ReSource**. References to “ProcureAgent” in the source PRD are treated as the retired project codename.
