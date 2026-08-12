export type StandingOrderStatus = "active" | "paused";
export type ProviderState = "healthy" | "degraded" | "ineligible";

export type StandingOrder = {
  id: string;
  service: string;
  description: string;
  intervalMinutes: number;
  maxPrice: number;
  dailyBudget: number;
  maxLatencyMs: number;
  minReliability: number;
  automaticFailover: boolean;
  status: StandingOrderStatus;
};

export type Provider = {
  id: string;
  name: string;
  workflow: string;
  price: number;
  reliability: number;
  latencyMs: number;
  attempts: number;
  state: ProviderState;
};

export type ProviderDecision = {
  provider: Provider;
  eligible: boolean;
  score: number | null;
  reason: string | null;
};

export type TimelineEvent = {
  id: string;
  time: string;
  kind: "info" | "success" | "warning" | "error";
  title: string;
  detail: string;
};

export type Metrics = {
  cycles: number;
  evaluations: number;
  purchases: number;
  recoveries: number;
  executions: number;
  spend: number;
};

export type CycleStatus = "completed" | "failed" | "policy_blocked" | "no_provider";

export type ProcurementCycle = {
  id: string;
  idempotencyKey: string;
  standingOrderId: string;
  startedAt: string;
  completedAt: string;
  selectedProviderId: string | null;
  status: CycleStatus;
  amount: number;
  executionId: string | null;
  transactionHash: string | null;
  error: string | null;
};

export type AppState = {
  schemaVersion: 3;
  order: StandingOrder;
  providers: Provider[];
  events: TimelineEvent[];
  metrics: Metrics;
  cycles: ProcurementCycle[];
  selectedProviderId: string | null;
  mode: "ready" | "running" | "healthy" | "recovering";
  executionMode: "demo" | "keeperhub";
  integrationReady: boolean;
};
