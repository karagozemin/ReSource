import type { AppState } from "../src/types";
import { initialEvents, initialMetrics, initialProviders, standingOrder } from "../src/data/demo";

export function createInitialState(executionMode: AppState["executionMode"]): AppState {
  return {
    schemaVersion: 4,
    order: structuredClone(standingOrder),
    providers: structuredClone(initialProviders),
    events: structuredClone(initialEvents),
    metrics: structuredClone(initialMetrics),
    cycles: [],
    selectedProviderId: null,
    mode: "ready",
    executionMode,
    integrationReady: executionMode === "demo",
    pendingPayment: null,
    directProof: {
      status: "ready",
      chainId: "84532",
      network: "Base Sepolia",
      from: null,
      to: null,
      gasEstimate: null,
      executionId: null,
      transactionHash: null,
      transactionLink: null,
      error: null,
    },
  };
}
