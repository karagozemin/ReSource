import { describe, expect, it } from "vitest";
import { initialProviders, standingOrder } from "../data/demo";
import type { Provider } from "../types";
import { applyProviderFailure, evaluateProvider, rankProviders } from "./procurement";

const atlas = initialProviders[0];
const sentinel = initialProviders[1];

describe("provider eligibility", () => {
  it("rejects a provider above the maximum price", () => {
    const expensive: Provider = { ...atlas, price: 0.07 };
    expect(evaluateProvider(expensive, standingOrder, 0)).toMatchObject({
      eligible: false,
      reason: "Price exceeds policy",
    });
  });

  it("rejects a purchase that would exceed the daily budget", () => {
    expect(evaluateProvider(atlas, standingOrder, 1.98)).toMatchObject({
      eligible: false,
      reason: "Daily budget exceeded",
    });
  });

  it("rejects providers above the latency SLA", () => {
    const slow: Provider = { ...atlas, latencyMs: 20_001 };
    expect(evaluateProvider(slow, standingOrder, 0)).toMatchObject({
      eligible: false,
      reason: "Latency exceeds SLA",
    });
  });

  it("rejects providers below observed reliability policy", () => {
    const unreliable: Provider = { ...atlas, reliability: 0.949 };
    expect(evaluateProvider(unreliable, standingOrder, 0)).toMatchObject({
      eligible: false,
      reason: "Reliability below policy",
    });
  });

  it("fails closed when the Standing Order is paused", () => {
    expect(evaluateProvider(atlas, { ...standingOrder, status: "paused" }, 0)).toMatchObject({
      eligible: false,
      reason: "Standing order is paused",
    });
  });
});

describe("deterministic procurement", () => {
  it("selects Sentinel when it is the best eligible value", () => {
    const ranked = rankProviders(initialProviders, standingOrder, 0);
    expect(ranked[0].provider.id).toBe("sentinel");
    expect(ranked[0].eligible).toBe(true);
    expect(ranked.at(-1)?.provider.id).toBe("veridian");
  });

  it("suspends a provider after a failed execution", () => {
    const failed = applyProviderFailure(sentinel);
    expect(failed.state).toBe("ineligible");
    expect(failed.attempts).toBe(sentinel.attempts + 1);
    expect(failed.reliability).toBeLessThan(standingOrder.minReliability);
  });

  it("automatically ranks Atlas first after Sentinel fails", () => {
    const providers = initialProviders.map((provider) =>
      provider.id === "sentinel" ? applyProviderFailure(provider) : provider,
    );
    expect(rankProviders(providers, standingOrder, 0)[0].provider.id).toBe("atlas");
  });
});
