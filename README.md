<p align="center">
  <img src="docs/assets/resource-readme.png" alt="ReSource" width="320" />
</p>

# ReSource

**The self-healing buyer for agent services.**

ReSource gives an autonomous agent a persistent service requirement, called a Standing Order. It evaluates competing providers against price, budget, latency and observed reliability; buys from the best eligible provider; verifies the result; and automatically re-procures when the provider degrades.

> KeeperHub provides execution-level reliability. ReSource provides provider-level procurement reliability.

## Current milestone

This repository currently ships a working product slice:

- an operational dashboard that explains the product in one screen;
- functional Orders, Providers, Executions and Settings workspaces;
- server-validated policy editing, provider catalog refresh and operator requalification;
- execution filters, settlement links and direct-proof visibility;
- runtime scheduler controls that remain disabled by default;
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

## Deploy: Render API + Vercel web

First import the repository into Vercel and complete an initial deployment to obtain its production URL. Then deploy the backend using `render.yaml`. In Render, set `FRONTEND_ORIGIN` to that Vercel URL (for example `https://resource.vercel.app`). The service binds to Render's `PORT` automatically and exposes `/api/health` for health checks.

After Render provides the backend URL, set this Vercel project environment variable:

```text
VITE_API_BASE_URL=https://resource-api.onrender.com
```

Redeploy Vercel so the build includes the API URL. For multiple Vercel domains, `FRONTEND_ORIGIN` accepts a comma-separated list. Do not add a trailing slash to either URL.

The free Render plan has an ephemeral filesystem, so demo state resets after a restart or redeploy. For persistent production state, use a paid persistent disk mounted at `/var/data` with `DATA_DIR=/var/data`, or replace the JSON store with a managed database. Keep `SCHEDULER_ENABLED=false` until durable storage and spending controls are configured.

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

## Hackathon P0 status

| Requirement | Status | Evidence |
| --- | --- | --- |
| Persistent Standing Order | Complete | Policy, pause/resume and scheduled idempotency are persisted server-side |
| Two competing providers | Complete | Live Sentinel and Atlas KeeperHub Marketplace listings |
| Marketplace discovery | Complete | KeeperHub `search_workflows` MCP tool plus public-slug validation |
| Deterministic selection | Complete | Price 40%, reliability 40%, latency 20% with hard eligibility rules |
| Buyer Policy Guard | Complete | Price, daily budget, SLA, reliability and duplicate checks fail closed |
| x402 payment | Complete | Quote and explicit authorization are separate; receipts persist amount and transaction hash |
| Result verification | Complete | Risk schema and latency are verified before an execution counts as successful |
| Automatic re-procurement | Complete | Controlled Sentinel SLA breach suspends it and prepares an Atlas quote without spending |
| Direct KeeperHub execution | Complete | [Base Sepolia transaction](https://sepolia.basescan.org/tx/0x3c0124ac14d8e18bb5bdcb65ad0196da463522fa562f3c7e5f5d55710ae3c302) confirmed after KeeperHub simulation |
| Audit and metrics | Complete | Cycles, evaluations, purchases, executions, recoveries, spend and savings |

The persisted demo evidence includes two verified Atlas x402 purchases, a controlled Sentinel SLA failure, one automatic recovery and a confirmed Base Sepolia direct proof. New purchases and direct broadcasts remain behind separate explicit controls.

## Demo runbook

1. Open the dashboard and show the live Marketplace provider metadata.
2. Open **Providers** and show the live listing metadata and observed performance.
3. Open **Executions** and show the two x402 settlements, controlled failure and direct proof link.
4. Use **Orders** to show the persisted budget, SLA and failover policy.
5. Return to **Overview** and explain the completed recovery timeline. Run another paid cycle only when fresh evidence is required.

The runbook above is read-only. Starting another paid cycle or broadcasting a new direct proof remains a separate, explicit action in the dashboard.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Adapter health |
| `GET` | `/api/state` | Dashboard state, cycles and metrics |
| `GET` | `/api/runtime` | Runtime scheduler state |
| `POST` | `/api/standing-orders/SO-001/run` | Execute a cycle; requires `idempotency-key` |
| `POST` | `/api/standing-orders/toggle` | Pause or resume the order |
| `PATCH` | `/api/standing-orders/policy` | Update the validated procurement policy |
| `POST` | `/api/providers/refresh` | Refresh Marketplace provider discovery |
| `POST` | `/api/providers/:id/requalify` | Clear observed provider history and requalify |
| `PATCH` | `/api/runtime/scheduler` | Enable or disable the in-process scheduler |
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
- Scheduler toggles are runtime-only; restart behavior is still controlled by `SCHEDULER_ENABLED`.

## Next build order

1. Record the demo video using the persisted paid, failure, recovery and direct-proof evidence.
2. Publish the repository and add its public URL to the submission.
3. Replace JSON persistence with SQLite before multi-process deployment.
4. Prepare the separate onboarding bounty artifact from the captured KeeperHub integration friction.
5. Submit the BUIDL and public transaction link to DoraHacks.

## Name

The product name is **ReSource**. References to “ProcureAgent” in the source PRD are treated as the retired project codename.
