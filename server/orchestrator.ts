import { randomUUID } from "node:crypto";
import { applyProviderFailure, rankProviders } from "../src/lib/procurement";
import type { AppState, ProcurementCycle, TimelineEvent } from "../src/types";
import type { ExecutionAdapter } from "./adapters";
import { createInitialState } from "./fixtures";
import type { StateStore } from "./store";

export class ProcurementOrchestrator {
  private state!: AppState;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly store: StateStore, private readonly adapter: ExecutionAdapter) {}

  async initialize() {
    this.state = (await this.store.load()) ?? createInitialState(this.adapter.mode);
    this.state.executionMode = this.adapter.mode;
    this.state.integrationReady = this.adapter.isReady();
    if (this.state.mode === "running" || this.state.mode === "recovering") this.state.mode = "ready";
    await this.store.save(this.state);
  }

  snapshot(): AppState { return structuredClone(this.state); }

  run(idempotencyKey: string) {
    return this.serial(() => this.runInternal(idempotencyKey));
  }

  injectFailure() {
    return this.serial(async () => {
      const selectedId = this.state.selectedProviderId;
      if (!selectedId) throw new Error("Run a procurement cycle before injecting failure");
      const selected = this.state.providers.find((provider) => provider.id === selectedId);
      if (!selected) throw new Error("Selected provider not found");
      this.state.mode = "recovering";
      this.addEvent("error", `${selected.name} timed out`, "Provider exceeded the Standing Order SLA.");
      this.state.providers = this.state.providers.map((provider) => provider.id === selected.id ? applyProviderFailure(provider) : provider);
      this.addEvent("warning", "Provider automatically suspended", "Observed performance breached policy. Re-procurement started.");
      await this.store.save(this.state);
      const result = await this.runInternal(`recovery-${randomUUID()}`);
      if (!result.replayed && result.cycle.status === "completed") {
        this.state.metrics.recoveries += 1;
        this.addEvent("success", "Recovery verified", "Replacement provider satisfied the Standing Order without operator approval.");
        await this.store.save(this.state);
        return { ...result, state: this.snapshot() };
      }
      return result;
    });
  }

  togglePause() {
    return this.serial(async () => {
      this.state.order.status = this.state.order.status === "active" ? "paused" : "active";
      this.addEvent(this.state.order.status === "active" ? "success" : "warning", `Standing order ${this.state.order.status}`, this.state.order.status === "active" ? "Future cycles are enabled." : "New payments are blocked until resumed.");
      await this.store.save(this.state);
      return this.snapshot();
    });
  }

  reset() {
    return this.serial(async () => {
      this.state = createInitialState(this.adapter.mode);
      this.state.integrationReady = this.adapter.isReady();
      await this.store.reset(this.state);
      return this.snapshot();
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runInternal(idempotencyKey: string) {
    const existing = this.state.cycles.find((cycle) => cycle.idempotencyKey === idempotencyKey);
    if (existing) return { state: this.snapshot(), cycle: existing, replayed: true };
    if (!this.adapter.isReady()) throw new Error("Execution adapter is not configured");
    if (this.state.order.status !== "active") return this.policyBlocked(idempotencyKey, "Standing order is paused");

    this.state.mode = "running";
    this.state.metrics.cycles += 1;
    this.state.metrics.evaluations += this.state.providers.length;
    this.addEvent("info", "Procurement cycle started", `Evaluating ${this.state.providers.length} provider workflows.`);
    const decisions = rankProviders(this.state.providers, this.state.order, this.state.metrics.spend);
    decisions.filter((decision) => !decision.eligible).forEach((decision) =>
      this.addEvent("warning", `${decision.provider.name} rejected`, decision.reason ?? "Policy constraint failed."),
    );
    const winner = decisions.find((decision) => decision.eligible);
    if (!winner) return this.finishNoProvider(idempotencyKey);

    this.state.selectedProviderId = winner.provider.id;
    this.addEvent("success", `${winner.provider.name} selected`, `$${winner.provider.price.toFixed(2)} per call · ${(winner.score! * 100).toFixed(1)} policy score.`);
    this.addEvent("success", "Buyer Policy Guard approved", "Budget, SLA and duplicate checks passed.");
    this.addEvent("info", "Execution authorized", `${this.adapter.mode} adapter received the workflow request.`);

    const cycleId = `cycle_${randomUUID()}`;
    let result;
    try {
      result = await this.adapter.execute(winner.provider, this.state.order);
    } catch (error) {
      return this.finishFailure(cycleId, idempotencyKey, winner.provider.id, String(error));
    }
    if (!result.success || !verifyResult(result.output, result.latencyMs, this.state.order.maxLatencyMs)) {
      return this.finishFailure(cycleId, idempotencyKey, winner.provider.id, result.error ?? "Result verification failed", result.executionId);
    }

    this.addEvent("success", "Result verified", "Provider response schema and SLA checks passed.");
    this.addEvent("success", "KeeperHub execution complete", result.transactionHash ? `Onchain write confirmed: ${shortHash(result.transactionHash)}` : "Demo adapter confirmed the lifecycle. No transaction sent.");
    this.state.metrics.purchases += 1;
    this.state.metrics.executions += 1;
    this.state.metrics.spend += winner.provider.price;
    this.state.mode = "healthy";
    const cycle = makeCycle(cycleId, idempotencyKey, this.state.order.id, winner.provider.id, "completed", winner.provider.price, result.executionId, result.transactionHash, null);
    this.state.cycles.unshift(cycle);
    await this.store.save(this.state);
    return { state: this.snapshot(), cycle, replayed: false };
  }

  private async policyBlocked(key: string, error: string) {
    const cycle = makeCycle(`cycle_${randomUUID()}`, key, this.state.order.id, null, "policy_blocked", 0, null, null, error);
    this.state.cycles.unshift(cycle);
    this.addEvent("error", "Policy blocked procurement", error);
    await this.store.save(this.state);
    return { state: this.snapshot(), cycle, replayed: false };
  }

  private async finishNoProvider(key: string) {
    const cycle = makeCycle(`cycle_${randomUUID()}`, key, this.state.order.id, null, "no_provider", 0, null, null, "No eligible provider");
    this.state.cycles.unshift(cycle);
    this.state.mode = "ready";
    this.addEvent("error", "No eligible provider", "Cycle closed without payment. Policy failed safely.");
    await this.store.save(this.state);
    return { state: this.snapshot(), cycle, replayed: false };
  }

  private async finishFailure(cycleId: string, key: string, providerId: string, error: string, executionId: string | null = null) {
    this.state.mode = "ready";
    this.addEvent("error", "Provider execution failed", error);
    const cycle = makeCycle(cycleId, key, this.state.order.id, providerId, "failed", 0, executionId, null, error);
    this.state.cycles.unshift(cycle);
    await this.store.save(this.state);
    return { state: this.snapshot(), cycle, replayed: false };
  }

  private addEvent(kind: TimelineEvent["kind"], title: string, detail: string) {
    this.state.events.unshift({ id: randomUUID(), time: new Date().toISOString(), kind, title, detail });
  }
}

function verifyResult(output: unknown, latencyMs: number, maxLatencyMs: number) {
  return output !== null && typeof output === "object" && latencyMs <= maxLatencyMs;
}

function makeCycle(id: string, idempotencyKey: string, standingOrderId: string, selectedProviderId: string | null, status: ProcurementCycle["status"], amount: number, executionId: string | null, transactionHash: string | null, error: string | null): ProcurementCycle {
  const timestamp = new Date().toISOString();
  return { id, idempotencyKey, standingOrderId, startedAt: timestamp, completedAt: timestamp, selectedProviderId, status, amount, executionId, transactionHash, error };
}

function shortHash(hash: string) { return `${hash.slice(0, 8)}…${hash.slice(-6)}`; }
