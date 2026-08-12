import { randomUUID } from "node:crypto";
import { applyProviderFailure, rankProviders } from "../src/lib/procurement";
import type { AppState, ProcurementCycle, StandingOrderUpdate, TimelineEvent } from "../src/types";
import type { ExecutionAdapter } from "./adapters";
import type { KeeperHubDirectExecutionClient } from "./direct-execution";
import { createInitialState } from "./fixtures";
import { PaymentQuoteExpiredError } from "./marketplace";
import type { MarketplaceClient } from "./marketplace";
import type { StateStore } from "./store";

export class ProcurementOrchestrator {
  private state!: AppState;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: StateStore,
    private readonly adapter: ExecutionAdapter,
    private readonly marketplace?: MarketplaceClient,
    private readonly directExecution?: KeeperHubDirectExecutionClient,
  ) {}

  async initialize() {
    const persisted = await this.store.load();
    this.state = persisted && persisted.executionMode === this.adapter.mode
      ? migrateState(persisted, this.adapter.mode)
      : createInitialState(this.adapter.mode);
    this.state.executionMode = this.adapter.mode;
    this.state.integrationReady = this.marketplace?.isReady() ?? this.adapter.isReady();
    if (this.state.mode === "running" || this.state.mode === "recovering") this.state.mode = "ready";
    await this.store.save(this.state);
  }

  snapshot(): AppState { return structuredClone(this.state); }

  run(idempotencyKey: string) {
    return this.serial(() => this.runInternal(idempotencyKey));
  }

  confirmPayment(cycleId: string) {
    return this.serial(() => this.confirmPaymentInternal(cycleId));
  }

  simulateDirectProof() {
    return this.serial(async () => {
      if (!this.directExecution?.isReady()) throw new Error("KeeperHub direct execution is not configured");
      this.state.directProof = await this.directExecution.simulate();
      this.addEvent("success", "Direct execution simulated", `${this.state.directProof.network} transfer passed simulation at ${this.state.directProof.gasEstimate} gas.`);
      await this.store.save(this.state);
      return this.snapshot();
    });
  }

  broadcastDirectProof() {
    return this.serial(async () => {
      if (!this.directExecution?.isReady()) throw new Error("KeeperHub direct execution is not configured");
      if (this.state.directProof.status !== "simulated") throw new Error("Direct execution must be simulated before broadcast");
      this.state.directProof = await this.directExecution.broadcast();
      this.addEvent(this.state.directProof.status === "completed" ? "success" : "error", "Direct execution proof", this.state.directProof.transactionHash ? `KeeperHub confirmed ${shortHash(this.state.directProof.transactionHash)}.` : this.state.directProof.error ?? "Direct execution failed.");
      await this.store.save(this.state);
      return this.snapshot();
    });
  }

  injectFailure() {
    return this.serial(async () => {
      const selectedId = this.state.selectedProviderId;
      if (!selectedId) throw new Error("Run a procurement cycle before injecting failure");
      const selected = this.state.providers.find((provider) => provider.id === selectedId);
      if (!selected) throw new Error("Selected provider not found");
      if (this.state.pendingPayment) {
        const pendingCycle = this.state.cycles.find((cycle) => cycle.id === this.state.pendingPayment?.cycleId);
        if (pendingCycle) {
          pendingCycle.status = "failed";
          pendingCycle.error = "Controlled SLA breach before payment";
          pendingCycle.completedAt = new Date().toISOString();
        }
        this.state.pendingPayment = null;
      }
      this.state.mode = "recovering";
      this.addEvent("error", `${selected.name} timed out`, "Provider exceeded the Standing Order SLA.");
      this.state.providers = this.state.providers.map((provider) => provider.id === selected.id ? applyProviderFailure(provider) : provider);
      this.addEvent("warning", "Provider automatically suspended", "Observed performance breached policy. Re-procurement started.");
      await this.store.save(this.state);
      const result = await this.runInternal(`recovery-${randomUUID()}`);
      if (!result.replayed && result.cycle.status === "completed" && !this.marketplace) {
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

  updateOrder(update: StandingOrderUpdate) {
    return this.serial(async () => {
      if (this.state.pendingPayment) throw new Error("Order policy cannot change while payment authorization is pending");
      validateOrderUpdate(update);
      this.state.order = { ...this.state.order, ...update };
      this.addEvent("success", "Standing order policy updated", `Budget $${update.dailyBudget.toFixed(2)} daily · $${update.maxPrice.toFixed(2)} max per call · ${update.maxLatencyMs} ms SLA.`);
      await this.store.save(this.state);
      return this.snapshot();
    });
  }

  refreshProviders() {
    return this.serial(async () => {
      if (!this.marketplace?.isReady()) {
        this.addEvent("info", "Provider catalog refreshed", `${this.state.providers.length} demo providers are available.`);
        await this.store.save(this.state);
        return this.snapshot();
      }
      const discovered = await this.marketplace.discover(this.state.providers);
      this.state.providers = mergeProviderHistory(discovered, this.state.providers);
      this.addEvent("success", "Marketplace catalog refreshed", `${this.state.providers.length} listed providers discovered.`);
      await this.store.save(this.state);
      return this.snapshot();
    });
  }

  requalifyProvider(providerId: string) {
    return this.serial(async () => {
      const provider = this.state.providers.find((item) => item.id === providerId);
      if (!provider) throw new Error("Provider not found");
      provider.state = "healthy";
      provider.reliability = 1;
      provider.latencyMs = Math.min(provider.latencyMs, this.state.order.maxLatencyMs);
      provider.attempts = 0;
      this.addEvent("warning", `${provider.name} requalified`, "Operator cleared observed performance history; the provider will be evaluated on its next run.");
      await this.store.save(this.state);
      return this.snapshot();
    });
  }

  reset() {
    return this.serial(async () => {
      this.state = createInitialState(this.adapter.mode);
      this.state.integrationReady = this.marketplace?.isReady() ?? this.adapter.isReady();
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
    if (this.state.pendingPayment) throw new Error("A payment authorization is already pending");
    if (!(this.marketplace?.isReady() ?? this.adapter.isReady())) throw new Error("Execution adapter is not configured");
    if (this.state.order.status !== "active") return this.policyBlocked(idempotencyKey, "Standing order is paused");

    this.state.mode = "running";
    if (this.marketplace?.isReady()) {
      try {
        const discovered = await this.marketplace.discover(this.state.providers);
        this.state.providers = mergeProviderHistory(discovered, this.state.providers);
      } catch (error) {
        this.state.mode = "ready";
        this.addEvent("error", "Marketplace discovery failed", String(error));
        await this.store.save(this.state);
        throw error;
      }
    }
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
    this.addEvent(
      "info",
      this.marketplace?.isReady() ? "Marketplace quote requested" : "Execution authorized",
      this.marketplace?.isReady() ? "Live listing terms are being resolved before payment." : `${this.adapter.mode} adapter received the workflow request.`,
    );

    const cycleId = `cycle_${randomUUID()}`;
    if (this.marketplace?.isReady()) {
      let pending;
      try {
        pending = await this.marketplace.quote(winner.provider);
      } catch (error) {
        return this.finishQuoteFailure(cycleId, idempotencyKey, winner.provider.id, String(error));
      }
      pending.cycleId = cycleId;
      if (pending.amount !== winner.provider.price) return this.policyBlocked(idempotencyKey, "Quoted price changed after provider selection");
      const cycle = makeCycle(cycleId, idempotencyKey, this.state.order.id, winner.provider.id, "awaiting_payment", 0, null, null, null);
      this.state.pendingPayment = pending;
      this.state.mode = "awaiting_payment";
      this.state.cycles.unshift(cycle);
      this.addEvent("warning", "Payment authorization required", `${pending.amount.toFixed(2)} ${pending.token} on ${pending.chainName} is ready for approval.`);
      await this.store.save(this.state);
      return { state: this.snapshot(), cycle, replayed: false };
    }
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
    const isSimulatedPurchase = this.adapter.mode === "demo";
    this.addEvent(
      "success",
      this.adapter.mode === "keeperhub" ? "KeeperHub workflow complete" : "Demo execution complete",
      result.transactionHash
        ? `Onchain write confirmed: ${shortHash(result.transactionHash)}`
        : this.adapter.mode === "keeperhub"
          ? "Organization workflow succeeded. No payment or onchain transaction was recorded."
          : "Demo adapter confirmed the simulated lifecycle. No payment or transaction sent.",
    );
    if (isSimulatedPurchase) this.state.metrics.purchases += 1;
    this.state.metrics.executions += 1;
    if (isSimulatedPurchase) this.state.metrics.spend += winner.provider.price;
    this.state.mode = "healthy";
    const cycle = makeCycle(cycleId, idempotencyKey, this.state.order.id, winner.provider.id, "completed", isSimulatedPurchase ? winner.provider.price : 0, result.executionId, result.transactionHash, null);
    this.state.cycles.unshift(cycle);
    await this.store.save(this.state);
    return { state: this.snapshot(), cycle, replayed: false };
  }

  private async confirmPaymentInternal(cycleId: string) {
    const payment = this.state.pendingPayment;
    if (!payment || payment.cycleId !== cycleId) throw new Error("No matching payment authorization is pending");
    if (!this.marketplace?.isReady()) throw new Error("Marketplace buyer is not configured");
    const cycle = this.state.cycles.find((item) => item.id === cycleId);
    if (!cycle || cycle.status !== "awaiting_payment") throw new Error("Procurement cycle is not awaiting payment");
    const provider = this.state.providers.find((item) => item.id === payment.providerId);
    if (!provider) throw new Error("Selected provider no longer exists");
    if (this.state.order.status !== "active") throw new Error("Standing order is paused; payment authorization is blocked");
    if (payment.amount > this.state.order.maxPrice || this.state.metrics.spend + payment.amount > this.state.order.dailyBudget) {
      cycle.status = "policy_blocked";
      cycle.error = "Payment no longer satisfies budget policy";
      cycle.completedAt = new Date().toISOString();
      this.state.pendingPayment = null;
      this.state.mode = "ready";
      this.addEvent("error", "Policy blocked payment", cycle.error);
      await this.store.save(this.state);
      return { state: this.snapshot(), cycle, replayed: false };
    }

    this.state.mode = "running";
    this.addEvent("info", "x402 payment authorized", `${payment.amount.toFixed(2)} ${payment.token} approved for ${provider.name}.`);
    let result;
    try {
      result = await this.marketplace.pay(payment);
    } catch (error) {
      if (error instanceof PaymentQuoteExpiredError) {
        const refreshed = await this.marketplace.quote(provider);
        refreshed.cycleId = cycle.id;
        if (refreshed.amount !== payment.amount || refreshed.amount !== provider.price) {
          cycle.status = "policy_blocked";
          cycle.error = "Refreshed quote changed price";
          cycle.completedAt = new Date().toISOString();
          this.state.pendingPayment = null;
          this.state.mode = "ready";
          this.addEvent("error", "Refreshed quote blocked", "Marketplace terms changed; no payment was attempted.");
          await this.store.save(this.state);
          return { state: this.snapshot(), cycle, replayed: false, needsReconfirmation: false };
        }
        this.state.pendingPayment = refreshed;
        this.state.mode = "awaiting_payment";
        this.addEvent("warning", "Payment quote refreshed", `${refreshed.amount.toFixed(2)} ${refreshed.token} on ${refreshed.chainName} requires a new authorization.`);
        await this.store.save(this.state);
        return { state: this.snapshot(), cycle, replayed: false, needsReconfirmation: true };
      }
      this.state.mode = "awaiting_payment";
      this.addEvent("error", "Payment attempt failed", `${error instanceof Error ? error.message : "Wallet payment failed."} No purchase was recorded.`);
      await this.store.save(this.state);
      throw error;
    }
    this.state.pendingPayment = null;
    cycle.executionId = result.executionId;
    cycle.transactionHash = result.transactionHash;
    cycle.paymentProtocol = "x402";
    cycle.completedAt = new Date().toISOString();
    if (result.paid) {
      cycle.amount = result.amount ?? payment.amount;
      this.state.metrics.purchases += 1;
      this.state.metrics.spend += cycle.amount;
      const highestEligiblePrice = Math.max(...rankProviders(this.state.providers, this.state.order, this.state.metrics.spend - cycle.amount)
        .filter((decision) => decision.eligible)
        .map((decision) => decision.provider.price), cycle.amount);
      this.state.metrics.savings += Math.max(0, highestEligiblePrice - cycle.amount);
    }

    if (!result.success || !verifyResult(result.output, result.latencyMs, this.state.order.maxLatencyMs)) {
      cycle.status = "failed";
      cycle.error = result.error ?? "Result verification failed";
      this.state.providers = this.state.providers.map((item) => item.id === provider.id ? applyProviderFailure(item) : item);
      this.state.mode = "recovering";
      this.addEvent("error", `${provider.name} failed verification`, cycle.error);
      this.addEvent("warning", "Provider automatically suspended", "ReSource will select the next eligible Marketplace provider.");
      await this.store.save(this.state);
      if (this.state.order.automaticFailover) return this.runInternal(`recovery-${cycle.id}`);
      return { state: this.snapshot(), cycle, replayed: false };
    }

    cycle.status = "completed";
    this.state.metrics.executions += 1;
    if (cycle.idempotencyKey.startsWith("recovery-")) {
      this.state.metrics.recoveries += 1;
      this.addEvent("success", "Recovery verified", "Replacement provider satisfied the Standing Order after automatic re-procurement.");
    }
    this.state.providers = this.state.providers.map((item) => item.id === provider.id ? updateProviderSuccess(item, result.latencyMs) : item);
    this.state.selectedProviderId = provider.id;
    this.state.mode = "healthy";
    this.addEvent("success", "Paid result verified", `Schema and SLA passed in ${result.latencyMs} ms.`);
    this.addEvent("success", "x402 settlement confirmed", result.transactionHash ? `Payment transaction: ${shortHash(result.transactionHash)}` : "Marketplace payment completed.");
    await this.store.save(this.state);
    return { state: this.snapshot(), cycle, replayed: false };
  }

  private async policyBlocked(key: string, error: string) {
    const cycle = makeCycle(`cycle_${randomUUID()}`, key, this.state.order.id, null, "policy_blocked", 0, null, null, error);
    this.state.cycles.unshift(cycle);
    this.state.mode = "ready";
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

  private async finishQuoteFailure(cycleId: string, key: string, providerId: string, error: string) {
    this.state.mode = "ready";
    this.addEvent("error", "Marketplace quote failed", `${error} No payment was attempted.`);
    const cycle = makeCycle(cycleId, key, this.state.order.id, providerId, "failed", 0, null, null, error);
    this.state.cycles.unshift(cycle);
    await this.store.save(this.state);
    return { state: this.snapshot(), cycle, replayed: false };
  }

  private addEvent(kind: TimelineEvent["kind"], title: string, detail: string) {
    this.state.events.unshift({ id: randomUUID(), time: new Date().toISOString(), kind, title, detail });
  }
}

function verifyResult(output: unknown, latencyMs: number, maxLatencyMs: number) {
  if (latencyMs > maxLatencyMs) return false;
  const result = unwrapOutput(output);
  if (!result || typeof result !== "object") return false;
  const value = result as Record<string, unknown>;
  return ["low", "medium", "high", "critical"].includes(String(value.riskLevel))
    && typeof value.riskScore === "number"
    && value.riskScore >= 0
    && value.riskScore <= 100
    && Array.isArray(value.factors);
}

function unwrapOutput(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const value = output as Record<string, unknown>;
  if ("riskLevel" in value) return value;
  if (value.data && typeof value.data === "object") return unwrapOutput(value.data);
  const entries = Object.values(value);
  return entries.length === 1 ? unwrapOutput(entries[0]) : output;
}

function makeCycle(id: string, idempotencyKey: string, standingOrderId: string, selectedProviderId: string | null, status: ProcurementCycle["status"], amount: number, executionId: string | null, transactionHash: string | null, error: string | null): ProcurementCycle {
  const timestamp = new Date().toISOString();
  return { id, idempotencyKey, standingOrderId, startedAt: timestamp, completedAt: timestamp, selectedProviderId, status, amount, executionId, transactionHash, error };
}

function shortHash(hash: string) { return `${hash.slice(0, 8)}…${hash.slice(-6)}`; }

function updateProviderSuccess(provider: AppState["providers"][number], latencyMs: number) {
  const attempts = provider.attempts + 1;
  return { ...provider, attempts, reliability: (provider.reliability * provider.attempts + 1) / attempts, latencyMs: Math.round((provider.latencyMs * provider.attempts + latencyMs) / attempts), state: "healthy" as const };
}

function mergeProviderHistory(discovered: AppState["providers"], history: AppState["providers"]) {
  return discovered.map((provider) => {
    const previous = history.find((item) => item.id === provider.id || (item.marketplaceSlug && item.marketplaceSlug === provider.marketplaceSlug));
    if (!previous) return provider;
    return {
      ...provider,
      reliability: previous.reliability,
      latencyMs: previous.latencyMs,
      attempts: previous.attempts,
      state: previous.state,
    };
  });
}

function migrateState(state: AppState, mode: ExecutionAdapter["mode"]): AppState {
  const persistedVersion = Number((state as { schemaVersion?: number }).schemaVersion ?? 0);
  const initial = createInitialState(mode);
  const migrated = {
    ...state,
    schemaVersion: 4 as const,
    pendingPayment: state.pendingPayment ?? null,
    directProof: state.directProof ?? initial.directProof,
  };
  migrated.metrics = { ...migrated.metrics, savings: migrated.metrics.savings ?? 0 };
  migrated.events = migrated.events.map((event) => event.title === "Payment attempt failed" && event.detail.includes("Command failed:")
    ? { ...event, detail: "The payment quote was no longer available. No purchase was recorded." }
    : event);
  if (mode === "keeperhub" && persistedVersion < 3) {
    migrated.metrics = { ...migrated.metrics, purchases: 0, spend: 0 };
    migrated.cycles = migrated.cycles.map((cycle) => ({ ...cycle, amount: 0 }));
    migrated.events = migrated.events.map((event) => event.title === "KeeperHub execution complete"
      ? { ...event, title: "KeeperHub workflow complete", detail: "Organization workflow succeeded. No payment or onchain transaction was recorded." }
      : event);
  }
  return migrated;
}

function validateOrderUpdate(update: StandingOrderUpdate) {
  if (!Number.isInteger(update.intervalMinutes) || update.intervalMinutes < 1 || update.intervalMinutes > 1440) throw new Error("Interval must be an integer from 1 to 1440 minutes");
  if (!Number.isFinite(update.maxPrice) || update.maxPrice <= 0 || update.maxPrice > 100) throw new Error("Max price must be greater than 0 and at most 100 USDC");
  if (!Number.isFinite(update.dailyBudget) || update.dailyBudget < update.maxPrice || update.dailyBudget > 10_000) throw new Error("Daily budget must cover max price and be at most 10,000 USDC");
  if (!Number.isInteger(update.maxLatencyMs) || update.maxLatencyMs < 1000 || update.maxLatencyMs > 300_000) throw new Error("Max latency must be an integer from 1,000 to 300,000 ms");
  if (!Number.isFinite(update.minReliability) || update.minReliability < 0 || update.minReliability > 1) throw new Error("Minimum reliability must be between 0 and 1");
  if (typeof update.automaticFailover !== "boolean") throw new Error("Automatic failover must be boolean");
}
