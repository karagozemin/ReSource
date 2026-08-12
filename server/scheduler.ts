import type { ProcurementOrchestrator } from "./orchestrator";

export class TriggerEngine {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly orchestrator: ProcurementOrchestrator,
    private readonly pollMs = 30_000,
    private readonly now = () => Date.now(),
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const state = this.orchestrator.snapshot();
    if (state.order.status !== "active" || !state.integrationReady || state.pendingPayment) return null;
    const key = scheduledCycleKey(state.order.id, state.order.intervalMinutes, this.now());
    return this.orchestrator.run(key);
  }
}

export function scheduledCycleKey(orderId: string, intervalMinutes: number, timestamp: number) {
  const intervalMs = intervalMinutes * 60_000;
  const bucket = Math.floor(timestamp / intervalMs);
  return `schedule:${orderId}:${bucket}`;
}
