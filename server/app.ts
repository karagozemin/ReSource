import Fastify from "fastify";
import cors from "@fastify/cors";
import { timingSafeEqual } from "node:crypto";
import type { StandingOrderUpdate } from "../src/types";
import type { ProcurementOrchestrator } from "./orchestrator";
import type { TriggerEngine } from "./scheduler";

export function buildApp(orchestrator: ProcurementOrchestrator, scheduler?: TriggerEngine) {
  const app = Fastify({ logger: true });

  const allowedOrigins = (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (allowedOrigins.length > 0) {
    void app.register(cors, {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) callback(null, true);
        else callback(null, false);
      },
      methods: ["GET", "POST", "PATCH", "OPTIONS"],
      allowedHeaders: ["content-type", "idempotency-key", "x-resource-operator-key"],
    });
  }

  app.addHook("preHandler", async (request, reply) => {
    if (!isMutation(request.method)) return;
    const expected = process.env.OPERATOR_API_KEY;
    if (!expected) {
      if (process.env.NODE_ENV === "production") return reply.code(503).send({ error: "Operator authorization is not configured" });
      return;
    }
    const provided = request.headers["x-resource-operator-key"];
    if (typeof provided !== "string" || !secureEqual(provided, expected)) return reply.code(401).send({ error: "Operator authorization required" });
  });

  app.get("/api/health", async () => ({ ok: true, mode: orchestrator.snapshot().executionMode }));
  app.get("/api/state", async () => orchestrator.snapshot());
  app.get("/api/runtime", async () => ({ scheduler: scheduler?.status() ?? { enabled: false, pollMs: null } }));
  app.post<{ Params: { id: string }; Headers: { "idempotency-key"?: string } }>("/api/standing-orders/:id/run", async (request, reply) => {
    const state = orchestrator.snapshot();
    if (request.params.id !== state.order.id) return reply.code(404).send({ error: "Standing order not found" });
    const key = request.headers["idempotency-key"];
    if (!key) return reply.code(400).send({ error: "idempotency-key header is required" });
    try { return await orchestrator.run(key); }
    catch (error) { return reply.code(503).send({ error: String(error) }); }
  });
  app.post<{ Params: { cycleId: string } }>("/api/procurement/:cycleId/confirm-payment", async (request, reply) => {
    try { return await orchestrator.confirmPayment(request.params.cycleId); }
    catch (error) { return reply.code(409).send({ error: String(error) }); }
  });
  app.post("/api/direct-proof/simulate", async (_request, reply) => {
    try { return await orchestrator.simulateDirectProof(); }
    catch (error) { return reply.code(503).send({ error: String(error) }); }
  });
  app.post("/api/direct-proof/broadcast", async (_request, reply) => {
    try { return await orchestrator.broadcastDirectProof(); }
    catch (error) { return reply.code(409).send({ error: String(error) }); }
  });
  app.post("/api/demo/failure", async (_request, reply) => {
    if (orchestrator.snapshot().executionMode !== "demo") return reply.code(404).send({ error: "Demo failure injection is unavailable" });
    try { return await orchestrator.injectFailure(); }
    catch (error) { return reply.code(409).send({ error: String(error) }); }
  });
  app.post("/api/providers/selected/failure", async (_request, reply) => {
    try { return await orchestrator.injectFailure(); }
    catch (error) { return reply.code(409).send({ error: String(error) }); }
  });
  app.post("/api/standing-orders/toggle", async () => orchestrator.togglePause());
  app.patch<{ Body: StandingOrderUpdate }>("/api/standing-orders/policy", async (request, reply) => {
    try { return await orchestrator.updateOrder(request.body); }
    catch (error) { return reply.code(409).send({ error: String(error) }); }
  });
  app.post("/api/providers/refresh", async (_request, reply) => {
    try { return await orchestrator.refreshProviders(); }
    catch (error) { return reply.code(503).send({ error: String(error) }); }
  });
  app.post<{ Params: { providerId: string } }>("/api/providers/:providerId/requalify", async (request, reply) => {
    try { return await orchestrator.requalifyProvider(request.params.providerId); }
    catch (error) { return reply.code(404).send({ error: String(error) }); }
  });
  app.patch<{ Body: { enabled?: unknown } }>("/api/runtime/scheduler", async (request, reply) => {
    if (!scheduler) return reply.code(503).send({ error: "Scheduler control is unavailable" });
    if (typeof request.body?.enabled !== "boolean") return reply.code(400).send({ error: "enabled must be boolean" });
    return { scheduler: scheduler.setEnabled(request.body.enabled) };
  });
  app.post("/api/demo/reset", async (_request, reply) => {
    if (orchestrator.snapshot().executionMode !== "demo") return reply.code(404).send({ error: "Demo reset is unavailable" });
    return orchestrator.reset();
  });

  return app;
}

function isMutation(method: string) { return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE"; }

function secureEqual(provided: string, expected: string) {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
