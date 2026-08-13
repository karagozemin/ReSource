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

export type StandingOrderUpdate = Pick<StandingOrder,
  "intervalMinutes" | "maxPrice" | "dailyBudget" | "maxLatencyMs" | "minReliability" | "automaticFailover"
>;

export type RuntimeInfo = {
  scheduler: {
    enabled: boolean;
    pollMs: number | null;
  };
  sponsoredDemo: {
    enabled: boolean;
  };
};

export type Provider = {
  id: string;
  name: string;
  workflow: string;
  workflowId?: string;
  marketplaceSlug?: string;
  source?: "fixture" | "marketplace";
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
  savings: number;
};

export type CycleStatus = "awaiting_payment" | "completed" | "failed" | "policy_blocked" | "no_provider";

export type PendingPayment = {
  cycleId: string;
  paymentId: string;
  providerId: string;
  acceptsIndex: number;
  amount: number;
  token: string;
  chainId: string;
  chainName: string;
  recipient: string;
  createdAt: string;
};

export type DirectProof = {
  status: "ready" | "simulated" | "completed" | "failed";
  chainId: string;
  network: string;
  from: string | null;
  to: string | null;
  gasEstimate: string | null;
  executionId: string | null;
  transactionHash: string | null;
  transactionLink: string | null;
  error: string | null;
};

export type ProcurementCycle = {
  id: string;
  idempotencyKey: string;
  standingOrderId: string;
  startedAt: string;
  completedAt: string;
  selectedProviderId: string | null;
  status: CycleStatus;
  amount: number;
  paymentProtocol?: "x402" | null;
  executionId: string | null;
  transactionHash: string | null;
  error: string | null;
};

export type AppState = {
  schemaVersion: 4;
  order: StandingOrder;
  providers: Provider[];
  events: TimelineEvent[];
  metrics: Metrics;
  cycles: ProcurementCycle[];
  selectedProviderId: string | null;
  mode: "ready" | "running" | "awaiting_payment" | "healthy" | "recovering";
  executionMode: "demo" | "keeperhub";
  integrationReady: boolean;
  pendingPayment: PendingPayment | null;
  directProof: DirectProof;
};
