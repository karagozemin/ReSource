# ReSource

**The self-healing buyer for agent services.**

ReSource gives an autonomous agent a persistent service requirement, called a Standing Order. It evaluates competing providers against price, budget, latency and observed reliability; buys from the best eligible provider; verifies the result; and automatically re-procures when the provider degrades.

> KeeperHub provides execution-level reliability. ReSource provides provider-level procurement reliability.

## Current milestone

This repository currently ships a working product slice:

- an operational dashboard that explains the product in one screen;
- a deterministic policy and provider scoring engine;
- three competing transaction-risk providers;
- price, daily budget, latency, reliability and paused-order guards;
- a live purchase lifecycle simulation;
- provider degradation, suspension and automatic failover from Sentinel Labs to Atlas Risk;
- an audit timeline and observed metrics;
- a Fastify orchestration API with atomic JSON persistence;
- cycle records and mandatory idempotency keys that prevent duplicate execution;
- a typed KeeperHub workflow adapter that fails closed when credentials or workflow IDs are absent;
- an opt-in recurring trigger with interval-bucket idempotency;
- unit tests for the critical procurement decisions.

The default mode is an explicitly labelled **demo adapter**. KeeperHub mode adds live Marketplace discovery, policy-gated x402 purchases through an agentic wallet, paid result verification, and a mandatory-simulation direct execution proof flow.

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

## KeeperHub integration

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

KeeperHub mode uses two distinct boundaries:

1. Organization workflow execution through authenticated REST endpoints.
2. Marketplace procurement through live MCP discovery and public paid workflow slugs.

Marketplace cycles stop after quoting. The frontend displays full payment terms and requires explicit authorization before the backend invokes the agentic wallet. Payment/spend metrics are updated only from a successful settlement receipt. Direct execution uses simulation first and requires a separate broadcast action.

Environment variable placeholders are documented in `.env.example`. Secrets must be consumed by a backend process, never by Vite client code.

## Known limitations

- One JSON store supports a single local server process; multi-instance deployment needs transactional storage.
- The recurring trigger runs in-process; production deployment should move it to a durable worker or scheduler.
- The current wallet integration shells out to the installed `onchainos` CLI; production deployment should replace this with a long-running wallet service boundary.
- Marketplace catalog search is paginated and currently scans recent listings before validating configured slugs.
- Direct KeeperHub proof has passed simulation but still requires one explicitly approved Base Sepolia broadcast.

## Next build order

1. Broadcast the simulated Base Sepolia proof and record its public link.
2. Run the dashboard-controlled paid cycle and capture the x402 receipt in the audit timeline.
3. Exercise automatic failover from Sentinel to Atlas with a controlled provider failure.
4. Replace JSON persistence with SQLite before multi-process deployment.
5. Record the demo video and publish only observed metrics.

## Name

The product name is **ReSource**. References to “ProcureAgent” in the source PRD are treated as the retired project codename.
