import type { Metrics, Provider, StandingOrder, TimelineEvent } from "../types";

export const standingOrder: StandingOrder = {
  id: "SO-001",
  service: "Transaction Risk Intelligence",
  description: "Assess transaction calldata risk before onchain execution.",
  intervalMinutes: 10,
  maxPrice: 0.06,
  dailyBudget: 2,
  maxLatencyMs: 20_000,
  minReliability: 0.95,
  automaticFailover: true,
  status: "active",
};

export const initialProviders: Provider[] = [
  {
    id: "atlas",
    name: "Atlas Risk",
    workflow: "transaction-risk-atlas",
    price: 0.05,
    reliability: 0.99,
    latencyMs: 8_200,
    attempts: 100,
    state: "healthy",
  },
  {
    id: "sentinel",
    name: "Sentinel Labs",
    workflow: "transaction-risk-sentinel",
    price: 0.03,
    reliability: 0.96,
    latencyMs: 13_100,
    attempts: 25,
    state: "healthy",
  },
  {
    id: "veridian",
    name: "Veridian Data",
    workflow: "transaction-risk-veridian",
    price: 0.02,
    reliability: 0.98,
    latencyMs: 31_400,
    attempts: 50,
    state: "ineligible",
  },
];

export const initialMetrics: Metrics = {
  cycles: 0,
  evaluations: 0,
  purchases: 0,
  recoveries: 0,
  executions: 0,
  spend: 0,
};

export const initialEvents: TimelineEvent[] = [
  {
    id: "ready",
    time: "Ready",
    kind: "info",
    title: "Standing order armed",
    detail: "Waiting for the next procurement cycle.",
  },
];
