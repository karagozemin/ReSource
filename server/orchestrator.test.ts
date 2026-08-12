import { beforeEach, describe, expect, it } from "vitest";
import { DemoExecutionAdapter } from "./adapters";
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
});
