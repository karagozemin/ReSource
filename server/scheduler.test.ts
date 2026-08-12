import { beforeEach, describe, expect, it } from "vitest";
import { DemoExecutionAdapter } from "./adapters";
import { ProcurementOrchestrator } from "./orchestrator";
import { scheduledCycleKey, TriggerEngine } from "./scheduler";
import { MemoryStateStore } from "./store";

describe("TriggerEngine", () => {
  let orchestrator: ProcurementOrchestrator;

  beforeEach(async () => {
    orchestrator = new ProcurementOrchestrator(new MemoryStateStore(), new DemoExecutionAdapter());
    await orchestrator.initialize();
  });

  it("derives a stable key for the same interval bucket", () => {
    const tenMinutes = 10 * 60_000;
    expect(scheduledCycleKey("SO-001", 10, tenMinutes + 1)).toBe(scheduledCycleKey("SO-001", 10, tenMinutes * 2 - 1));
    expect(scheduledCycleKey("SO-001", 10, tenMinutes + 1)).not.toBe(scheduledCycleKey("SO-001", 10, tenMinutes * 2));
  });

  it("does not duplicate a scheduled purchase within one bucket", async () => {
    const trigger = new TriggerEngine(orchestrator, 30_000, () => 1_000_000);
    const first = await trigger.tick();
    const second = await trigger.tick();
    expect(first?.replayed).toBe(false);
    expect(second?.replayed).toBe(true);
    expect(orchestrator.snapshot().metrics.purchases).toBe(1);
  });

  it("does not run a paused Standing Order", async () => {
    await orchestrator.togglePause();
    const trigger = new TriggerEngine(orchestrator, 30_000, () => 1_000_000);
    expect(await trigger.tick()).toBeNull();
    expect(orchestrator.snapshot().metrics.cycles).toBe(0);
  });
});
