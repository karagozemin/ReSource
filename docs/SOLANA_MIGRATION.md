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
RESOURCE_PROVIDER_SENTINEL_URL=https://<provider-a>/risk
RESOURCE_PROVIDER_SENTINEL_SOLANA_ADDRESS=<provider-a-wallet>
RESOURCE_PROVIDER_ATLAS_URL=https://<provider-b>/risk
RESOURCE_PROVIDER_ATLAS_SOLANA_ADDRESS=<provider-b-wallet>
```

The service keypair must be dedicated to ReSource and funded only with the amount intended for the demo. Public Solana RPC endpoints are suitable for development only; the deployed demo should use a private RPC endpoint.

## Remaining phases

1. Add the procurement registry program and PDA state for `active → breached → replaced`.
2. Compose registry instructions with each SPL payment so settlement and procurement state update atomically.
3. Deploy the program and test token to devnet, then run two real provider endpoints through controlled failure injection.
4. Add registry account links and status transitions to the dashboard.
5. Switch the final proof to real Solana USDC only after devnet verification and strict wallet funding limits.
