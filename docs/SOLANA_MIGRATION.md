# Solana migration

ReSource is being migrated incrementally from its KeeperHub/Base integration to autonomous service procurement on Solana. The buyer-side policy, deterministic provider ranking, SLA verification, idempotency, persistence and automatic failover remain the core of the system.

## Phase 1: settlement boundary

Implemented in `server/solana.ts`:

- `EXECUTION_MODE=solana` runtime selection;
- SPL token settlement through the current `@solana/kit` client and Token Program;
- checked token amounts with configurable mint decimals;
- a dedicated backend service keypair loaded from a file path;
- per-provider HTTP endpoints and Solana payment addresses;
- confirmed transaction signatures and Solana Explorer links stored on procurement cycles;
- paid-provider failure accounting followed by automatic selection and payment of the next eligible provider;
- fail-closed startup readiness when RPC, signer, token or provider configuration is incomplete.

No live payment is sent by the test suite. Tests inject a settlement boundary and verify the complete select → pay → execute → fail → replace → pay-again lifecycle.

## Phase 2: onchain procurement lifecycle

Implemented in `programs/resource-registry` and `server/solana-registry.ts`:

- a deterministic procurement PDA derived from `buyer + procurement_id`;
- immutable buyer, original provider, service hash, token mint, initial amount and latency SLA commitment;
- enforced `Active → Breached → Replaced` transitions;
- buyer-signature authorization for every lifecycle mutation;
- original and replacement provider/amount fields retained together for auditability;
- initial SPL payment + `create_procurement` in one non-divisible transaction;
- replacement SPL payment + `replace_provider` in one non-divisible transaction;
- a separate confirmed breach transaction between the two payments;
- payment, breach and registry PDA Explorer links stored on procurement cycles and exposed in the dashboard.

The Anchor program ID is `G3sta1z39YXTX5dopAXtuv6kqBTQGoN9G85DMW3WVvm4`. Its deployment keypair is generated locally under ignored `target/deploy`; it is never committed.

## Runtime configuration

```text
EXECUTION_MODE=solana
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://<private-rpc-endpoint>
SOLANA_RPC_SUBSCRIPTIONS_URL=wss://<private-rpc-endpoint>
SOLANA_KEYPAIR_PATH=/etc/secrets/solana-keypair.json
SOLANA_TOKEN_MINT=<SPL mint address>
SOLANA_TOKEN_SYMBOL=USDC
SOLANA_TOKEN_DECIMALS=6
SOLANA_REGISTRY_PROGRAM_ID=G3sta1z39YXTX5dopAXtuv6kqBTQGoN9G85DMW3WVvm4
RESOURCE_PROVIDER_SENTINEL_URL=https://<provider-a>/risk
RESOURCE_PROVIDER_SENTINEL_SOLANA_ADDRESS=<provider-a-wallet>
RESOURCE_PROVIDER_ATLAS_URL=https://<provider-b>/risk
RESOURCE_PROVIDER_ATLAS_SOLANA_ADDRESS=<provider-b-wallet>
```

The service keypair must be dedicated to ReSource and funded only with the amount intended for the demo. Public Solana RPC endpoints are suitable for development only; the deployed demo should use a private RPC endpoint.

## Verification

```bash
npm test
npm run build
npm run lint
npm run anchor:build
npm run anchor:test
```

The TypeScript suite validates Anchor discriminators, account order, PDA stability, settlement evidence and shared procurement identity across failover. Rust tests validate allowed and rejected lifecycle transitions. None of these commands send a live transaction.

## Remaining deployment phases

1. Deploy the committed registry program to devnet using the dedicated deploy authority.
2. Configure a devnet SPL mint, a low-balance runtime signer and two real provider endpoints.
3. Run the full controlled-failure flow and capture the three transaction proofs plus the final PDA state.
4. Switch the final proof to real Solana USDC only after devnet verification and strict wallet funding limits.
