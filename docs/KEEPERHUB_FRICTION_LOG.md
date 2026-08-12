# KeeperHub Integration Friction Log

Use this log while connecting the production adapter. Each entry must be based on an actual integration attempt.

## Entry template

- Date:
- Integration surface:
- Step:
- Expected behavior:
- Actual behavior:
- Error or log excerpt:
- Exact reproduction steps:
- Time lost:
- Suggested fix:
- Is a PR possible?:
- Evidence path:

Do not record API keys, wallet secrets, signatures or other credentials here.

## 2026-08-12 — Duplicate workflow drops action integration

- Integration surface: Workflow duplicate API
- Step: Duplicate the listed Sentinel provider to create Atlas
- Expected behavior: The duplicated action remains runnable with the same configured Web3 integration.
- Actual behavior: The duplicate retained action configuration but removed `integrationId`; listing schema and output mapping were also cleared.
- Error or log excerpt: The duplicate response contained the assess-risk action without `integrationId` and returned `isListed: false`, `inputSchema: null`, `outputMapping: null`.
- Exact reproduction steps: Configure a Web3 Assess Transaction Risk action, call `POST /api/workflows/{id}/duplicate`, inspect the returned node config.
- Time lost: About 10 minutes.
- Suggested fix: Preserve non-secret integration references when the destination organization is unchanged, or return an explicit `missingIntegrations` array. Add a “duplicate listing contract” option for schema/output mappings while requiring a new slug.
- Is a PR possible?: Documentation and error-message contribution; backend repository access is unknown.
- Evidence path: KeeperHub workflow IDs `wlahhgluhzlxv6j1rdqzl` and `hzmle4dii86t34fupvdo1`.

## 2026-08-12 — Manual test cannot supply listing inputs

- Integration surface: Marketplace listing and workflow editor
- Step: Test a workflow whose action fields reference `Manual.data.*` listing inputs.
- Expected behavior: The editor offers a form or sample payload for Manual trigger data.
- Actual behavior: Run aborts with unresolved template references because the editor emits only timestamp metadata.
- Error or log excerpt: `Unresolved template reference(s): {{Manual.data.value}} ...`
- Exact reproduction steps: Add required input schema fields, reference them from an action, and press Run in the editor.
- Time lost: About 15 minutes and one paid retry while diagnosing sender input.
- Suggested fix: Generate a Manual trigger test form from `inputSchema`, or let the user paste a JSON sample before Run.
- Is a PR possible?: Strong candidate for the onboarding UX bounty as docs, UI proposal, or a focused product PR.
- Evidence path: Workflow `wlahhgluhzlxv6j1rdqzl` execution history.
