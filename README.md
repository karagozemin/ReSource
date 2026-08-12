# ReSource

**The self-healing buyer for agent services.**

ReSource gives an autonomous agent a persistent service requirement, called a Standing Order. It evaluates competing providers against price, budget, latency and observed reliability; buys from the best eligible provider; verifies the result; and automatically re-procures when the provider degrades.

> KeeperHub provides execution-level reliability. ReSource provides provider-level procurement reliability.

## Current milestone

This repository currently ships the first working product slice:

- an operational dashboard that explains the product in one screen;
- a deterministic policy and provider scoring engine;
- three competing wallet-risk providers;
- price, daily budget, latency, reliability and paused-order guards;
- a live purchase lifecycle simulation;
- provider degradation, suspension and automatic failover from Sentinel Labs to Atlas Risk;
- an audit timeline and observed metrics;
- unit tests for the critical procurement decisions.

The KeeperHub boundary currently uses an explicitly labelled **demo adapter**. It never fabricates a real payment, execution ID or transaction link. A real paid workflow, x402 settlement and direct KeeperHub onchain transaction still require credentials and the production adapter.

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

Open the URL Vite prints, then:

1. Select **Run procurement cycle**. ReSource evaluates all providers, rejects Veridian on latency, and selects Sentinel.
2. Select **Inject provider failure**. Sentinel times out and is suspended.
3. Watch ReSource re-rank the market and automatically move the Standing Order to Atlas.

## Verify

```bash
npm test
npm run lint
npm run build
```

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

The current code separates procurement rules from React:

- `src/lib/procurement.ts`: eligibility, scoring, ranking and failure updates;
- `src/data/demo.ts`: reproducible Standing Order and provider fixtures;
- `src/App.tsx`: operational workflow and live state;
- `src/lib/procurement.test.ts`: policy and recovery tests.

## KeeperHub integration boundary

The production adapter must implement these capabilities without leaking secrets into the frontend:

1. Discover Marketplace workflows and normalize provider metadata.
2. Request and authorize the x402 payment.
3. Execute the paid workflow and capture its observed latency/result.
4. Verify the response schema and required output.
5. Simulate and send the direct onchain action through KeeperHub.
6. Persist payment, execution and public transaction identifiers in the audit record.

Environment variable placeholders are documented in `.env.example`. Secrets must be consumed by a backend process, never by Vite client code.

## Known limitations

- State is in memory and resets with the page.
- Recurrence is represented in the model but is not scheduled in a backend worker yet.
- Marketplace discovery, paid calls, x402, agentic wallet and direct execution are not yet connected.
- Metrics shown in the UI are generated only by the current demo session and are not hackathon proof metrics.

## Next build order

1. Prove one direct KeeperHub transaction and record its public link.
2. Prove one Marketplace discovery and paid x402 workflow call.
3. Move orchestration into a Node.js service and persist cycles/idempotency in SQLite.
4. Connect the dashboard to server events.
5. Run repeated real cycles and publish only observed metrics.

## Name

The product name is **ReSource**. References to “ProcureAgent” in the source PRD are treated as the retired project codename.
