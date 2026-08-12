import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DemoExecutionAdapter } from "./adapters";
import { buildApp } from "./app";
import { ProcurementOrchestrator } from "./orchestrator";
import { TriggerEngine } from "./scheduler";
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

  it("allows only the configured frontend origin", async () => {
    const previousOrigin = process.env.FRONTEND_ORIGIN;
    await app.close();
    process.env.FRONTEND_ORIGIN = "https://resource.vercel.app";
    const orchestrator = new ProcurementOrchestrator(new MemoryStateStore(), new DemoExecutionAdapter());
    await orchestrator.initialize();
    app = buildApp(orchestrator);

    try {
      const allowed = await app.inject({ method: "GET", url: "/api/state", headers: { origin: "https://resource.vercel.app" } });
      const rejected = await app.inject({ method: "GET", url: "/api/state", headers: { origin: "https://untrusted.example" } });
      expect(allowed.headers["access-control-allow-origin"]).toBe("https://resource.vercel.app");
      expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      if (previousOrigin === undefined) delete process.env.FRONTEND_ORIGIN;
      else process.env.FRONTEND_ORIGIN = previousOrigin;
    }
  });

  it("updates a validated standing order policy", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/standing-orders/policy",
      payload: { intervalMinutes: 15, maxPrice: 0.07, dailyBudget: 3, maxLatencyMs: 25000, minReliability: 0.97, automaticFailover: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().order).toMatchObject({ intervalMinutes: 15, maxPrice: 0.07, minReliability: 0.97 });
  });

  it("rejects an invalid standing order policy", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/standing-orders/policy",
      payload: { intervalMinutes: 0, maxPrice: 0.07, dailyBudget: 0.01, maxLatencyMs: 100, minReliability: 2, automaticFailover: true },
    });
    expect(response.statusCode).toBe(409);
  });

  it("controls scheduler runtime state when available", async () => {
    await app.close();
    const orchestrator = new ProcurementOrchestrator(new MemoryStateStore(), new DemoExecutionAdapter());
    await orchestrator.initialize();
    const scheduler = new TriggerEngine(orchestrator, 5000);
    app = buildApp(orchestrator, scheduler);
    const response = await app.inject({ method: "PATCH", url: "/api/runtime/scheduler", payload: { enabled: true } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ scheduler: { enabled: true, pollMs: 5000 } });
    scheduler.stop();
  });

  it("requalifies an ineligible provider and clears observed history", async () => {
    const response = await app.inject({ method: "POST", url: "/api/providers/veridian/requalify" });
    expect(response.statusCode).toBe(200);
    const provider = response.json().providers.find((item: { id: string }) => item.id === "veridian");
    expect(provider).toMatchObject({ state: "healthy", reliability: 1, attempts: 0 });
  });
});
