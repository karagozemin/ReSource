import { beforeEach, describe, expect, it } from "vitest";
import { DemoExecutionAdapter } from "./adapters";
import type { ExecutionAdapter } from "./adapters";
import type { MarketplaceClient } from "./marketplace";
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
