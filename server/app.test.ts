import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DemoExecutionAdapter } from "./adapters";
import { buildApp } from "./app";
import { ProcurementOrchestrator } from "./orchestrator";
import { MemoryStateStore } from "./store";

describe("procurement API", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    const orchestrator = new ProcurementOrchestrator(new MemoryStateStore(), new DemoExecutionAdapter());
    await orchestrator.initialize();
    app = buildApp(orchestrator);
  });

  afterEach(async () => app.close());

  it("requires an idempotency key", async () => {
    const response = await app.inject({ method: "POST", url: "/api/standing-orders/SO-001/run" });
    expect(response.statusCode).toBe(400);
  });

  it("returns the same cycle for a replayed request", async () => {
    const headers = { "idempotency-key": "http-cycle" };
    const first = await app.inject({ method: "POST", url: "/api/standing-orders/SO-001/run", headers });
    const second = await app.inject({ method: "POST", url: "/api/standing-orders/SO-001/run", headers });
    expect(first.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().cycle.id).toBe(first.json().cycle.id);
  });

  it("exposes persisted server state", async () => {
    const response = await app.inject({ method: "GET", url: "/api/state" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ executionMode: "demo", integrationReady: true });
  });
});
