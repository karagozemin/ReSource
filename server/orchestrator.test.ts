import { beforeEach, describe, expect, it, vi } from "vitest";
import { DemoExecutionAdapter } from "./adapters";
import type { ExecutionAdapter } from "./adapters";
import type { MarketplaceClient } from "./marketplace";
import { PaymentQuoteExpiredError } from "./marketplace";
import { ProcurementOrchestrator } from "./orchestrator";
import { MemoryStateStore } from "./store";

describe("ProcurementOrchestrator", () => {
  let orchestrator: ProcurementOrchestrator;

  beforeEach(async () => {
    orchestrator = new ProcurementOrchestrator(new MemoryStateStore(), new DemoExecutionAdapter());
    await orchestrator.initialize();
  });

  it("persists a successful provider selection and execution", async () => {
    const result = await orchestrator.run("cycle-one");
    expect(result.cycle.status).toBe("completed");
    expect(result.state.selectedProviderId).toBe("sentinel");
    expect(result.state.metrics).toMatchObject({ cycles: 1, evaluations: 3, purchases: 1, executions: 1, spend: 0.03 });
    expect(result.cycle.executionId).toMatch(/^demo_/);
    expect(result.cycle.transactionHash).toBeNull();
  });

  it("replays an idempotent cycle without a second payment", async () => {
    const first = await orchestrator.run("same-key");
    const second = await orchestrator.run("same-key");
    expect(second.replayed).toBe(true);
    expect(second.cycle.id).toBe(first.cycle.id);
    expect(second.state.metrics.purchases).toBe(1);
    expect(second.state.metrics.spend).toBe(0.03);
  });

  it("fails closed while a Standing Order is paused", async () => {
    await orchestrator.togglePause();
    const result = await orchestrator.run("paused-cycle");
    expect(result.cycle.status).toBe("policy_blocked");
    expect(result.state.metrics.purchases).toBe(0);
    expect(result.state.metrics.spend).toBe(0);
  });

  it("suspends Sentinel and automatically procures Atlas", async () => {
    await orchestrator.run("initial");
    const result = await orchestrator.injectFailure();
    expect(result.state.selectedProviderId).toBe("atlas");
    expect(result.state.providers.find((provider) => provider.id === "sentinel")?.state).toBe("ineligible");
    expect(result.state.metrics).toMatchObject({ cycles: 2, evaluations: 6, purchases: 2, recoveries: 1, executions: 2, spend: 0.08 });
  });

  it("rejects provider output that does not satisfy the risk schema", async () => {
    const invalidAdapter = new DemoExecutionAdapter();
    invalidAdapter.execute = async () => ({
      executionId: "invalid",
      success: true,
      latencyMs: 10,
      output: { message: "not a risk result" },
      transactionHash: null,
      error: null,
    });
    const invalidOrchestrator = new ProcurementOrchestrator(new MemoryStateStore(), invalidAdapter);
    await invalidOrchestrator.initialize();
    const result = await invalidOrchestrator.run("invalid-schema");
    expect(result.cycle.status).toBe("failed");
    expect(result.state.metrics.purchases).toBe(0);
  });

  it("does not count an organization workflow as a paid purchase", async () => {
    const keeperHubAdapter: ExecutionAdapter = {
      mode: "keeperhub",
      isReady: () => true,
      execute: async () => ({
        executionId: "keeperhub-execution",
        success: true,
        latencyMs: 10,
        output: { riskLevel: "high", riskScore: 70, factors: ["fail-closed"] },
        transactionHash: null,
        error: null,
      }),
    };
    const keeperHubOrchestrator = new ProcurementOrchestrator(new MemoryStateStore(), keeperHubAdapter);
    await keeperHubOrchestrator.initialize();
    const result = await keeperHubOrchestrator.run("unpaid-workflow");
    expect(result.state.metrics).toMatchObject({ purchases: 0, executions: 1, spend: 0 });
    expect(result.cycle.amount).toBe(0);
  });

  it("fills newly added metrics when loading an older version-four state", async () => {
    const store = new MemoryStateStore();
    const legacy = orchestrator.snapshot();
    delete (legacy.metrics as Partial<typeof legacy.metrics>).savings;
    await store.save(legacy);
    const restored = new ProcurementOrchestrator(store, new DemoExecutionAdapter());
    await restored.initialize();
    expect(restored.snapshot().metrics.savings).toBe(0);
  });

  it("removes raw wallet commands from persisted payment errors", async () => {
    const store = new MemoryStateStore();
    const state = orchestrator.snapshot();
    state.events.unshift({ id: "raw-error", time: new Date().toISOString(), kind: "error", title: "Payment attempt failed", detail: "Error: Command failed: onchainos payment pay --secret-value" });
    await store.save(state);
    const restored = new ProcurementOrchestrator(store, new DemoExecutionAdapter());
    await restored.initialize();
    expect(restored.snapshot().events[0].detail).toBe("The payment quote was no longer available. No purchase was recorded.");
  });

  it("preserves paid KeeperHub metrics across initialization", async () => {
    const store = new MemoryStateStore();
    const state = orchestrator.snapshot();
    state.executionMode = "keeperhub";
    state.metrics = { ...state.metrics, purchases: 2, executions: 2, spend: 0.08, savings: 0.02 };
    await store.save(state);
    const keeperHubAdapter: ExecutionAdapter = {
      mode: "keeperhub",
      isReady: () => true,
      execute: async () => ({ executionId: "unused", success: true, latencyMs: 1, output: {}, transactionHash: null, error: null }),
    };
    const restored = new ProcurementOrchestrator(store, keeperHubAdapter);
    await restored.initialize();
    expect(restored.snapshot().metrics).toMatchObject({ purchases: 2, executions: 2, spend: 0.08, savings: 0.02 });
  });

  it("quotes a Marketplace purchase before moving funds", async () => {
    const marketplace = marketplaceStub();
    const buyer = new ProcurementOrchestrator(new MemoryStateStore(), new DemoExecutionAdapter(), marketplace);
    await buyer.initialize();
    const result = await buyer.run("marketplace-quote");
    expect(result.cycle.status).toBe("awaiting_payment");
    expect(result.state.pendingPayment).toMatchObject({ providerId: "sentinel", amount: 0.03, token: "USDC" });
    expect(result.state.metrics).toMatchObject({ purchases: 0, spend: 0 });
    await expect(buyer.run("second-cycle")).rejects.toThrow("already pending");
  });

  it("closes an abandoned sponsored quote before starting another cycle", async () => {
    const buyer = new ProcurementOrchestrator(new MemoryStateStore(), new DemoExecutionAdapter(), marketplaceStub());
    await buyer.initialize();
    const first = await buyer.run("abandoned-quote");
    const pending = buyer.snapshot().pendingPayment!;
    pending.createdAt = new Date(Date.now() - 10_000).toISOString();
    const state = buyer.snapshot();
    state.pendingPayment = pending;
    const store = new MemoryStateStore();
    await store.save(state);
    const restored = new ProcurementOrchestrator(store, new DemoExecutionAdapter(), marketplaceStub());
    await restored.initialize();

    const second = await restored.run("replacement-quote", 5_000);
    expect(second.cycle.status).toBe("awaiting_payment");
    expect(second.cycle.id).not.toBe(first.cycle.id);
    expect(second.state.cycles.find((cycle) => cycle.id === first.cycle.id)).toMatchObject({ status: "failed", error: "Payment confirmation window expired" });
    expect(second.state.metrics.spend).toBe(0);
  });

  it("records x402 spend only after payment and result verification", async () => {
    const buyer = new ProcurementOrchestrator(new MemoryStateStore(), new DemoExecutionAdapter(), marketplaceStub());
    await buyer.initialize();
    const quote = await buyer.run("paid-cycle");
    const result = await buyer.confirmPayment(quote.cycle.id);
    expect(result.cycle).toMatchObject({ status: "completed", amount: 0.03, paymentProtocol: "x402", transactionHash: "0xpayment" });
    expect(result.state.metrics).toMatchObject({ purchases: 1, executions: 1, spend: 0.03 });
    expect(result.state.metrics.savings).toBeCloseTo(0.02);
    expect(result.state.pendingPayment).toBeNull();
  });

  it("refreshes an expired quote and requires a second authorization", async () => {
    let quoteNumber = 0;
    let payNumber = 0;
    const marketplace = marketplaceStub();
    marketplace.quote = async (provider) => ({
      cycleId: "",
      paymentId: `pay_${++quoteNumber}`,
      providerId: provider.id,
      acceptsIndex: 0,
      amount: provider.price,
      token: "USDC",
      chainId: "8453",
      chainName: "Base",
      recipient: "0xmerchant",
      createdAt: new Date().toISOString(),
    });
    marketplace.pay = async () => {
      if (++payNumber === 1) throw new PaymentQuoteExpiredError();
      return { executionId: "keeperhub-paid", success: true, latencyMs: 500, output: { riskLevel: "low", riskScore: 12, factors: [] }, transactionHash: "0xpayment", error: null, paid: true, amount: 0.03, paymentProtocol: "x402" };
    };
    const buyer = new ProcurementOrchestrator(new MemoryStateStore(), new DemoExecutionAdapter(), marketplace);
    await buyer.initialize();
    const firstQuote = await buyer.run("expiring-cycle");
    const refresh = await buyer.confirmPayment(firstQuote.cycle.id);
    expect("needsReconfirmation" in refresh && refresh.needsReconfirmation).toBe(true);
    expect(refresh.state.pendingPayment?.paymentId).toBe("pay_2");
    expect(refresh.state.metrics).toMatchObject({ purchases: 0, spend: 0 });
    const paid = await buyer.confirmPayment(firstQuote.cycle.id);
    expect(paid.cycle.status).toBe("completed");
    expect(paid.state.metrics).toMatchObject({ purchases: 1, spend: 0.03 });
  });

  it("blocks a stale payment authorization after the order is paused", async () => {
    const buyer = new ProcurementOrchestrator(new MemoryStateStore(), new DemoExecutionAdapter(), marketplaceStub());
    await buyer.initialize();
    const quote = await buyer.run("pause-before-pay");
    await buyer.togglePause();
    await expect(buyer.confirmPayment(quote.cycle.id)).rejects.toThrow("Standing order is paused");
    expect(buyer.snapshot().metrics.spend).toBe(0);
  });

  it("re-procures from Atlas when Sentinel breaches SLA before payment", async () => {
    const buyer = new ProcurementOrchestrator(new MemoryStateStore(), new DemoExecutionAdapter(), marketplaceStub());
    await buyer.initialize();
    await buyer.run("sentinel-quote");
    const result = await buyer.injectFailure();
    expect(result.cycle.status).toBe("awaiting_payment");
    expect(result.state.pendingPayment).toMatchObject({ providerId: "atlas", amount: 0.05 });
    expect(result.state.providers.find((provider) => provider.id === "sentinel")?.state).toBe("ineligible");
    expect(result.state.metrics.spend).toBe(0);
  });

  it("records Solana settlement and automatically pays the replacement", async () => {
    const executionContexts: Array<{ procurementId: string; replacement: boolean }> = [];
    const breachIds: string[] = [];
    const solanaAdapter: ExecutionAdapter = {
      mode: "solana",
      isReady: () => true,
      execute: async (provider, _order, context) => {
        executionContexts.push(context!);
        return {
          executionId: `solana-${provider.id}`,
          success: true,
          latencyMs: 500,
          output: { riskLevel: "low", riskScore: 12, factors: [] },
          transactionHash: `signature-${provider.id}`,
          transactionLink: `https://explorer.solana.com/tx/signature-${provider.id}?cluster=devnet`,
          error: null,
          paid: true,
          amount: provider.price,
          paymentProtocol: "spl",
          procurementAddress: "registry-pda",
        };
      },
      markBreached: async (procurementId) => {
        breachIds.push(procurementId);
        return {
          signature: "breach-signature",
          explorerUrl: "https://explorer.solana.com/tx/breach-signature?cluster=devnet",
          procurementAddress: "registry-pda",
        };
      },
    };
    const buyer = new ProcurementOrchestrator(new MemoryStateStore(), solanaAdapter);
    await buyer.initialize();

    const first = await buyer.run("solana-initial");
    expect(first.cycle).toMatchObject({
      status: "completed",
      amount: 0.03,
      paymentProtocol: "spl",
      transactionHash: "signature-sentinel",
    });

    const recovery = await buyer.injectFailure();
    expect(recovery.cycle).toMatchObject({
      status: "completed",
      amount: 0.05,
      paymentProtocol: "spl",
      transactionHash: "signature-atlas",
    });
    expect(recovery.state.selectedProviderId).toBe("atlas");
    expect(recovery.state.metrics).toMatchObject({ purchases: 2, executions: 2, recoveries: 1, spend: 0.08 });
    expect(executionContexts).toEqual([
      { procurementId: first.cycle.id, replacement: false },
      { procurementId: first.cycle.id, replacement: true },
    ]);
    expect(breachIds).toEqual([first.cycle.id]);
    expect(recovery.state.cycles.find((cycle) => cycle.id === first.cycle.id)).toMatchObject({
      breachTransactionHash: "breach-signature",
      procurementAddress: "registry-pda",
    });
  });

  it("persists a settling cycle before Solana payment execution completes", async () => {
    const store = new MemoryStateStore();
    let finishExecution!: (result: Awaited<ReturnType<ExecutionAdapter["execute"]>>) => void;
    let executions = 0;
    const solanaAdapter: ExecutionAdapter = {
      mode: "solana",
      isReady: () => true,
      execute: async () => {
        executions += 1;
        return new Promise((resolve) => { finishExecution = resolve; });
      },
    };
    const buyer = new ProcurementOrchestrator(store, solanaAdapter);
    await buyer.initialize();
    const firstRun = buyer.run("crash-safe-key");
    await vi.waitFor(() => expect(executions).toBe(1));

    expect((await store.load())?.cycles[0]).toMatchObject({ idempotencyKey: "crash-safe-key", status: "settling" });
    const restarted = new ProcurementOrchestrator(store, solanaAdapter);
    await restarted.initialize();
    const replay = await restarted.run("crash-safe-key");
    expect(replay).toMatchObject({ replayed: true, cycle: { status: "settling" } });
    expect(executions).toBe(1);

    finishExecution({
      executionId: "settled",
      success: true,
      latencyMs: 100,
      output: { riskLevel: "low", riskScore: 12, factors: [] },
      transactionHash: "signature",
      transactionLink: "https://explorer.solana.com/tx/signature?cluster=devnet",
      error: null,
      paid: true,
      amount: 0.03,
      paymentProtocol: "spl",
    });
    await firstRun;
  });
});

function marketplaceStub(): MarketplaceClient {
  return {
    isReady: () => true,
    discover: async () => [
      { id: "sentinel", name: "Sentinel", workflow: "resource-sentinel-risk-provider", marketplaceSlug: "resource-sentinel-risk-provider", source: "marketplace", price: 0.03, reliability: 0.99, latencyMs: 8_000, attempts: 10, state: "healthy" },
      { id: "atlas", name: "Atlas", workflow: "resource-atlas-risk-provider", marketplaceSlug: "resource-atlas-risk-provider", source: "marketplace", price: 0.05, reliability: 0.99, latencyMs: 8_000, attempts: 10, state: "healthy" },
    ],
    quote: async (provider) => ({ cycleId: "", paymentId: "pay_test", providerId: provider.id, acceptsIndex: 0, amount: provider.price, token: "USDC", chainId: "8453", chainName: "Base", recipient: "0xmerchant", createdAt: new Date().toISOString() }),
    pay: async () => ({ executionId: "keeperhub-paid", success: true, latencyMs: 500, output: { riskLevel: "low", riskScore: 12, factors: [] }, transactionHash: "0xpayment", error: null, paid: true, amount: 0.03, paymentProtocol: "x402" }),
  };
}
