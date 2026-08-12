import Fastify from "fastify";
import type { ProcurementOrchestrator } from "./orchestrator";

export function buildApp(orchestrator: ProcurementOrchestrator) {
  const app = Fastify({ logger: true });

  app.get("/api/health", async () => ({ ok: true, mode: orchestrator.snapshot().executionMode }));
  app.get("/api/state", async () => orchestrator.snapshot());
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
  app.post("/api/demo/reset", async (_request, reply) => {
    if (orchestrator.snapshot().executionMode !== "demo") return reply.code(404).send({ error: "Demo reset is unavailable" });
    return orchestrator.reset();
  });

  return app;
}
