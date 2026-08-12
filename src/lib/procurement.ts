import type { Provider, ProviderDecision, StandingOrder } from "../types";

export const SCORE_WEIGHTS = {
  price: 0.4,
  reliability: 0.4,
  latency: 0.2,
} as const;

export function evaluateProvider(
  provider: Provider,
  order: StandingOrder,
  spentToday: number,
): ProviderDecision {
  let reason: string | null = null;

  if (order.status !== "active") reason = "Standing order is paused";
  else if (provider.state === "ineligible") reason = "Provider suspended";
  else if (provider.price > order.maxPrice) reason = "Price exceeds policy";
  else if (spentToday + provider.price > order.dailyBudget) reason = "Daily budget exceeded";
  else if (provider.latencyMs > order.maxLatencyMs) reason = "Latency exceeds SLA";
  else if (provider.reliability < order.minReliability) reason = "Reliability below policy";

  if (reason) return { provider, eligible: false, score: null, reason };

  const priceScore = 1 - provider.price / order.maxPrice;
  const reliabilityScore = provider.reliability;
  const latencyScore = 1 - provider.latencyMs / order.maxLatencyMs;
  const score =
    priceScore * SCORE_WEIGHTS.price +
    reliabilityScore * SCORE_WEIGHTS.reliability +
    latencyScore * SCORE_WEIGHTS.latency;

  return {
    provider,
    eligible: true,
    score: Math.round(score * 1000) / 1000,
    reason: null,
  };
}

export function rankProviders(
  providers: Provider[],
  order: StandingOrder,
  spentToday: number,
): ProviderDecision[] {
  return providers
    .map((provider) => evaluateProvider(provider, order, spentToday))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return (b.score ?? -1) - (a.score ?? -1);
    });
}

export function applyProviderFailure(provider: Provider): Provider {
  const attempts = provider.attempts + 1;
  const previousSuccesses = Math.round(provider.reliability * provider.attempts);
  const reliability = previousSuccesses / attempts;

  return {
    ...provider,
    attempts,
    reliability,
    latencyMs: Math.max(provider.latencyMs, 24_800),
    state: "ineligible",
  };
}
